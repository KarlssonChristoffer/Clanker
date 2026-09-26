/**
 * Guild snapshot + live tracking.
 *
 * Captures and keeps current in the database:
 *   bot.guild_roles      — server roles
 *   bot.guild_channels   — all channels
 *   bot.guild_members    — all members (username, nickname, roles, joined_at, …)
 *   bot.guild_presences  — online status + activities (games, Spotify, streaming, …)
 *
 * Requires privileged intents: GuildMembers + GuildPresences
 * (enable in Discord Developer Portal → Bot → Privileged Gateway Intents)
 */

import {
  Events,
  type Client,
  type Guild,
  type GuildChannel,
  type GuildMember,
  type Presence,
  type Role,
} from 'discord.js';
import { getPool } from './db.js';
import { childLogger } from './core/logger.js';

const log = childLogger('guild-tracker');

type DB = { query: (sql: string, params?: unknown[]) => Promise<unknown> };

// ── Roles ─────────────────────────────────────────────────────────────────────

async function upsertRole(db: DB, guildId: string, role: Role): Promise<void> {
  await db.query(
    `INSERT INTO bot.guild_roles
       (guild_id, role_id, name, color, hoist, position, permissions, managed, mentionable, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, now())
     ON CONFLICT (guild_id, role_id) DO UPDATE SET
       name=$3, color=$4, hoist=$5, position=$6, permissions=$7,
       managed=$8, mentionable=$9, updated_at=now()`,
    [
      guildId, role.id, role.name, role.color, role.hoist, role.position,
      role.permissions.bitfield.toString(), role.managed, role.mentionable,
    ],
  );
}

// ── Channels ──────────────────────────────────────────────────────────────────

function channelTopic(ch: GuildChannel): string | null {
  return 'topic' in ch && typeof ch.topic === 'string' ? ch.topic : null;
}

function channelPosition(ch: GuildChannel): number | null {
  return 'position' in ch && typeof ch.position === 'number' ? ch.position : null;
}

async function upsertChannel(db: DB, guildId: string, ch: GuildChannel): Promise<void> {
  await db.query(
    `INSERT INTO bot.guild_channels
       (guild_id, channel_id, name, type, parent_id, position, topic, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7, now())
     ON CONFLICT (guild_id, channel_id) DO UPDATE SET
       name=$3, type=$4, parent_id=$5, position=$6, topic=$7, updated_at=now()`,
    [guildId, ch.id, ch.name, ch.type, ch.parentId ?? null, channelPosition(ch), channelTopic(ch)],
  );
}

// ── Members ───────────────────────────────────────────────────────────────────

async function upsertMember(db: DB, member: GuildMember): Promise<void> {
  await db.query(
    `INSERT INTO bot.guild_members
       (guild_id, user_id, username, global_name, nickname, avatar, guild_avatar, roles, is_bot, joined_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, now())
     ON CONFLICT (guild_id, user_id) DO UPDATE SET
       username=$3, global_name=$4, nickname=$5, avatar=$6, guild_avatar=$7,
       roles=$8, is_bot=$9,
       joined_at=COALESCE(EXCLUDED.joined_at, bot.guild_members.joined_at),
       updated_at=now()`,
    [
      member.guild.id,
      member.user.id,
      member.user.username,
      member.user.globalName ?? null,
      member.nickname ?? null,
      member.user.avatar ?? null,
      member.avatar ?? null,
      member.roles.cache.map((r) => r.id),
      member.user.bot,
      member.joinedAt ?? null,
    ],
  );
}

// ── Presences ─────────────────────────────────────────────────────────────────

// Activity types we record as sessions (skip Custom=4 — too noisy)
const TRACKED_ACTIVITY_TYPES = new Set([0, 1, 2]); // Playing, Streaming, Listening

function activityKey(type: number, name: string): string {
  return `${type}:${name}`;
}

function serializePresence(presence: Presence) {
  const clientStatus = {
    desktop: presence.clientStatus?.desktop ?? null,
    mobile: presence.clientStatus?.mobile ?? null,
    web: presence.clientStatus?.web ?? null,
  };
  const activities = presence.activities.map((a) => ({
    type: a.type,          // ActivityType enum: 0=Playing 1=Streaming 2=Listening 3=Watching 4=Custom 5=Competing
    name: a.name,
    state: a.state ?? null,
    details: a.details ?? null,
    url: a.url ?? null,
    timestamps: a.timestamps
      ? { start: a.timestamps.start?.getTime() ?? null, end: a.timestamps.end?.getTime() ?? null }
      : null,
  }));
  return { clientStatus, activities };
}

async function upsertPresence(db: DB, presence: Presence): Promise<void> {
  if (!presence.guild) return;
  const { clientStatus, activities } = serializePresence(presence);
  await db.query(
    `INSERT INTO bot.guild_presences (guild_id, user_id, status, client_status, activities, updated_at)
     VALUES ($1,$2,$3,$4,$5, now())
     ON CONFLICT (guild_id, user_id) DO UPDATE SET
       status=$3, client_status=$4, activities=$5, updated_at=now()`,
    [presence.guild.id, presence.userId, presence.status, clientStatus, JSON.stringify(activities)],
  );
}

async function deletePresence(db: DB, guildId: string, userId: string): Promise<void> {
  await db.query(
    'DELETE FROM bot.guild_presences WHERE guild_id=$1 AND user_id=$2',
    [guildId, userId],
  );
}

// ── Activity sessions (stats.activity_sessions) ───────────────────────────────

async function openActivitySession(
  db: DB, guildId: string, userId: string, username: string,
  activityType: number, activityName: string,
): Promise<void> {
  await db.query(
    `INSERT INTO stats.activity_sessions
       (guild_id, user_id, username, activity_type, activity_name, started_at)
     VALUES ($1,$2,$3,$4,$5, now())`,
    [guildId, userId, username, activityType, activityName],
  );
}

async function closeActivitySession(
  db: DB, guildId: string, userId: string,
  activityType: number, activityName: string,
): Promise<void> {
  await db.query(
    `UPDATE stats.activity_sessions
     SET ended_at = now()
     WHERE id = (
       SELECT id FROM stats.activity_sessions
       WHERE guild_id=$1 AND user_id=$2 AND activity_type=$3 AND activity_name=$4 AND ended_at IS NULL
       ORDER BY started_at DESC LIMIT 1
     )`,
    [guildId, userId, activityType, activityName],
  );
}

async function closeAllOpenActivitySessions(db: DB): Promise<void> {
  await db.query(`UPDATE stats.activity_sessions SET ended_at = now() WHERE ended_at IS NULL`);
}

/** Diff two activity sets and open/close sessions accordingly. */
async function syncActivitySessions(
  db: DB,
  guildId: string,
  userId: string,
  username: string,
  oldActivities: Array<{ type: number; name: string }>,
  newActivities: Array<{ type: number; name: string }>,
): Promise<void> {
  const oldKeys = new Set(oldActivities.filter(a => TRACKED_ACTIVITY_TYPES.has(a.type)).map(a => activityKey(a.type, a.name)));
  const newKeys = new Set(newActivities.filter(a => TRACKED_ACTIVITY_TYPES.has(a.type)).map(a => activityKey(a.type, a.name)));

  // Close sessions for activities that ended
  for (const a of oldActivities) {
    if (!TRACKED_ACTIVITY_TYPES.has(a.type)) continue;
    if (!newKeys.has(activityKey(a.type, a.name))) {
      await closeActivitySession(db, guildId, userId, a.type, a.name);
    }
  }
  // Open sessions for new activities
  for (const a of newActivities) {
    if (!TRACKED_ACTIVITY_TYPES.has(a.type)) continue;
    if (!oldKeys.has(activityKey(a.type, a.name))) {
      await openActivitySession(db, guildId, userId, username, a.type, a.name);
    }
  }
}

// ── Snapshot ──────────────────────────────────────────────────────────────────

async function snapshotGuild(db: DB, guild: Guild): Promise<void> {
  const gid = guild.id;

  // Roles — replace all
  await db.query('DELETE FROM bot.guild_roles WHERE guild_id=$1', [gid]);
  for (const role of guild.roles.cache.values()) {
    await upsertRole(db, gid, role);
  }

  // Channels — replace all
  await db.query('DELETE FROM bot.guild_channels WHERE guild_id=$1', [gid]);
  for (const ch of guild.channels.cache.values()) {
    await upsertChannel(db, gid, ch as GuildChannel);
  }

  // Members — fetch ALL (requires GuildMembers privileged intent)
  try {
    await guild.members.fetch();
  } catch (err) {
    log.warn(`members.fetch failed for ${gid}: ${(err as Error).message}`);
  }
  await db.query('DELETE FROM bot.guild_members WHERE guild_id=$1', [gid]);
  for (const member of guild.members.cache.values()) {
    await upsertMember(db, member);
  }

  // Presences — replace all (requires GuildPresences privileged intent)
  await db.query('DELETE FROM bot.guild_presences WHERE guild_id=$1', [gid]);
  for (const presence of guild.presences.cache.values()) {
    await upsertPresence(db, presence);
  }
}

async function snapshotActivitySessions(db: DB, client: Client<true>): Promise<void> {
  // Close all stale open sessions from before this restart
  await closeAllOpenActivitySessions(db);
  // Open sessions for activities currently running across all guilds
  for (const guild of client.guilds.cache.values()) {
    for (const presence of guild.presences.cache.values()) {
      const username = guild.members.cache.get(presence.userId)?.user.username ?? 'unknown';
      for (const a of presence.activities) {
        if (!TRACKED_ACTIVITY_TYPES.has(a.type)) continue;
        await openActivitySession(db, guild.id, presence.userId, username, a.type, a.name);
      }
    }
  }
}

export async function snapshotAllGuilds(client: Client<true>): Promise<void> {
  const pool = getPool();
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    for (const guild of client.guilds.cache.values()) {
      await snapshotGuild(db as unknown as DB, guild);
    }
    await snapshotActivitySessions(db as unknown as DB, client);
    await db.query('COMMIT');
    const memberCount = client.guilds.cache.reduce((n, g) => n + g.memberCount, 0);
    log.info(`snapshot complete — ${client.guilds.cache.size} guild(s), ~${memberCount} members`);
  } catch (err) {
    await db.query('ROLLBACK');
    log.error({ err }, 'snapshot failed');
  } finally {
    db.release();
  }
}

// ── Live event handlers ───────────────────────────────────────────────────────

export function registerGuildTracker(client: Client): void {
  // Initial snapshot once ready
  client.once(Events.ClientReady, async (c) => {
    await snapshotAllGuilds(c);
  });

  // ── Members ──

  client.on(Events.GuildMemberAdd, async (member) => {
    try { await upsertMember(getPool() as unknown as DB, member); }
    catch (err) { log.error({ err }, 'GuildMemberAdd error'); }
  });

  client.on(Events.GuildMemberRemove, async (member) => {
    try {
      await getPool().query(
        'DELETE FROM bot.guild_members WHERE guild_id=$1 AND user_id=$2',
        [member.guild.id, member.user.id],
      );
    } catch (err) { log.error({ err }, 'GuildMemberRemove error'); }
  });

  client.on(Events.GuildMemberUpdate, async (_old, member) => {
    try { await upsertMember(getPool() as unknown as DB, member); }
    catch (err) { log.error({ err }, 'GuildMemberUpdate error'); }
  });

  // ── Presences ──

  client.on(Events.PresenceUpdate, async (oldPresence, newPresence) => {
    if (!newPresence.guild) return;
    const db = getPool() as unknown as DB;
    const guildId = newPresence.guild.id;
    const userId = newPresence.userId;
    const username = newPresence.member?.user.username ?? oldPresence?.member?.user.username ?? 'unknown';
    try {
      // Update live presence table
      if (newPresence.status === 'offline') {
        await deletePresence(db, guildId, userId);
      } else {
        await upsertPresence(db, newPresence);
      }

      // Diff activities and update session log
      const oldActs = (oldPresence?.activities ?? []).map(a => ({ type: a.type, name: a.name }));
      const newActs = newPresence.status === 'offline'
        ? []
        : newPresence.activities.map(a => ({ type: a.type, name: a.name }));
      await syncActivitySessions(db, guildId, userId, username, oldActs, newActs);
    } catch (err) { log.error({ err }, 'PresenceUpdate error'); }
  });

  // ── Channels ──

  client.on(Events.ChannelCreate, async (ch) => {
    if (!('guild' in ch) || !ch.guild) return;
    try { await upsertChannel(getPool() as unknown as DB, ch.guild.id, ch as GuildChannel); }
    catch (err) { log.error({ err }, 'ChannelCreate error'); }
  });

  client.on(Events.ChannelUpdate, async (_old, ch) => {
    if (!('guild' in ch) || !ch.guild) return;
    try { await upsertChannel(getPool() as unknown as DB, ch.guild.id, ch as GuildChannel); }
    catch (err) { log.error({ err }, 'ChannelUpdate error'); }
  });

  client.on(Events.ChannelDelete, async (ch) => {
    if (!('guild' in ch) || !ch.guild) return;
    try {
      await getPool().query(
        'DELETE FROM bot.guild_channels WHERE guild_id=$1 AND channel_id=$2',
        [ch.guild.id, ch.id],
      );
    } catch (err) { log.error({ err }, 'ChannelDelete error'); }
  });

  // ── Roles ──

  client.on(Events.GuildRoleCreate, async (role) => {
    try { await upsertRole(getPool() as unknown as DB, role.guild.id, role); }
    catch (err) { log.error({ err }, 'GuildRoleCreate error'); }
  });

  client.on(Events.GuildRoleUpdate, async (_old, role) => {
    try { await upsertRole(getPool() as unknown as DB, role.guild.id, role); }
    catch (err) { log.error({ err }, 'GuildRoleUpdate error'); }
  });

  client.on(Events.GuildRoleDelete, async (role) => {
    try {
      await getPool().query(
        'DELETE FROM bot.guild_roles WHERE guild_id=$1 AND role_id=$2',
        [role.guild.id, role.id],
      );
    } catch (err) { log.error({ err }, 'GuildRoleDelete error'); }
  });
}
