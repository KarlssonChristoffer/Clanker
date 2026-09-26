/**
 * In-process Postgres for tests (PGlite = real Postgres compiled to WASM; no Docker needed).
 * Applies every migration in apps/discord-hub-api/migrations in order, like the bot does at startup.
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import type { Queryable } from '../../src/core/scheduler.js';

const migrationsDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../apps/discord-hub-api/migrations',
);

export type TestDb = { pg: PGlite; db: Queryable; close: () => Promise<void> };

export async function createTestDb(): Promise<TestDb> {
  const pg = new PGlite();
  const files = readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();
  for (const f of files) {
    await pg.exec(readFileSync(path.join(migrationsDir, f), 'utf8'));
  }
  const db: Queryable = {
    async query<R>(sql: string, params?: unknown[]) {
      const res = await pg.query<R>(sql, params as unknown[] | undefined);
      return { rows: res.rows, rowCount: res.affectedRows ?? res.rows.length };
    },
  };
  return { pg, db, close: () => pg.close() };
}
