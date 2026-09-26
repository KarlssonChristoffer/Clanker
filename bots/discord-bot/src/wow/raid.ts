/**
 * Raid and dungeon sign-ups (/raid skapa). One embed per event with Tank / Healer / DPS / Kanske /
 * Bänk / Avanmäl buttons; the composition updates live ("2/2 tanks · 4/5 heals · 11/13 DPS").
 * A Discord scheduled event is created alongside, and the scheduler pings sign-ups 30 min before
 * and closes the sign-up at start. Times are parsed deterministically in Europe/Stockholm.
 */
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  GuildScheduledEventEntityType,
  GuildScheduledEventPrivacyLevel,
  type Client,
  type Guild,
  type TextChannel,
} from 'discord.js';
import type { Queryable } from '../db.js';
import { customId } from '../core/components.js';
import { childLogger } from '../core/logger.js';
import { PermanentJobError, type JobHandler } from '../core/scheduler.js';
import { discordTimestamp } from '../core/time.js';
import { compositionFor, ROLE_EMOJI, type Role } from './game-data.js';

const log = childLogger('raid');

export type SignupStatus = Role | 'maybe' | 'bench';
export const SIGNUP_STATUSES: SignupStatus[] = ['tank', 'healer', 'dps', 'maybe', 'bench'];

export type RaidEvent = {
  id: string;
  guild_id: string;
  channel_id: string;
  message_id: string | null;
  kind: 'raid' | 'dungeon';
  title: string;
  starts_at: Date;
  size: number;
  created_by: string;
  discord_event_id: string | null;
  status: 'open' | 'started' | 'cancelled';
};

export type Signup = { user_id: string; status: SignupStatus; class_name: string | null };

export async function loadEvent(db: Queryable, id: string): Promise<RaidEvent | null> {
  const res = await db.query<RaidEvent>(
    `SELECT id::text AS id, guild_id, channel_id, message_id, kind, title, starts_at, size, created_by, discord_event_id, status
     FROM bot.raid_events WHERE id = $1`,
    [id],
  );
  return res.rows[0] ?? null;
}

export async function loadSignups(db: Queryable, event: RaidEvent, flavor: string): Promise<Signup[]> {
  const res = await db.query<Signup>(
    `SELECT s.user_id, s.status,
            (SELECT c.class FROM bot.wow_characters c
              WHERE c.guild_id = $2 AND c.user_id = s.user_id AND c.flavor = $3
              ORDER BY c.is_main DESC, c.updated_at DESC LIMIT 1) AS class_name
     FROM bot.raid_signups s WHERE s.event_id = $1 ORDER BY s.updated_at`,
    [event.id, event.guild_id, flavor],
  );
  return res.rows;
}

/** "🛡️ 2/2 tanks · 💚 4/5 heals · ⚔️ 11/13 DPS" */
export function compositionLine(signups: readonly Pick<Signup, 'status'>[], size: number): string {
  const target = compositionFor(size);
  const n = (r: Role) => signups.filter((s) => s.status === r).length;
  return `${ROLE_EMOJI.tank} ${n('tank')}/${target.tank} tanks · ${ROLE_EMOJI.healer} ${n('healer')}/${target.healer} heals · ${ROLE_EMOJI.dps} ${n('dps')}/${target.dps} DPS`;
}

function list(signups: Signup[], status: SignupStatus): string {
  const rows = signups.filter((s) => s.status === status).map((s) => `<@${s.user_id}>${s.class_name ? ` · ${s.class_name}` : ''}`);
  if (!rows.length) return '–';
  const text = rows.join('\n');
  return text.length > 1000 ? `${text.slice(0, 990)}\n…` : text;
}

export function renderEvent(event: RaidEvent, signups: Signup[]) {
  const start = new Date(event.starts_at);
  const icon = event.kind === 'dungeon' ? '🔑' : '🐉';
  const closed = event.status !== 'open';
  const embed = new EmbedBuilder()
    .setTitle(`${icon} ${event.title}${event.status === 'cancelled' ? ' (inställd)' : ''}`)
    .setDescription(
      [
        `🗓️ ${discordTimestamp(start, 'F')} (${discordTimestamp(start, 'R')})`,
        `**${compositionLine(signups, event.size)}**`,
        `-# ${event.size} platser · skapad av <@${event.created_by}>`,
      ].join('\n'),
    )
    .addFields(
      { name: `🛡️ Tank (${signups.filter((s) => s.status === 'tank').length})`, value: list(signups, 'tank'), inline: true },
      { name: `💚 Healer (${signups.filter((s) => s.status === 'healer').length})`, value: list(signups, 'healer'), inline: true },
      { name: `⚔️ DPS (${signups.filter((s) => s.status === 'dps').length})`, value: list(signups, 'dps'), inline: true },
      { name: `🤔 Kanske (${signups.filter((s) => s.status === 'maybe').length})`, value: list(signups, 'maybe'), inline: true },
      { name: `🪑 Bänk (${signups.filter((s) => s.status === 'bench').length})`, value: list(signups, 'bench'), inline: true },
    )
    .setFooter({
      text: event.status === 'cancelled' ? 'Inställd' : closed ? 'Anmälan stängd, raiden har börjat' : `Anmälan stänger när det börjar · #${event.id}`,
    })
    .setColor(event.status === 'cancelled' ? 0x95a5a6 : event.kind === 'dungeon' ? 0x3498db : 0xe67e22);

  const btn = (status: SignupStatus, label: string, emoji: string, style: ButtonStyle) =>
    new ButtonBuilder().setCustomId(customId('raid', 'join', event.id, status)).setLabel(label).setEmoji(emoji).setStyle(style).setDisabled(closed);
  const row1 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    btn('tank', 'Tank', '🛡️', ButtonStyle.Primary),
    btn('healer', 'Healer', '💚', ButtonStyle.Success),
    btn('dps', 'DPS', '⚔️', ButtonStyle.Danger),
  );
  const row2 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    btn('maybe', 'Kanske', '🤔', ButtonStyle.Secondary),
    btn('bench', 'Bänk', '🪑', ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(customId('raid', 'leave', event.id)).setLabel('Avanmäl').setEmoji('👋').setStyle(ButtonStyle.Secondary).setDisabled(closed),
  );
  return { embeds: [embed], components: [row1, row2] };
}

export async function setSignup(db: Queryable, eventId: string, userId: string, status: SignupStatus | null): Promise<void> {
  if (status === null) {
    await db.query('DELETE FROM bot.raid_signups WHERE event_id = $1 AND user_id = $2', [eventId, userId]);
    return;
  }
  await db.query(
    `INSERT INTO bot.raid_signups (event_id, user_id, status, updated_at) VALUES ($1, $2, $3, now())
     ON CONFLICT (event_id, user_id) DO UPDATE SET status = EXCLUDED.status, updated_at = now()`,
    [eventId, userId, status],
  );
}

/** Creates the Discord scheduled event; returns its id or null (with a reason) when not possible. */
export async function createScheduledEvent(
  guild: Guild,
  event: Pick<RaidEvent, 'title' | 'starts_at' | 'kind'>,
  opts: { voiceChannelId: string | null; location: string; description: string },
): Promise<{ id: string | null; error?: string }> {
  const start = new Date(event.starts_at);
  const end = new Date(start.getTime() + (event.kind === 'dungeon' ? 60 : 180) * 60_000);
  try {
    const created = opts.voiceChannelId
      ? await guild.scheduledEvents.create({
          name: event.title.slice(0, 100),
          scheduledStartTime: start,
          scheduledEndTime: end,
          privacyLevel: GuildScheduledEventPrivacyLevel.GuildOnly,
          entityType: GuildScheduledEventEntityType.Voice,
          channel: opts.voiceChannelId,
          description: opts.description.slice(0, 1000),
        })
      : await guild.scheduledEvents.create({
          name: event.title.slice(0, 100),
          scheduledStartTime: start,
          scheduledEndTime: end,
          privacyLevel: GuildScheduledEventPrivacyLevel.GuildOnly,
          entityType: GuildScheduledEventEntityType.External,
          entityMetadata: { location: opts.location.slice(0, 100) },
          description: opts.description.slice(0, 1000),
        });
    return { id: created.id };
  } catch (err) {
    log.warn({ err, guildId: guild.id }, 'could not create scheduled event');
    return { id: null, error: (err as Error).message };
  }
}

async function eventChannel(client: Client, event: RaidEvent): Promise<TextChannel> {
  const ch = await client.channels.fetch(event.channel_id).catch(() => null);
  if (!ch || ch.type !== ChannelType.GuildText) throw new PermanentJobError(`channel ${event.channel_id} is gone`);
  return ch as TextChannel;
}

export async function refreshEventMessage(client: Client, db: Queryable, event: RaidEvent, flavor: string): Promise<void> {
  if (!event.message_id) return;
  const ch = await eventChannel(client, event);
  const msg = await ch.messages.fetch(event.message_id).catch(() => null);
  if (!msg) return;
  await msg.edit(renderEvent(event, await loadSignups(db, event, flavor)));
}

/** Scheduler handlers: ping 30 min before, close sign-up at start. */
export function raidJobs(getClient: () => Client, db: Queryable, flavor: () => string): Record<string, JobHandler> {
  return {
    'raid-ping': async (payload: { eventId: string }) => {
      const event = await loadEvent(db, payload.eventId);
      if (!event || event.status !== 'open') return;
      const signups = (await loadSignups(db, event, flavor())).filter((s) => s.status !== 'bench');
      const ch = await eventChannel(getClient(), event);
      if (!signups.length) {
        await ch.send(`⏰ **${event.title}** börjar ${discordTimestamp(new Date(event.starts_at), 'R')}, men ingen har anmält sig än. 😬`);
        return;
      }
      await ch.send({
        content: `⏰ **${event.title}** börjar ${discordTimestamp(new Date(event.starts_at), 'R')}! Logga in, reparera och ta med flasks.\n${signups.map((s) => `<@${s.user_id}>`).join(' ')}`,
        allowedMentions: { users: signups.map((s) => s.user_id) },
      });
    },
    'raid-start': async (payload: { eventId: string }) => {
      const event = await loadEvent(db, payload.eventId);
      if (!event || event.status !== 'open') return;
      await db.query(`UPDATE bot.raid_events SET status = 'started' WHERE id = $1`, [event.id]);
      await refreshEventMessage(getClient(), db, { ...event, status: 'started' }, flavor());
    },
  };
}
