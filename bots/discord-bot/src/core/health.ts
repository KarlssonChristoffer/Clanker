/**
 * Health snapshot for `GET /health` (docker healthcheck, runbook verification, hub).
 * Discord or DB down → HTTP 503. Jev never makes the bot unhealthy; it only reports its breaker state.
 */
import { Status, type Client } from 'discord.js';
import { getPool } from '../db.js';

export type JevHealth = 'closed' | 'open' | 'half-open' | 'disabled';

export type HealthBody = {
  discord: 'ready' | 'down';
  db: 'ok' | 'fail';
  jev: JevHealth;
  uptime: number;
  version: string;
};

let jevProvider: () => JevHealth = () => 'disabled';

export function setJevHealthProvider(provider: () => JevHealth): void {
  jevProvider = provider;
}

async function checkDb(timeoutMs: number): Promise<boolean> {
  try {
    const pool = getPool();
    const query = pool.query('SELECT 1');
    const timeout = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('db health timeout')), timeoutMs).unref();
    });
    await Promise.race([query, timeout]);
    return true;
  } catch {
    return false;
  }
}

export async function getHealth(client: Client, version: string): Promise<{ status: 200 | 503; body: HealthBody }> {
  const discordReady = client.isReady() && client.ws.status === Status.Ready;
  const dbOk = await checkDb(2_000);
  let jev: JevHealth;
  try {
    jev = jevProvider();
  } catch {
    jev = 'disabled';
  }
  const body: HealthBody = {
    discord: discordReady ? 'ready' : 'down',
    db: dbOk ? 'ok' : 'fail',
    jev,
    uptime: Math.round(process.uptime()),
    version,
  };
  return { status: discordReady && dbOk ? 200 : 503, body };
}
