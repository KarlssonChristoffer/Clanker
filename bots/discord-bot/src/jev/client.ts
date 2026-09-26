/**
 * Jev (TypeSafe System One) client.
 *
 * - Typed questions/answers (see types.ts); the pinned model (JEV_MODEL, default jev-1.13.0) is sent
 *   on every call and the `model` that actually answered is logged.
 * - Per-attempt timeout (AbortSignal.timeout), retries with exponential backoff on network errors,
 *   408, 429 and 5xx (incl. 529 overloaded); honours retry-after / retry-after-ms up to 60 s.
 * - Circuit breaker: 5 failed calls in a row → reject for 60 s, then one trial call.
 * - Semaphore caps concurrent requests (JEV_MAX_CONCURRENCY).
 * - Every call is recorded (in memory + bot.jev_calls) for /jevstats.
 * Without TYPESAFE_API_KEY the client is disabled and `ask()` throws JevDisabledError; callers
 * degrade quietly.
 */
import { childLogger } from '../core/logger.js';
import { CircuitBreaker, Semaphore, type BreakerState } from './resilience.js';
import type { JevAnswers, JevQuestions, JevResponse, JevState, JevUsage } from './types.js';

const log = childLogger('jev');

export class JevDisabledError extends Error {
  constructor() {
    super('Jev is disabled (TYPESAFE_API_KEY not set)');
    this.name = 'JevDisabledError';
  }
}

export class JevUnavailableError extends Error {
  constructor(message: string, readonly retryInMs = 0) {
    super(message);
    this.name = 'JevUnavailableError';
  }
}

export class JevApiError extends Error {
  constructor(message: string, readonly status: number | null, readonly requestId: string | null) {
    super(message);
    this.name = 'JevApiError';
  }
}

export type JevCallRecord = {
  feature: string;
  guildId: string | null;
  model: string | null;
  outcome: 'ok' | 'http_error' | 'network_error' | 'timeout' | 'breaker_open';
  httpStatus: number | null;
  attempts: number;
  questionCount: number;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  requestId: string | null;
  error: string | null;
};

export type JevCallMeta = { feature: string; guildId?: string | null };

export type JevClientOptions = {
  apiKey?: string;
  apiBase: string;
  model: string;
  timeoutMs: number;
  maxConcurrency: number;
  maxRetries?: number;
  breakerThreshold?: number;
  breakerOpenMs?: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  random?: () => number;
  /** Persists call records (bot.jev_calls). Must not throw. */
  onCall?: (record: JevCallRecord) => void;
};

const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504, 529]);
const MAX_RETRY_AFTER_MS = 60_000;

function parseRetryAfter(headers: Headers, now: number): number | null {
  const ms = headers.get('retry-after-ms');
  if (ms && Number.isFinite(Number(ms))) return Math.max(0, Number(ms));
  const raw = headers.get('retry-after');
  if (!raw) return null;
  const secs = Number(raw);
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
  const date = Date.parse(raw);
  return Number.isFinite(date) ? Math.max(0, date - now) : null;
}

function errorMessageFromBody(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  const pick = (v: unknown): string | null => {
    if (typeof v === 'string') return v;
    if (v && typeof v === 'object' && typeof (v as { message?: unknown }).message === 'string') {
      return (v as { message: string }).message;
    }
    if (Array.isArray(v)) {
      return v
        .map((x) => (x && typeof x === 'object' ? `${(x as { loc?: unknown[] }).loc?.join('.') ?? ''}: ${(x as { msg?: string }).msg ?? ''}` : String(x)))
        .join('; ');
    }
    return null;
  };
  return pick(b.error) ?? pick(b.detail) ?? pick(b.message);
}

type Stats = {
  calls: number;
  ok: number;
  errors: number;
  inputTokens: number;
  outputTokens: number;
  latencies: number[];
  lastModel: string | null;
};

export class JevClient {
  readonly enabled: boolean;
  readonly model: string;
  private readonly breaker: CircuitBreaker;
  private readonly semaphore: Semaphore;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  private readonly random: () => number;
  private readonly maxRetries: number;
  private readonly stats: Stats = { calls: 0, ok: 0, errors: 0, inputTokens: 0, outputTokens: 0, latencies: [], lastModel: null };

  constructor(private readonly opts: JevClientOptions) {
    this.enabled = Boolean(opts.apiKey);
    this.model = opts.model;
    this.now = opts.now ?? Date.now;
    this.random = opts.random ?? Math.random;
    this.breaker = new CircuitBreaker(opts.breakerThreshold ?? 5, opts.breakerOpenMs ?? 60_000, this.now);
    this.semaphore = new Semaphore(opts.maxConcurrency);
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.maxRetries = opts.maxRetries ?? 2;
  }

  get breakerState(): BreakerState {
    return this.breaker.state;
  }

  get breakerRetryInMs(): number {
    return this.breaker.retryInMs;
  }

  /** In-process counters since start (the DB has the long-term history). */
  memoryStats() {
    const sorted = [...this.stats.latencies].sort((a, b) => a - b);
    const pct = (p: number) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]! : null);
    return {
      calls: this.stats.calls,
      ok: this.stats.ok,
      errors: this.stats.errors,
      inputTokens: this.stats.inputTokens,
      outputTokens: this.stats.outputTokens,
      p50: pct(0.5),
      p95: pct(0.95),
      lastModel: this.stats.lastModel,
      inFlight: this.semaphore.inUse,
      queued: this.semaphore.waiting,
    };
  }

  private backoff(attempt: number): number {
    const base = Math.min(5_000, 500 * 2 ** attempt);
    return Math.round(base * (0.75 + this.random() * 0.5));
  }

  private record(r: JevCallRecord): void {
    this.stats.calls += 1;
    if (r.outcome === 'ok') {
      this.stats.ok += 1;
      this.stats.latencies.push(r.latencyMs);
      if (this.stats.latencies.length > 500) this.stats.latencies.shift();
    } else if (r.outcome !== 'breaker_open') {
      this.stats.errors += 1;
    }
    this.stats.inputTokens += r.inputTokens;
    this.stats.outputTokens += r.outputTokens;
    if (r.model) this.stats.lastModel = r.model;
    try {
      this.opts.onCall?.(r);
    } catch {
      /* persistence must never break a call */
    }
  }

  async ask<Q extends JevQuestions>(state: JevState, questions: Q, meta: JevCallMeta): Promise<JevResponse<Q>> {
    if (!this.enabled) throw new JevDisabledError();
    const questionCount = Object.keys(questions).length;
    if (!questionCount) throw new Error('Jev: at least one question is required');
    const base = {
      feature: meta.feature,
      guildId: meta.guildId ?? null,
      questionCount,
    };
    if (!this.breaker.tryAcquire()) {
      this.record({ ...base, model: null, outcome: 'breaker_open', httpStatus: null, attempts: 0, inputTokens: 0, outputTokens: 0, latencyMs: 0, requestId: null, error: null });
      throw new JevUnavailableError('Jev circuit breaker is open', this.breaker.retryInMs);
    }
    return this.semaphore.run(() => this.execute(state, questions, base));
  }

  private async execute<Q extends JevQuestions>(
    state: JevState,
    questions: Q,
    base: { feature: string; guildId: string | null; questionCount: number },
  ): Promise<JevResponse<Q>> {
    const body = JSON.stringify({ state, model: this.model, questions });
    const started = this.now();
    let attempt = 0;
    let lastStatus: number | null = null;
    let lastRequestId: string | null = null;
    let lastError = 'unknown error';
    let outcome: JevCallRecord['outcome'] = 'network_error';

    for (;;) {
      let retryDelay: number | null = null;
      try {
        const res = await this.fetchImpl(`${this.opts.apiBase}/v1/systemone`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.opts.apiKey}`,
            'Content-Type': 'application/json',
            'User-Agent': 'clanker-discord-bot',
          },
          body,
          signal: AbortSignal.timeout(this.opts.timeoutMs),
        });
        lastStatus = res.status;
        lastRequestId = res.headers.get('x-typesafe-request-id');
        if (res.ok) {
          const json = (await res.json()) as { model: string; answers: JevAnswers<Q>; usage?: JevUsage };
          const latencyMs = this.now() - started;
          const usage = json.usage ?? { input_tokens: 0, output_tokens: 0 };
          this.breaker.onSuccess();
          this.record({
            ...base,
            model: json.model,
            outcome: 'ok',
            httpStatus: res.status,
            attempts: attempt + 1,
            inputTokens: usage.input_tokens,
            outputTokens: usage.output_tokens,
            latencyMs,
            requestId: lastRequestId,
            error: null,
          });
          if (json.model !== this.model) {
            log.warn({ requested: this.model, answered: json.model }, 'Jev answered with a different model than pinned');
          }
          log.debug({ feature: base.feature, model: json.model, latencyMs, inputTokens: usage.input_tokens, requestId: lastRequestId }, 'jev call ok');
          return { model: json.model, answers: json.answers, usage, requestId: lastRequestId, latencyMs };
        }
        const errBody = await res.json().catch(() => null);
        lastError = `HTTP ${res.status}: ${errorMessageFromBody(errBody) ?? res.statusText}`;
        outcome = 'http_error';
        if (RETRYABLE_STATUS.has(res.status)) {
          const retryAfter = parseRetryAfter(res.headers, this.now());
          if (retryAfter !== null && retryAfter > MAX_RETRY_AFTER_MS) {
            retryDelay = null; // server asks us to wait too long: give up now
          } else {
            retryDelay = retryAfter ?? this.backoff(attempt);
          }
        }
      } catch (err) {
        const e = err as Error;
        const isTimeout = e.name === 'TimeoutError' || e.name === 'AbortError';
        outcome = isTimeout ? 'timeout' : 'network_error';
        lastError = isTimeout ? `timed out after ${this.opts.timeoutMs} ms` : e.message;
        lastStatus = null;
        retryDelay = this.backoff(attempt);
      }

      if (retryDelay === null || attempt >= this.maxRetries) break;
      attempt += 1;
      log.debug({ feature: base.feature, attempt, retryDelay, lastError }, 'retrying jev call');
      await this.sleep(retryDelay);
    }

    // 422 = our request was invalid; that is a bug in one call, not an outage, so it does not trip the breaker.
    if (lastStatus === 422) this.breaker.release();
    else this.breaker.onFailure();
    this.record({
      ...base,
      model: null,
      outcome,
      httpStatus: lastStatus,
      attempts: attempt + 1,
      inputTokens: 0,
      outputTokens: 0,
      latencyMs: this.now() - started,
      requestId: lastRequestId,
      error: lastError.slice(0, 500),
    });
    log.warn({ feature: base.feature, status: lastStatus, attempts: attempt + 1, error: lastError, breaker: this.breaker.state }, 'jev call failed');
    throw new JevApiError(lastError, lastStatus, lastRequestId);
  }
}

let instance: JevClient | null = null;

export function initJev(opts: JevClientOptions): JevClient {
  instance = new JevClient(opts);
  return instance;
}

export function jev(): JevClient {
  if (!instance) throw new Error('Jev client not initialised');
  return instance;
}

/** True for errors that mean "Jev is not available right now" (callers should degrade quietly). */
export function isJevUnavailable(err: unknown): boolean {
  return err instanceof JevDisabledError || err instanceof JevUnavailableError || err instanceof JevApiError;
}
