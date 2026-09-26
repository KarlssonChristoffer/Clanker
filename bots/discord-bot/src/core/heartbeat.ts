/**
 * Heartbeat in bot.runtime_status so hub-api can show live status without its own gateway connection.
 * The bot is the single gateway owner; hub-api treats a heartbeat older than ~90 s as disconnected.
 */
import { Events, Status, type Client } from 'discord.js';
import type { Queryable } from '../db.js';
import { childLogger } from './logger.js';

const log = childLogger('heartbeat');
const INSTANCE = 'discord-bot';
const INTERVAL_MS = 30_000;

export function startHeartbeat(client: Client, db: Queryable, version: string): () => Promise<void> {
  let lastEventAt: Date | null = null;
  const onRaw = () => {
    lastEventAt = new Date();
  };
  client.on(Events.Raw, onRaw);

  const beat = async (ready: boolean) => {
    try {
      await db.query(
        `INSERT INTO bot.runtime_status (instance, discord_ready, version, guild_ids, started_at, last_heartbeat_at, last_event_at)
         VALUES ($1, $2, $3, $4, now(), now(), $5)
         ON CONFLICT (instance) DO UPDATE SET
           discord_ready = EXCLUDED.discord_ready,
           version = EXCLUDED.version,
           guild_ids = EXCLUDED.guild_ids,
           last_heartbeat_at = now(),
           last_event_at = COALESCE(EXCLUDED.last_event_at, bot.runtime_status.last_event_at)`,
        [INSTANCE, ready, version, [...client.guilds.cache.keys()], lastEventAt],
      );
    } catch (err) {
      log.warn({ err }, 'heartbeat write failed');
    }
  };

  // Fresh start: record started_at once.
  void db
    .query(
      `INSERT INTO bot.runtime_status (instance, discord_ready, version, started_at, last_heartbeat_at)
       VALUES ($1, false, $2, now(), now())
       ON CONFLICT (instance) DO UPDATE SET discord_ready = false, version = EXCLUDED.version,
         started_at = now(), last_heartbeat_at = now()`,
      [INSTANCE, version],
    )
    .catch((err) => log.warn({ err }, 'heartbeat init failed'));

  const isReady = () => client.isReady() && client.ws.status === Status.Ready;
  client.once(Events.ClientReady, () => void beat(true));
  const timer = setInterval(() => void beat(isReady()), INTERVAL_MS);
  timer.unref();

  return async () => {
    clearInterval(timer);
    client.off(Events.Raw, onRaw);
    await beat(false);
  };
}
