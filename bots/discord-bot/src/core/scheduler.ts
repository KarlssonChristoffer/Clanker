/**
 * Persistent job scheduler backed by bot.scheduled_jobs (survives restarts).
 *
 * - `schedule()` inserts a job; with `dedupeKey` it replaces the pending job with the same key.
 * - The loop polls every `pollMs` (30 s), claims due jobs with FOR UPDATE SKIP LOCKED, runs the
 *   handler registered for `kind`, and marks the job done / retries with exponential backoff /
 *   fails after `max_attempts`. `nudge()` wakes the loop early for jobs due before the next poll.
 * - Jobs stuck in `running` (process died mid-job) are returned to `pending` after `staleAfterMs`.
 * - Recurring jobs: the handler returns `{ nextRunAt }` and the scheduler enqueues the next run
 *   with the same dedupe key. Recurring handlers should catch their own errors so a bad week does
 *   not break the chain (feature modules also re-ensure their recurring job at startup).
 */
import type { Logger } from 'pino';
import { childLogger } from './logger.js';
import type { Queryable } from '../db.js';

export type { Queryable };

export type JobStatus = 'pending' | 'running' | 'done' | 'failed' | 'cancelled';

export type JobRow = {
  id: string;
  guild_id: string | null;
  kind: string;
  run_at: Date;
  payload: unknown;
  status: JobStatus;
  attempts: number;
  max_attempts: number;
  last_error: string | null;
  dedupe_key: string | null;
};

export type JobContext = { job: JobRow; log: Logger };
export type JobResult = void | { nextRunAt: Date; nextPayload?: unknown };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type JobHandler<P = any> = (payload: P, ctx: JobContext) => Promise<JobResult>;

/** Throw from a handler to fail the job immediately without retries (e.g. the channel is gone). */
export class PermanentJobError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PermanentJobError';
  }
}

export type ScheduleInput = {
  guildId?: string | null;
  kind: string;
  runAt: Date;
  payload?: unknown;
  dedupeKey?: string;
  maxAttempts?: number;
};

export type SchedulerOptions = {
  pollMs?: number;
  batchSize?: number;
  staleAfterMs?: number;
  now?: () => Date;
  random?: () => number;
};

const BASE_BACKOFF_MS = 30_000;
const MAX_BACKOFF_MS = 60 * 60_000;

/** Exponential backoff with ±20 % jitter: ~30 s, 1 min, 2 min, 4 min … capped at 1 h. */
export function backoffMs(attempts: number, random: () => number = Math.random): number {
  const exp = Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** Math.max(0, attempts - 1));
  const jitter = 1 + (random() * 0.4 - 0.2);
  return Math.round(exp * jitter);
}

function errorText(err: unknown): string {
  if (err instanceof Error) return `${err.name}: ${err.message}`.slice(0, 2000);
  return String(err).slice(0, 2000);
}

export class Scheduler {
  private readonly handlers = new Map<string, JobHandler>();
  private readonly log = childLogger('scheduler');
  private readonly pollMs: number;
  private readonly batchSize: number;
  private readonly staleAfterMs: number;
  private readonly now: () => Date;
  private readonly random: () => number;
  private timer: NodeJS.Timeout | null = null;
  private nudgeTimer: NodeJS.Timeout | null = null;
  private nudgeAt: number | null = null;
  private running: Promise<number> | null = null;
  private stopped = true;

  constructor(private readonly db: Queryable, opts: SchedulerOptions = {}) {
    this.pollMs = opts.pollMs ?? 30_000;
    this.batchSize = opts.batchSize ?? 10;
    this.staleAfterMs = opts.staleAfterMs ?? 10 * 60_000;
    this.now = opts.now ?? (() => new Date());
    this.random = opts.random ?? Math.random;
  }

  register<P>(kind: string, handler: JobHandler<P>): void {
    if (this.handlers.has(kind)) throw new Error(`Duplicate job handler for kind "${kind}"`);
    this.handlers.set(kind, handler as JobHandler);
  }

  /** Inserts a job (or replaces the pending job with the same dedupe key). Returns the job id, or null if the
   *  deduped job is currently running and could not be replaced. */
  async schedule(input: ScheduleInput): Promise<string | null> {
    const params = [
      input.guildId ?? null,
      input.kind,
      input.runAt,
      JSON.stringify(input.payload ?? {}),
      input.dedupeKey ?? null,
      input.maxAttempts ?? 5,
    ];
    const sql = input.dedupeKey
      ? `INSERT INTO bot.scheduled_jobs (guild_id, kind, run_at, payload, dedupe_key, max_attempts)
         VALUES ($1, $2, $3, $4::jsonb, $5, $6)
         ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL AND status IN ('pending', 'running')
         DO UPDATE SET guild_id = EXCLUDED.guild_id, kind = EXCLUDED.kind, run_at = EXCLUDED.run_at,
                       payload = EXCLUDED.payload, max_attempts = EXCLUDED.max_attempts,
                       attempts = 0, last_error = NULL, updated_at = now()
           WHERE bot.scheduled_jobs.status = 'pending'
         RETURNING id::text AS id`
      : `INSERT INTO bot.scheduled_jobs (guild_id, kind, run_at, payload, dedupe_key, max_attempts)
         VALUES ($1, $2, $3, $4::jsonb, $5, $6)
         RETURNING id::text AS id`;
    const res = await this.db.query<{ id: string }>(sql, params);
    const id = res.rows[0]?.id ?? null;
    if (!id) {
      this.log.warn({ kind: input.kind, dedupeKey: input.dedupeKey }, 'job with this dedupe key is running; not replaced');
      return null;
    }
    this.nudge(input.runAt);
    return id;
  }

  /** Cancels the pending job with this dedupe key. Returns how many jobs were cancelled. */
  async cancel(dedupeKey: string): Promise<number> {
    const res = await this.db.query(
      `UPDATE bot.scheduled_jobs SET status = 'cancelled', finished_at = now(), updated_at = now()
       WHERE dedupe_key = $1 AND status = 'pending'`,
      [dedupeKey],
    );
    return res.rowCount ?? 0;
  }

  async hasPending(dedupeKey: string): Promise<boolean> {
    const res = await this.db.query(
      `SELECT 1 FROM bot.scheduled_jobs WHERE dedupe_key = $1 AND status IN ('pending', 'running') LIMIT 1`,
      [dedupeKey],
    );
    return res.rows.length > 0;
  }

  /** One poll: recover stale jobs, claim due jobs, run them. Returns the number of jobs processed. */
  tick(): Promise<number> {
    if (this.running) return this.running;
    this.running = this.runTick().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async runTick(): Promise<number> {
    const now = this.now();
    await this.recoverStale(now);
    let processed = 0;
    // Drain in batches so a backlog after downtime does not wait a full poll interval per batch.
    for (;;) {
      const jobs = await this.claim(now);
      if (!jobs.length) break;
      for (const job of jobs) {
        await this.runJob(job);
        processed += 1;
      }
      if (jobs.length < this.batchSize || this.stopped) break;
    }
    return processed;
  }

  private async recoverStale(now: Date): Promise<void> {
    const res = await this.db.query(
      `UPDATE bot.scheduled_jobs
       SET status = 'pending', locked_at = NULL, updated_at = now(),
           last_error = 'recovered: worker stopped while running'
       WHERE status = 'running' AND locked_at < $1`,
      [new Date(now.getTime() - this.staleAfterMs)],
    );
    if (res.rowCount) this.log.warn({ count: res.rowCount }, 'recovered stale running jobs');
  }

  private async claim(now: Date): Promise<JobRow[]> {
    const res = await this.db.query<JobRow>(
      `UPDATE bot.scheduled_jobs j
       SET status = 'running', locked_at = $2, attempts = j.attempts + 1, updated_at = now()
       WHERE j.id IN (
         SELECT id FROM bot.scheduled_jobs
         WHERE status = 'pending' AND run_at <= $2
         ORDER BY run_at, id
         LIMIT $1
         FOR UPDATE SKIP LOCKED
       )
       RETURNING j.id::text AS id, j.guild_id, j.kind, j.run_at, j.payload, j.status, j.attempts,
                 j.max_attempts, j.last_error, j.dedupe_key`,
      [this.batchSize, now],
    );
    return res.rows.sort((a, b) => new Date(a.run_at).getTime() - new Date(b.run_at).getTime());
  }

  private async runJob(job: JobRow): Promise<void> {
    const log = this.log.child({ jobId: job.id, kind: job.kind, guildId: job.guild_id, attempt: job.attempts });
    const handler = this.handlers.get(job.kind);
    try {
      if (!handler) throw new Error(`no handler registered for job kind "${job.kind}"`);
      const result = await handler(job.payload, { job, log });
      await this.db.query(
        `UPDATE bot.scheduled_jobs
         SET status = 'done', finished_at = $2, locked_at = NULL, last_error = NULL, updated_at = now()
         WHERE id = $1`,
        [job.id, this.now()],
      );
      log.debug('job done');
      if (result && result.nextRunAt) {
        await this.schedule({
          guildId: job.guild_id,
          kind: job.kind,
          runAt: result.nextRunAt,
          payload: result.nextPayload ?? job.payload,
          dedupeKey: job.dedupe_key ?? undefined,
          maxAttempts: job.max_attempts,
        });
        log.info({ nextRunAt: result.nextRunAt.toISOString() }, 'recurring job rescheduled');
      }
    } catch (err) {
      const permanent = err instanceof PermanentJobError || !handler;
      const exhausted = job.attempts >= job.max_attempts;
      const now = this.now();
      if (permanent || exhausted) {
        await this.db.query(
          `UPDATE bot.scheduled_jobs
           SET status = 'failed', last_error = $2, finished_at = $3, locked_at = NULL, updated_at = now()
           WHERE id = $1`,
          [job.id, errorText(err), now],
        );
        log.error({ err, permanent }, 'job failed permanently');
      } else {
        const retryAt = new Date(now.getTime() + backoffMs(job.attempts, this.random));
        await this.db.query(
          `UPDATE bot.scheduled_jobs
           SET status = 'pending', run_at = $2, last_error = $3, locked_at = NULL, updated_at = now()
           WHERE id = $1`,
          [job.id, retryAt, errorText(err)],
        );
        log.warn({ err, retryAt: retryAt.toISOString() }, 'job failed; will retry');
        this.nudge(retryAt);
      }
    }
  }

  /** Wake the loop at `runAt` if that is before the next regular poll. */
  nudge(runAt: Date): void {
    if (this.stopped) return;
    const delay = runAt.getTime() - this.now().getTime();
    if (delay >= this.pollMs) return;
    const at = Date.now() + Math.max(0, delay);
    if (this.nudgeAt !== null && this.nudgeAt <= at) return;
    if (this.nudgeTimer) clearTimeout(this.nudgeTimer);
    this.nudgeAt = at;
    this.nudgeTimer = setTimeout(() => {
      this.nudgeTimer = null;
      this.nudgeAt = null;
      void this.safeTick();
    }, Math.max(0, delay) + 50);
    this.nudgeTimer.unref();
  }

  private async safeTick(): Promise<void> {
    try {
      await this.tick();
    } catch (err) {
      this.log.error({ err }, 'scheduler tick failed');
    }
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.timer = setInterval(() => void this.safeTick(), this.pollMs);
    this.timer.unref();
    void this.safeTick();
    this.log.info({ pollMs: this.pollMs, kinds: [...this.handlers.keys()] }, 'scheduler started');
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    if (this.nudgeTimer) clearTimeout(this.nudgeTimer);
    this.timer = null;
    this.nudgeTimer = null;
    this.nudgeAt = null;
    if (this.running) await this.running.catch(() => undefined);
  }
}

let instance: Scheduler | null = null;

export function initScheduler(db: Queryable, opts?: SchedulerOptions): Scheduler {
  instance = new Scheduler(db, opts);
  return instance;
}

export function getScheduler(): Scheduler {
  if (!instance) throw new Error('Scheduler not initialised');
  return instance;
}
