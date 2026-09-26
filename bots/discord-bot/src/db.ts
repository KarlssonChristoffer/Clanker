import pg from 'pg';

let pool: pg.Pool | null = null;

/** Hosted Postgres (Supabase) needs TLS; local/Docker Postgres does not. PGSSLMODE overrides. */
function shouldUseSsl(databaseUrl: string): boolean {
  if (process.env.PGSSLMODE === 'disable') return false;
  if (process.env.PGSSLMODE === 'require') return true;
  return /supabase\.(co|com)|pooler\.supabase\.com/i.test(databaseUrl);
}

export function initDb(databaseUrl: string): pg.Pool {
  pool = new pg.Pool({
    connectionString: databaseUrl,
    max: 5,
    connectionTimeoutMillis: 10_000,
    ssl: shouldUseSsl(databaseUrl) ? { rejectUnauthorized: false } : undefined,
  });
  return pool;
}

export function getPool(): pg.Pool {
  if (!pool) {
    throw new Error('DB pool not initialised — call initDb() before using getPool()');
  }
  return pool;
}

export async function closeDb(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

/**
 * Minimal query interface shared by core modules (scheduler, feature flags, …) so they can run
 * against the real pool in production and an in-process Postgres (PGlite) in tests.
 */
export type Queryable = {
  query: <R = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<{ rows: R[]; rowCount: number | null }>;
};

export const db: Queryable = {
  async query<R>(sql: string, params?: unknown[]) {
    const res = await getPool().query(sql, params);
    return { rows: res.rows as R[], rowCount: res.rowCount };
  },
};
