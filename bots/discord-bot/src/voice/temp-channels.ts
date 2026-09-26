/**
 * Temporary voice channels (bot.temp_voice_channels):
 *  - join-to-create: joining "➕ Skapa grupp" creates "🎮 <namn>s grupp" next to it and moves you in;
 *  - LFG: a full LFG group gets its own channel.
 * A temp channel is deleted as soon as it is empty; a sweep at startup removes leftovers.
 */
import {
  ChannelType,
  Events,
  PermissionFlagsBits,
  type Client,
  type Guild,
  type VoiceBasedChannel,
  type VoiceChannel,
  type VoiceState,
} from 'discord.js';
import type { Queryable } from '../db.js';
import { features } from '../core/features.js';
import { childLogger } from '../core/logger.js';
import { normaliseName } from '../setup/planner.js';
import { loadBindings } from '../setup/executor.js';

const log = childLogger('temp-voice');
const TRIGGER_NAME = normaliseName('➕ Skapa grupp');

export async function createTempVoice(
  db: Queryable,
  guild: Guild,
  opts: { name: string; parentId: string | null; ownerId: string; kind: 'join-to-create' | 'lfg'; userLimit?: number },
): Promise<VoiceChannel> {
  const channel = await guild.channels.create({
    name: opts.name.slice(0, 100),
    type: ChannelType.GuildVoice,
    parent: opts.parentId,
    userLimit: opts.userLimit ?? 0,
    permissionOverwrites: [
      { id: opts.ownerId, allow: [PermissionFlagsBits.ManageChannels, PermissionFlagsBits.MoveMembers] },
      { id: guild.members.me!.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.MoveMembers] },
    ],
    reason: 'Clanker: tillfällig röstkanal',
  });
  await db.query(
    'INSERT INTO bot.temp_voice_channels (channel_id, guild_id, owner_id, kind) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING',
    [channel.id, guild.id, opts.ownerId, opts.kind],
  );
  log.info({ guildId: guild.id, channelId: channel.id, kind: opts.kind }, 'temp voice channel created');
  return channel;
}

async function isTemp(db: Queryable, channelId: string): Promise<boolean> {
  const res = await db.query('SELECT 1 FROM bot.temp_voice_channels WHERE channel_id = $1', [channelId]);
  return res.rows.length > 0;
}

async function deleteTemp(db: Queryable, channel: VoiceBasedChannel | null, channelId: string): Promise<void> {
  if (channel) await channel.delete('Clanker: tom tillfällig röstkanal').catch((err) => log.warn({ err, channelId }, 'could not delete temp channel'));
  await db.query('DELETE FROM bot.temp_voice_channels WHERE channel_id = $1', [channelId]);
}

async function isTrigger(db: Queryable, channel: VoiceBasedChannel): Promise<boolean> {
  const bindings = await loadBindings(db, channel.guild.id);
  if (bindings['vc.skapa']) return bindings['vc.skapa'] === channel.id;
  return normaliseName(channel.name) === TRIGGER_NAME;
}

export async function handleVoiceUpdate(db: Queryable, oldState: VoiceState, newState: VoiceState): Promise<void> {
  // Left (or moved out of) a temp channel that is now empty → delete it.
  if (oldState.channelId && oldState.channelId !== newState.channelId) {
    const old = oldState.channel;
    if (old && old.members.size === 0 && (await isTemp(db, old.id))) await deleteTemp(db, old, old.id);
  }
  // Joined the join-to-create trigger → create a personal channel and move the member there.
  const joined = newState.channel;
  const member = newState.member;
  if (!joined || !member || member.user.bot || oldState.channelId === newState.channelId) return;
  if (!(await isTrigger(db, joined))) return;
  if (!(await features().isEnabled(joined.guild.id, 'join_to_create'))) return;
  const channel = await createTempVoice(db, joined.guild, {
    name: `🎮 ${member.displayName}s grupp`,
    parentId: joined.parentId,
    ownerId: member.id,
    kind: 'join-to-create',
  });
  await member.voice.setChannel(channel, 'Clanker: skapa grupp').catch(async (err) => {
    log.warn({ err }, 'could not move member into new channel');
    await deleteTemp(db, channel, channel.id);
  });
}

/** Startup: forget rows for channels that are gone, delete temp channels that are empty. */
export async function sweepTempVoice(client: Client, db: Queryable): Promise<void> {
  const res = await db.query<{ channel_id: string }>('SELECT channel_id FROM bot.temp_voice_channels');
  for (const { channel_id } of res.rows) {
    const ch = await client.channels.fetch(channel_id).catch(() => null);
    if (!ch || !ch.isVoiceBased()) {
      await db.query('DELETE FROM bot.temp_voice_channels WHERE channel_id = $1', [channel_id]);
    } else if (ch.members.size === 0) {
      await deleteTemp(db, ch, channel_id);
    }
  }
}

export function registerTempVoice(client: Client, db: Queryable): void {
  client.on(Events.VoiceStateUpdate, (oldState, newState) => {
    handleVoiceUpdate(db, oldState, newState).catch((err) => log.error({ err }, 'temp voice handler failed'));
  });
}
