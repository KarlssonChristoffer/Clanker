import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import type pg from 'pg';
import { HEARTBEAT_STALE_MS, getBotGuildLive, getBotLiveHealth } from '../src/bot-live.js';

const migrationsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../migrations');

let db: PGlite;
let pool: pg.Pool;
const NOW = new Date('2026-10-01T18:00:00Z').getTime();

beforeEach(async () => {
  db = new PGlite();
  for (const f of readdirSync(migrationsDir).filter((x) => x.endsWith('.sql')).sort()) {
    await db.exec(readFileSync(path.join(migrationsDir, f), 'utf8'));
  }
  pool = { query: (sql: string, params?: unknown[]) => db.query(sql, params) } as unknown as pg.Pool;
}, 60_000);

afterEach(async () => {
  await db.close();
});

async function heartbeat(ageMs: number, ready = true, guilds = ['111111111111111111']) {
  await db.query(
    `INSERT INTO bot.runtime_status (instance, discord_ready, guild_ids, last_heartbeat_at, last_event_at)
     VALUES ('discord-bot', $1, $2, $3, $3)`,
    [ready, guilds, new Date(NOW - ageMs)],
  );
}

describe('bot live status from Postgres', () => {
  it('is degraded without a database or heartbeat', async () => {
    expect((await getBotLiveHealth(null, NOW)).gateway_connected).toBe(false);
    const h = await getBotLiveHealth(pool, NOW);
    expect(h.gateway_connected).toBe(false);
    expect(h.degraded_reason).toMatch(/heartbeat/);
  });

  it('is connected with a fresh heartbeat and lists voice users', async () => {
    await heartbeat(10_000);
    await db.query(
      `INSERT INTO bot.guild_voice_states (guild_id, user_id, channel_id, username, is_muted)
       VALUES ('111111111111111111', '222222222222222222', '333333333333333333', 'kalle', true)`,
    );
    const h = await getBotLiveHealth(pool, NOW);
    expect(h).toMatchObject({ gateway_connected: true, degraded: false, guilds_subscribed: ['111111111111111111'] });
    const live = await getBotGuildLive(pool, '111111111111111111', NOW);
    expect(live.gateway_connected).toBe(true);
    expect(live.gateway_degraded).toBe(false);
    expect(live.voice_users).toEqual([
      {
        user_id: '222222222222222222',
        channel_id: '333333333333333333',
        session_id: null,
        self_mute: true,
        self_deaf: false,
        mute: null,
        deaf: null,
      },
    ]);
  });

  it('treats a stale heartbeat or a not-ready bot as disconnected', async () => {
    await heartbeat(HEARTBEAT_STALE_MS + 1_000);
    expect((await getBotLiveHealth(pool, NOW)).degraded_reason).toMatch(/stale/);
    await db.query(`UPDATE bot.runtime_status SET last_heartbeat_at = $1, discord_ready = false`, [new Date(NOW)]);
    const live = await getBotGuildLive(pool, '111111111111111111', NOW);
    expect(live.gateway_connected).toBe(false);
    expect(live.voice_users).toEqual([]);
  });

  it('flags guilds the bot is not in', async () => {
    await heartbeat(1_000, true, ['999999999999999999']);
    const live = await getBotGuildLive(pool, '111111111111111111', NOW);
    expect(live.gateway_degraded_reason).toMatch(/not a member/);
  });
});
