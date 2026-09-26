import { type Client, Events, type VoiceState } from 'discord.js';
import { getPool } from './db.js';
import { childLogger } from './core/logger.js';

const log = childLogger('voice-tracker');

type DB = { query: (sql: string, params?: unknown[]) => Promise<unknown> };

// ── Live state (guild_voice_states) ───────────────────────────────────────────

async function upsertVoiceState(db: DB, state: VoiceState): Promise<void> {
  const member = state.member;
  const username = member?.user.username ?? 'unknown';
  const globalName = member?.user.globalName ?? null;
  const nick = member?.nickname ?? null;
  const avatar = member?.user.avatar ?? null;
  const channelName = state.channel?.name ?? null;

  await db.query(
    `INSERT INTO bot.guild_voice_states
       (guild_id, user_id, channel_id, channel_name, username, global_name, nick, avatar,
        is_muted, is_deafened, is_streaming, is_video, joined_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, now())
     ON CONFLICT (guild_id, user_id) DO UPDATE SET
       channel_id   = EXCLUDED.channel_id,
       channel_name = EXCLUDED.channel_name,
       username     = EXCLUDED.username,
       global_name  = EXCLUDED.global_name,
       nick         = EXCLUDED.nick,
       avatar       = EXCLUDED.avatar,
       is_muted     = EXCLUDED.is_muted,
       is_deafened  = EXCLUDED.is_deafened,
       is_streaming = EXCLUDED.is_streaming,
       is_video     = EXCLUDED.is_video`,
    [
      state.guild.id,
      state.id,
      state.channelId,
      channelName,
      username,
      globalName,
      nick,
      avatar,
      (state.selfMute || state.serverMute) ?? false,
      (state.selfDeaf || state.serverDeaf) ?? false,
      state.streaming ?? false,
      state.selfVideo ?? false,
    ],
  );
}

// ── Session logging (stats.voice_sessions) ────────────────────────────────────

async function openVoiceSession(db: DB, state: VoiceState): Promise<void> {
  const username = state.member?.user.username ?? 'unknown';
  await db.query(
    `INSERT INTO stats.voice_sessions (guild_id, user_id, channel_id, channel_name, username, joined_at)
     VALUES ($1, $2, $3, $4, $5, now())`,
    [state.guild.id, state.id, state.channelId, state.channel?.name ?? null, username],
  );
}

async function closeVoiceSession(db: DB, guildId: string, userId: string): Promise<void> {
  // Close the most recent open session for this user in this guild.
  await db.query(
    `UPDATE stats.voice_sessions
     SET left_at = now()
     WHERE id = (
       SELECT id FROM stats.voice_sessions
       WHERE guild_id = $1 AND user_id = $2 AND left_at IS NULL
       ORDER BY joined_at DESC LIMIT 1
     )`,
    [guildId, userId],
  );
}

async function closeAllOpenSessions(db: DB): Promise<void> {
  await db.query(`UPDATE stats.voice_sessions SET left_at = now() WHERE left_at IS NULL`);
}

// ── Snapshot ──────────────────────────────────────────────────────────────────

export async function snapshotAllGuilds(client: Client<true>): Promise<void> {
  const pool = getPool();
  const db = await pool.connect();
  try {
    await db.query('BEGIN');

    // Close stale sessions from before this bot start
    await closeAllOpenSessions(db as unknown as DB);

    await db.query('DELETE FROM bot.guild_voice_states');
    for (const guild of client.guilds.cache.values()) {
      for (const voiceState of guild.voiceStates.cache.values()) {
        if (!voiceState.channelId) continue;
        await upsertVoiceState(db as unknown as DB, voiceState);
        await openVoiceSession(db as unknown as DB, voiceState);
      }
    }

    await db.query('COMMIT');
    log.info('snapshot complete');
  } catch (err) {
    await db.query('ROLLBACK');
    log.error({ err }, 'snapshot failed');
  } finally {
    db.release();
  }
}

// ── Live event handler ────────────────────────────────────────────────────────

export async function handleVoiceStateUpdate(
  oldState: VoiceState,
  newState: VoiceState,
): Promise<void> {
  const pool = getPool();
  const guildId = newState.guild.id;
  const userId = newState.id;

  try {
    if (newState.channelId === null) {
      // User left voice entirely
      await pool.query(
        'DELETE FROM bot.guild_voice_states WHERE guild_id = $1 AND user_id = $2',
        [guildId, userId],
      );
      await closeVoiceSession(pool as unknown as DB, guildId, userId);
    } else if (oldState.channelId !== null && oldState.channelId !== newState.channelId) {
      // User moved to a different channel: close old session, open new
      await upsertVoiceState(pool as unknown as DB, newState);
      await closeVoiceSession(pool as unknown as DB, guildId, userId);
      await openVoiceSession(pool as unknown as DB, newState);
    } else if (oldState.channelId === null) {
      // User joined voice from outside
      await upsertVoiceState(pool as unknown as DB, newState);
      await openVoiceSession(pool as unknown as DB, newState);
    } else {
      // Same channel, state changed (mute/deafen/stream) — just update live state
      await upsertVoiceState(pool as unknown as DB, newState);
    }
  } catch (err) {
    log.error({ err }, 'VoiceStateUpdate error');
  }
}

export function registerVoiceTracker(client: Client): void {
  client.once(Events.ClientReady, async (c) => {
    await snapshotAllGuilds(c);
  });

  client.on(Events.VoiceStateUpdate, handleVoiceStateUpdate);
}
