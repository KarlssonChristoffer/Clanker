import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PermanentJobError, Scheduler, backoffMs } from '../src/core/scheduler.js';
import { createTestDb, type TestDb } from './helpers/test-db.js';

let t: TestDb;
let clock: Date;
const now = () => clock;
const advance = (ms: number) => {
  clock = new Date(clock.getTime() + ms);
};

function makeScheduler(): Scheduler {
  return new Scheduler(t.db, { now, random: () => 0.5, pollMs: 60_000, staleAfterMs: 10 * 60_000 });
}

type Row = {
  id: string;
  kind: string;
  status: string;
  attempts: number;
  last_error: string | null;
  run_at: Date;
  dedupe_key: string | null;
  payload: unknown;
};

async function jobs(): Promise<Row[]> {
  const res = await t.db.query<Row>(
    'SELECT id::text AS id, kind, status, attempts, last_error, run_at, dedupe_key, payload FROM bot.scheduled_jobs ORDER BY id',
  );
  return res.rows;
}

beforeEach(async () => {
  t = await createTestDb();
  clock = new Date('2026-10-01T18:00:00Z');
}, 60_000);

afterEach(async () => {
  await t.close();
});

describe('backoffMs', () => {
  it('doubles from 30 s and caps at 1 h (±20 % jitter)', () => {
    expect(backoffMs(1, () => 0.5)).toBe(30_000);
    expect(backoffMs(2, () => 0.5)).toBe(60_000);
    expect(backoffMs(3, () => 0.5)).toBe(120_000);
    expect(backoffMs(20, () => 0.5)).toBe(3_600_000);
    expect(backoffMs(1, () => 0)).toBe(24_000);
    expect(backoffMs(1, () => 1)).toBe(36_000);
  });
});

describe('Scheduler', () => {
  it('runs due jobs only, and marks them done', async () => {
    const s = makeScheduler();
    const seen: unknown[] = [];
    s.register<{ text: string }>('remind', async (p) => {
      seen.push(p.text);
    });
    await s.schedule({ kind: 'remind', runAt: new Date('2026-10-01T17:59:00Z'), payload: { text: 'nu' } });
    await s.schedule({ kind: 'remind', runAt: new Date('2026-10-01T19:00:00Z'), payload: { text: 'sen' } });

    expect(await s.tick()).toBe(1);
    expect(seen).toEqual(['nu']);
    const rows = await jobs();
    expect(rows.map((r) => r.status)).toEqual(['done', 'pending']);

    advance(60 * 60_000);
    expect(await s.tick()).toBe(1);
    expect(seen).toEqual(['nu', 'sen']);
  });

  it('retries with backoff and then succeeds', async () => {
    const s = makeScheduler();
    let calls = 0;
    s.register('flaky', async () => {
      calls += 1;
      if (calls < 3) throw new Error(`boom ${calls}`);
    });
    await s.schedule({ kind: 'flaky', runAt: clock });

    await s.tick();
    let [job] = await jobs();
    expect(job!.status).toBe('pending');
    expect(job!.attempts).toBe(1);
    expect(job!.last_error).toContain('boom 1');
    expect(new Date(job!.run_at).getTime()).toBe(clock.getTime() + 30_000);

    await s.tick(); // not due yet
    expect(calls).toBe(1);

    advance(30_000);
    await s.tick();
    advance(60_000);
    await s.tick();
    [job] = await jobs();
    expect(calls).toBe(3);
    expect(job!.status).toBe('done');
    expect(job!.attempts).toBe(3);
    expect(job!.last_error).toBeNull();
  });

  it('fails after max_attempts', async () => {
    const s = makeScheduler();
    s.register('broken', async () => {
      throw new Error('always');
    });
    await s.schedule({ kind: 'broken', runAt: clock, maxAttempts: 2 });
    await s.tick();
    advance(60 * 60_000);
    await s.tick();
    const [job] = await jobs();
    expect(job!.status).toBe('failed');
    expect(job!.attempts).toBe(2);
    expect(job!.last_error).toContain('always');
  });

  it('fails immediately on PermanentJobError and on unknown kinds', async () => {
    const s = makeScheduler();
    s.register('gone', async () => {
      throw new PermanentJobError('channel deleted');
    });
    await s.schedule({ kind: 'gone', runAt: clock });
    await s.schedule({ kind: 'nobody-handles-this', runAt: clock });
    await s.tick();
    const rows = await jobs();
    expect(rows.map((r) => [r.status, r.attempts])).toEqual([
      ['failed', 1],
      ['failed', 1],
    ]);
    expect(rows[1]!.last_error).toContain('no handler');
  });

  it('replaces the pending job that has the same dedupe key, and can cancel it', async () => {
    const s = makeScheduler();
    await s.schedule({ kind: 'ping', runAt: new Date('2026-10-02T18:00:00Z'), dedupeKey: 'raid-ping:1', payload: { v: 1 } });
    await s.schedule({ kind: 'ping', runAt: new Date('2026-10-02T19:00:00Z'), dedupeKey: 'raid-ping:1', payload: { v: 2 } });
    let rows = await jobs();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.payload).toEqual({ v: 2 });
    expect(new Date(rows[0]!.run_at).toISOString()).toBe('2026-10-02T19:00:00.000Z');
    expect(await s.hasPending('raid-ping:1')).toBe(true);

    expect(await s.cancel('raid-ping:1')).toBe(1);
    rows = await jobs();
    expect(rows[0]!.status).toBe('cancelled');
    expect(await s.hasPending('raid-ping:1')).toBe(false);
    // A new job with the same key is allowed once the old one is no longer active.
    await s.schedule({ kind: 'ping', runAt: clock, dedupeKey: 'raid-ping:1' });
    expect(await jobs()).toHaveLength(2);
  });

  it('re-enqueues recurring jobs with the same dedupe key', async () => {
    const s = makeScheduler();
    s.register('weekly', async (_p, { job }) => ({
      nextRunAt: new Date(new Date(job.run_at).getTime() + 7 * 24 * 3600_000),
    }));
    await s.schedule({ kind: 'weekly', runAt: clock, dedupeKey: 'weekly:g1', guildId: 'g1' });
    await s.tick();
    const rows = await jobs();
    expect(rows.map((r) => r.status)).toEqual(['done', 'pending']);
    expect(rows[1]!.dedupe_key).toBe('weekly:g1');
    expect(new Date(rows[1]!.run_at).toISOString()).toBe('2026-10-08T18:00:00.000Z');
  });

  it('survives a restart: a new scheduler instance runs jobs scheduled by the old one', async () => {
    const before = makeScheduler();
    await before.schedule({ kind: 'remind', runAt: new Date(clock.getTime() + 5 * 60_000), payload: { n: 1 } });
    await before.stop();

    const after = makeScheduler();
    let ran = 0;
    after.register('remind', async () => {
      ran += 1;
    });
    advance(5 * 60_000);
    await after.tick();
    expect(ran).toBe(1);
  });

  it('recovers jobs left running by a crashed worker', async () => {
    const s = makeScheduler();
    await s.schedule({ kind: 'remind', runAt: clock });
    // Simulate a crash mid-job: claimed (running) but never finished.
    await t.db.query(`UPDATE bot.scheduled_jobs SET status = 'running', locked_at = $1, attempts = 1`, [clock]);
    let ran = 0;
    s.register('remind', async () => {
      ran += 1;
    });
    await s.tick();
    expect(ran).toBe(0); // lock still fresh
    advance(11 * 60_000);
    await s.tick();
    expect(ran).toBe(1);
    const [job] = await jobs();
    expect(job!.status).toBe('done');
    expect(job!.attempts).toBe(2);
  });
});
