/**
 * Jev persistence: call statistics (bot.jev_calls) and per-user opt-out (bot.jev_optout).
 * Opted-out users' messages are never sent to Jev: every feature that builds state from messages
 * filters through `isOptedOut` / `optedOutSet`.
 */
import type { Queryable } from '../db.js';
import { childLogger } from '../core/logger.js';
import type { JevCallRecord } from './client.js';

const log = childLogger('jev-store');

export function persistJevCall(db: Queryable, r: JevCallRecord): void {
  void db
    .query(
      `INSERT INTO bot.jev_calls
         (feature, guild_id, model, outcome, http_status, attempts, question_count,
          input_tokens, output_tokens, latency_ms, request_id, error)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        r.feature, r.guildId, r.model, r.outcome, r.httpStatus, r.attempts, r.questionCount,
        r.inputTokens, r.outputTokens, r.latencyMs, r.requestId, r.error,
      ],
    )
    .catch((err) => log.warn({ err }, 'could not persist jev call'));
}

export type JevStatsRow = {
  calls: number;
  ok: number;
  errors: number;
  breaker_rejections: number;
  input_tokens: number;
  output_tokens: number;
  p50_ms: number | null;
  p95_ms: number | null;
  last_model: string | null;
};

/** Aggregates since `since` (null = all time). */
export async function queryJevStats(db: Queryable, since: Date | null): Promise<JevStatsRow> {
  const res = await db.query<{
    calls: string;
    ok: string;
    errors: string;
    breaker_rejections: string;
    input_tokens: string | null;
    output_tokens: string | null;
    p50_ms: number | null;
    p95_ms: number | null;
    last_model: string | null;
  }>(
    `SELECT count(*)::text AS calls,
            count(*) FILTER (WHERE outcome = 'ok')::text AS ok,
            count(*) FILTER (WHERE outcome NOT IN ('ok', 'breaker_open'))::text AS errors,
            count(*) FILTER (WHERE outcome = 'breaker_open')::text AS breaker_rejections,
            COALESCE(sum(input_tokens), 0)::text AS input_tokens,
            COALESCE(sum(output_tokens), 0)::text AS output_tokens,
            percentile_cont(0.5) WITHIN GROUP (ORDER BY latency_ms) FILTER (WHERE outcome = 'ok') AS p50_ms,
            percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms) FILTER (WHERE outcome = 'ok') AS p95_ms,
            (SELECT model FROM bot.jev_calls WHERE model IS NOT NULL ORDER BY id DESC LIMIT 1) AS last_model
     FROM bot.jev_calls
     WHERE $1::timestamptz IS NULL OR created_at >= $1::timestamptz`,
    [since],
  );
  const r = res.rows[0]!;
  return {
    calls: Number(r.calls),
    ok: Number(r.ok),
    errors: Number(r.errors),
    breaker_rejections: Number(r.breaker_rejections),
    input_tokens: Number(r.input_tokens ?? 0),
    output_tokens: Number(r.output_tokens ?? 0),
    p50_ms: r.p50_ms === null ? null : Math.round(Number(r.p50_ms)),
    p95_ms: r.p95_ms === null ? null : Math.round(Number(r.p95_ms)),
    last_model: r.last_model,
  };
}

/** In-memory mirror of bot.jev_optout (loaded at startup, updated by /jev av|på). */
export class JevOptOut {
  private users = new Set<string>();
  private loaded = false;

  constructor(private readonly db: Queryable) {}

  async load(): Promise<void> {
    const res = await this.db.query<{ user_id: string }>('SELECT user_id FROM bot.jev_optout');
    this.users = new Set(res.rows.map((r) => r.user_id));
    this.loaded = true;
    log.info({ count: this.users.size }, 'jev opt-outs loaded');
  }

  /** Fails closed: before the list is loaded nobody is considered opted in. */
  isOptedOut(userId: string): boolean {
    return !this.loaded || this.users.has(userId);
  }

  async optOut(userId: string): Promise<void> {
    await this.db.query('INSERT INTO bot.jev_optout (user_id) VALUES ($1) ON CONFLICT DO NOTHING', [userId]);
    this.users.add(userId);
  }

  async optIn(userId: string): Promise<void> {
    await this.db.query('DELETE FROM bot.jev_optout WHERE user_id = $1', [userId]);
    this.users.delete(userId);
  }
}

let optOutInstance: JevOptOut | null = null;

export function initJevOptOut(db: Queryable): JevOptOut {
  optOutInstance = new JevOptOut(db);
  return optOutInstance;
}

export function jevOptOut(): JevOptOut {
  if (!optOutInstance) throw new Error('Jev opt-out not initialised');
  return optOutInstance;
}
