import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { JevApiError, JevClient, JevDisabledError, JevUnavailableError, type JevCallRecord } from '../src/jev/client.js';
import { CircuitBreaker, Semaphore } from '../src/jev/resilience.js';
import { choice, noul, score } from '../src/jev/types.js';

/** Scripted local stand-in for api.typesafe.ai: each request takes the next queued response. */
type Scripted = { status: number; body?: unknown; headers?: Record<string, string>; delayMs?: number };
let server: Server;
let base: string;
let script: Scripted[] = [];
let requests: { auth?: string; body: Record<string, unknown> }[] = [];

function okBody(answers: Record<string, unknown>, model = 'jev-1.13.0') {
  return { model, answers, usage: { input_tokens: 120, output_tokens: 7 } };
}

beforeAll(async () => {
  server = createServer((req: IncomingMessage, res: ServerResponse) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      requests.push({ auth: req.headers.authorization, body: raw ? JSON.parse(raw) : {} });
      const next = script.shift() ?? { status: 500, body: { detail: 'script exhausted' } };
      setTimeout(() => {
        res.writeHead(next.status, { 'content-type': 'application/json', 'x-typesafe-request-id': 'req_test', ...next.headers });
        res.end(JSON.stringify(next.body ?? {}));
      }, next.delayMs ?? 0);
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

let clock = 0;
let slept: number[] = [];
let records: JevCallRecord[] = [];

function client(extra: Partial<ConstructorParameters<typeof JevClient>[0]> = {}) {
  return new JevClient({
    apiKey: 'test-key',
    apiBase: base,
    model: 'jev-1.13.0',
    timeoutMs: 2_000,
    maxConcurrency: 2,
    now: () => clock,
    random: () => 0.5,
    sleep: async (ms) => {
      slept.push(ms);
      clock += ms;
    },
    onCall: (r) => records.push(r),
    ...extra,
  });
}

beforeEach(() => {
  script = [];
  requests = [];
  slept = [];
  records = [];
  clock = 1_000_000;
});

const questions = {
  urgent: noul('Does this convey urgency?'),
  team: choice('Which team should handle this?', { billing: 'Payments', technical: 'Bugs' }),
  mood: score('How upset is the writer?', ['calm', 'annoyed', 'furious']),
};

describe('JevClient', () => {
  it('sends the documented request and returns typed answers', async () => {
    script.push({
      status: 200,
      body: okBody({
        urgent: { type: 'noul', noul: 0.9 },
        team: { type: 'choice', choice: 'billing', probabilities: { billing: 0.8, technical: 0.2 }, confidence: 0.7 },
        mood: { type: 'score', score: 1.2, legend: { 0: 'calm', 1: 'annoyed', 2: 'furious' }, probabilities: { 0: 0.1, 1: 0.6, 2: 0.3 }, confidence: 0.5 },
      }),
    });
    const res = await client().ask('Payouts failing for 3 days!', questions, { feature: 'test', guildId: 'g1' });
    expect(requests[0]!.auth).toBe('Bearer test-key');
    expect(requests[0]!.body).toMatchObject({ state: 'Payouts failing for 3 days!', model: 'jev-1.13.0' });
    expect(res.answers.urgent.noul).toBe(0.9);
    expect(res.answers.team.choice).toBe('billing');
    expect(res.answers.mood.score).toBe(1.2);
    expect(res.requestId).toBe('req_test');
    expect(records[0]).toMatchObject({ outcome: 'ok', inputTokens: 120, attempts: 1, model: 'jev-1.13.0', guildId: 'g1' });
  });

  it('retries 429 honouring retry-after, and 529 with backoff', async () => {
    script.push({ status: 429, body: { detail: 'slow down' }, headers: { 'retry-after': '2' } });
    script.push({ status: 529, body: { detail: 'overloaded' } });
    script.push({ status: 200, body: okBody({ urgent: { type: 'noul', noul: 0.1 } }) });
    const res = await client().ask('x', { urgent: questions.urgent }, { feature: 'test' });
    expect(res.answers.urgent.noul).toBe(0.1);
    expect(slept).toEqual([2_000, 1_000]); // retry-after 2 s, then 500 ms * 2^1
    expect(records[0]).toMatchObject({ outcome: 'ok', attempts: 3 });
  });

  it('prefers retry-after-ms and gives up when the server asks for more than 60 s', async () => {
    script.push({ status: 429, headers: { 'retry-after-ms': '1500' } });
    script.push({ status: 200, body: okBody({ urgent: { type: 'noul', noul: 0.5 } }) });
    await client().ask('x', { urgent: questions.urgent }, { feature: 'test' });
    expect(slept).toEqual([1_500]);

    slept = [];
    script.push({ status: 429, headers: { 'retry-after': '120' } });
    await expect(client().ask('x', { urgent: questions.urgent }, { feature: 'test' })).rejects.toBeInstanceOf(JevApiError);
    expect(slept).toEqual([]);
  });

  it('does not retry client errors and surfaces the error detail', async () => {
    script.push({ status: 422, body: { detail: [{ loc: ['body', 'questions'], msg: 'field required' }] } });
    const err = await client().ask('x', { urgent: questions.urgent }, { feature: 'test' }).catch((e) => e);
    expect(err).toBeInstanceOf(JevApiError);
    expect((err as JevApiError).status).toBe(422);
    expect((err as Error).message).toContain('field required');
    expect(requests).toHaveLength(1);
  });

  it('opens the breaker after 5 failed calls, rejects for 60 s, then allows a trial', async () => {
    const c = client({ maxRetries: 0 });
    for (let i = 0; i < 5; i++) {
      script.push({ status: 500, body: { detail: 'down' } });
      await expect(c.ask('x', { urgent: questions.urgent }, { feature: 'test' })).rejects.toBeInstanceOf(JevApiError);
    }
    expect(c.breakerState).toBe('open');
    const before = requests.length;
    await expect(c.ask('x', { urgent: questions.urgent }, { feature: 'test' })).rejects.toBeInstanceOf(JevUnavailableError);
    expect(requests.length).toBe(before); // rejected locally
    expect(records.at(-1)?.outcome).toBe('breaker_open');

    clock += 60_000;
    expect(c.breakerState).toBe('half-open');
    script.push({ status: 200, body: okBody({ urgent: { type: 'noul', noul: 1 } }) });
    await c.ask('x', { urgent: questions.urgent }, { feature: 'test' });
    expect(c.breakerState).toBe('closed');
  });

  it('times out slow responses per attempt', async () => {
    script.push({ status: 200, body: okBody({}), delayMs: 500 });
    const c = client({ timeoutMs: 100, maxRetries: 0 });
    await expect(c.ask('x', { urgent: questions.urgent }, { feature: 'test' })).rejects.toBeInstanceOf(JevApiError);
    expect(records[0]?.outcome).toBe('timeout');
  });

  it('is disabled without an API key', async () => {
    const c = client({ apiKey: undefined });
    expect(c.enabled).toBe(false);
    await expect(c.ask('x', { urgent: questions.urgent }, { feature: 'test' })).rejects.toBeInstanceOf(JevDisabledError);
    expect(requests).toHaveLength(0);
  });
});

describe('CircuitBreaker', () => {
  it('re-opens when the half-open trial fails, and release() frees the trial slot', () => {
    let t = 0;
    const b = new CircuitBreaker(2, 1_000, () => t);
    b.onFailure();
    b.onFailure();
    expect(b.state).toBe('open');
    t = 1_000;
    expect(b.tryAcquire()).toBe(true);
    expect(b.tryAcquire()).toBe(false); // only one trial at a time
    b.onFailure();
    expect(b.state).toBe('open');
    t = 2_000;
    expect(b.tryAcquire()).toBe(true);
    b.release();
    expect(b.tryAcquire()).toBe(true);
  });
});

describe('Semaphore', () => {
  it('never runs more than max tasks at once', async () => {
    const s = new Semaphore(2);
    let active = 0;
    let peak = 0;
    const task = () =>
      s.run(async () => {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, 5));
        active -= 1;
      });
    await Promise.all(Array.from({ length: 7 }, task));
    expect(peak).toBe(2);
    expect(s.inUse).toBe(0);
  });
});
