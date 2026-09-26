import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import type pg from 'pg';
import { fetchQuotes } from '../src/quotes.js';

const migrationsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../migrations');
let db: PGlite;
const asPool = (x: PGlite) => ({ query: (sql: string, params?: unknown[]) => x.query(sql, params) }) as unknown as pg.Pool;

beforeEach(async () => {
  db = new PGlite();
}, 60_000);
afterEach(async () => {
  await db.close();
});

describe('hub quote book', () => {
  it('reports unavailable before the bot migrations ran, and without a DB', async () => {
    await db.exec('CREATE SCHEMA bot;');
    expect(await fetchQuotes(asPool(db), 'g1', { limit: 5, random: false })).toEqual({ available: false, quotes: [] });
    expect(await fetchQuotes(null, 'g1', { limit: 5, random: false })).toEqual({ available: false, quotes: [] });
  });

  it('returns the newest quotes for the guild, limited', async () => {
    for (const f of readdirSync(migrationsDir).filter((x) => x.endsWith('.sql')).sort()) {
      await db.exec(readFileSync(path.join(migrationsDir, f), 'utf8'));
    }
    await db.exec(`
      INSERT INTO bot.quotes (guild_id, channel_id, message_id, author_id, author_name, content, saved_by, said_at, saved_at) VALUES
        ('g1','c','m1','u','Kalle','första','u2','2026-09-01T10:00:00Z','2026-09-01T10:00:00Z'),
        ('g1','c','m2','u','Lisa','andra','u2','2026-09-02T10:00:00Z','2026-09-02T10:00:00Z'),
        ('g2','c','m3','u','Other','annan server','u2','2026-09-03T10:00:00Z','2026-09-03T10:00:00Z');
    `);
    const res = await fetchQuotes(asPool(db), 'g1', { limit: 1, random: false });
    expect(res.available).toBe(true);
    expect(res.quotes).toEqual([{ id: expect.any(String), content: 'andra', author_name: 'Lisa', said_at: '2026-09-02T10:00:00.000Z' }]);
    const all = await fetchQuotes(asPool(db), 'g1', { limit: 10, random: true });
    expect(all.quotes.map((q) => q.content).sort()).toEqual(['andra', 'första']);
  });
});
