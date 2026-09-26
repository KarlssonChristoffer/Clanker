import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { reflexEmoji } from '../src/jev/reflexes.js';
import { oracleQuip } from '../src/commands/orakel.js';
import { CANDIDATES, PROPERTIES } from '../src/jev/mindreader/data.js';
import { loadMatrix, matrixKey, missingCandidates, warmupMatrix } from '../src/jev/mindreader/matrix.js';
import type { JevClient } from '../src/jev/client.js';
import { logger } from '../src/core/logger.js';
import { createTestDb, type TestDb } from './helpers/test-db.js';

describe('emoji reflex decision', () => {
  it('reacts only on a confident, non-"none" choice', () => {
    expect(reflexEmoji({ choice: 'laugh', confidence: 0.8 })).toBe('😂');
    expect(reflexEmoji({ choice: 'laugh', confidence: 0.74 })).toBeNull();
    expect(reflexEmoji({ choice: 'none', confidence: 0.99 })).toBeNull();
    expect(reflexEmoji({ choice: 'bogus', confidence: 0.99 })).toBeNull();
  });
});

describe('oracle quips', () => {
  it('match the probability bucket', () => {
    const first = () => 0;
    expect(oracleQuip(0.95, first)).toBe('Stjärnorna är överens. Så är det.');
    expect(oracleQuip(0.7, first)).toBe('Troligen. Men säg inte att jag sa det.');
    expect(oracleQuip(0.5, first)).toBe('Dimman är tjock. Fråga igen efter kaffet.');
    expect(oracleQuip(0.2, first)).toBe('Tveksamt. Mycket tveksamt.');
    expect(oracleQuip(0.01, first)).toBe('Nej. Bara nej.');
  });
});

describe('mind-reader data', () => {
  it('has ~80 unique candidates and ~30 unique properties', () => {
    expect(CANDIDATES.length).toBeGreaterThanOrEqual(75);
    expect(PROPERTIES.length).toBeGreaterThanOrEqual(28);
    expect(new Set(CANDIDATES.map((c) => c.id)).size).toBe(CANDIDATES.length);
    expect(new Set(PROPERTIES.map((p) => p.id)).size).toBe(PROPERTIES.length);
    for (const cat of ['djur', 'föremål', 'mat', 'plats', 'wow']) {
      expect(CANDIDATES.filter((c) => c.category === cat).length).toBeGreaterThanOrEqual(8);
    }
  });
});

describe('mind-reader matrix cache', () => {
  let t: TestDb;
  beforeEach(async () => {
    t = await createTestDb();
  }, 60_000);
  afterEach(async () => {
    await t.close();
  });

  function fakeJev(failAfter = Infinity): JevClient {
    let calls = 0;
    return {
      model: 'jev-test',
      enabled: true,
      async ask(state: { thing: string }, questions: Record<string, unknown>) {
        calls += 1;
        if (calls > failAfter) {
          const { JevUnavailableError } = await import('../src/jev/client.js');
          throw new JevUnavailableError('down');
        }
        const answers = Object.fromEntries(
          Object.keys(questions).map((k, i) => [k, { type: 'noul', noul: ((state.thing.length + i) % 10) / 10 }]),
        );
        return { model: 'jev-test', answers, usage: { input_tokens: 1, output_tokens: 1 }, requestId: null, latencyMs: 1 };
      },
    } as unknown as JevClient;
  }

  it('fills only what is missing and loads complete candidates', async () => {
    const silent = logger.child({});
    silent.level = 'silent';
    const first = await warmupMatrix(t.db, fakeJev(10), silent);
    expect(first.computed).toBeGreaterThanOrEqual(10);
    expect(first.remaining).toBe(CANDIDATES.length - first.computed);

    const partial = await loadMatrix(t.db, 'jev-test');
    expect(partial.candidates.length).toBe(first.computed);
    expect(partial.matrix[0]).toHaveLength(PROPERTIES.length);

    const second = await warmupMatrix(t.db, fakeJev(), silent);
    expect(second.remaining).toBe(0);
    expect(await missingCandidates(t.db, 'jev-test')).toEqual([]);
    const full = await loadMatrix(t.db, 'jev-test');
    expect(full.candidates.length).toBe(CANDIDATES.length);
    // Stored under a versioned key so a data change forces a recompute.
    const rows = await t.db.query<{ model: string }>('SELECT DISTINCT model FROM bot.mindreader_matrix');
    expect(rows.rows.map((r) => r.model)).toEqual([matrixKey('jev-test')]);
  });
});
