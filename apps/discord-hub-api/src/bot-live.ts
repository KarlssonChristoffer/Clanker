/**
 * Live bot status for the hub, read from Postgres. The Discord bot is the only process with a
 * gateway connection; it writes voice state to bot.guild_voice_states and a heartbeat to
 * bot.runtime_status every 30 s. The response shapes match the old in-process gateway so the
 * dashboard keeps working unchanged.
 */
import type pg from "pg";
import type { GuildLivePayload, LiveHealthPayload, LiveVoiceUser } from "./bot-guild-types.js";

/** Heartbeat older than this counts as "bot offline" (3 missed 30 s beats). */
export const HEARTBEAT_STALE_MS = 90_000;
/** GUILDS | GUILD_VOICE_STATES — reported for compatibility with the old payload. */
const REPORTED_INTENTS = (1 << 0) | (1 << 7);

type RuntimeRow = {
  discord_ready: boolean;
  guild_ids: string[];
  last_heartbeat_at: Date;
  last_event_at: Date | null;
};

type BotStatus = {
  connected: boolean;
  row: RuntimeRow | null;
  degradedReason: string | null;
};

async function readBotStatus(pool: pg.Pool | null, now: number): Promise<BotStatus> {
  if (!pool) {
    return { connected: false, row: null, degradedReason: "Database not configured on hub-api (DATABASE_URL)" };
  }
  try {
    const res = await pool.query<RuntimeRow>(
      `SELECT discord_ready, guild_ids, last_heartbeat_at, last_event_at
       FROM bot.runtime_status WHERE instance = 'discord-bot'`,
    );
    const row = res.rows[0] ?? null;
    if (!row) {
      return { connected: false, row: null, degradedReason: "discord-bot has not reported a heartbeat yet" };
    }
    const age = now - new Date(row.last_heartbeat_at).getTime();
    if (age > HEARTBEAT_STALE_MS) {
      return {
        connected: false,
        row,
        degradedReason: `discord-bot heartbeat is stale (${Math.round(age / 1000)} s old) — is the bot running?`,
      };
    }
    if (!row.discord_ready) {
      return { connected: false, row, degradedReason: "discord-bot is running but not connected to Discord" };
    }
    return { connected: true, row, degradedReason: null };
  } catch (err) {
    const code = (err as { code?: string }).code;
    // 42P01 = undefined_table (migration 015 not applied yet).
    const reason = code === "42P01" ? "bot.runtime_status missing — restart discord-bot to run migrations" : "Could not read bot status";
    return { connected: false, row: null, degradedReason: reason };
  }
}

function iso(d: Date | null | undefined): string | null {
  return d ? new Date(d).toISOString() : null;
}

export async function getBotLiveHealth(pool: pg.Pool | null, now = Date.now()): Promise<LiveHealthPayload> {
  const status = await readBotStatus(pool, now);
  return {
    gateway_connected: status.connected,
    last_heartbeat_ack_at: iso(status.row?.last_heartbeat_at),
    last_dispatch_at: iso(status.row?.last_event_at),
    guilds_subscribed: status.row?.guild_ids ?? [],
    reconnect_attempt: 0,
    intents: REPORTED_INTENTS,
    degraded: !status.connected,
    degraded_reason: status.degradedReason,
  };
}

type VoiceRow = {
  user_id: string;
  channel_id: string;
  is_muted: boolean;
  is_deafened: boolean;
};

export async function getBotGuildLive(
  pool: pg.Pool | null,
  guildId: string,
  now = Date.now(),
): Promise<GuildLivePayload> {
  const status = await readBotStatus(pool, now);
  let degradedReason = status.degradedReason;
  if (status.row && !status.row.guild_ids.includes(guildId)) {
    degradedReason = "discord-bot is not a member of this guild";
  }
  let voiceUsers: LiveVoiceUser[] = [];
  if (pool) {
    try {
      const res = await pool.query<VoiceRow>(
        `SELECT user_id, channel_id, is_muted, is_deafened
         FROM bot.guild_voice_states WHERE guild_id = $1`,
        [guildId],
      );
      voiceUsers = res.rows.map((r) => ({
        user_id: r.user_id,
        channel_id: r.channel_id,
        session_id: null,
        // The bot stores self+server mute combined; the dashboard only shows one flag.
        self_mute: r.is_muted,
        self_deaf: r.is_deafened,
        mute: null,
        deaf: null,
      }));
    } catch {
      degradedReason = degradedReason ?? "Could not read voice states";
    }
  }
  return {
    guild_id: guildId,
    gateway_connected: status.connected,
    gateway_degraded: degradedReason !== null,
    gateway_degraded_reason: degradedReason,
    last_event_at: iso(status.row?.last_event_at),
    // Voice rows are only trustworthy while the bot is connected (it rebuilds them on reconnect).
    voice_users: status.connected ? voiceUsers : [],
  };
}
