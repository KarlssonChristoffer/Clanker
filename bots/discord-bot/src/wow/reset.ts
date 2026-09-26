/**
 * Weekly "Ny vecka" post in #annonser at the EU weekly reset (feature `reset_post`).
 * EU retail reset is Wednesday 04:00 UTC (fixed in UTC, verified 2026-09-26). WoW Forever's reset
 * is not announced yet, so both are configurable: WOW_RESET_WEEKDAY (1 = Mon … 7 = Sun) and
 * WOW_RESET_TIME_UTC ("HH:MM").
 */
import { ChannelType, EmbedBuilder, type Client, type TextChannel } from 'discord.js';
import type { Queryable } from '../db.js';
import { features } from '../core/features.js';
import { childLogger } from '../core/logger.js';
import type { JobHandler, Scheduler } from '../core/scheduler.js';
import { discordTimestamp, nextWeeklyUtc } from '../core/time.js';
import { pick } from '../commands/_shared.js';
import { boundChannelId } from '../setup/executor.js';

const log = childLogger('wow-reset');

export function resetSlot(): { weekday: number; hour: number; minute: number } {
  const weekday = Number(process.env.WOW_RESET_WEEKDAY ?? '3');
  const [h, m] = (process.env.WOW_RESET_TIME_UTC ?? '04:00').split(':').map(Number);
  return {
    weekday: weekday >= 1 && weekday <= 7 ? weekday : 3,
    hour: Number.isInteger(h) && h! >= 0 && h! <= 23 ? h! : 4,
    minute: Number.isInteger(m) && m! >= 0 && m! <= 59 ? m! : 0,
  };
}

export function nextReset(after: Date): Date {
  const s = resetSlot();
  return nextWeeklyUtc(after, s.weekday, s.hour, s.minute);
}

const OPENERS = [
  'Ny vecka, nya lockouts, samma gamla wipes. 💪',
  'Reset! Allt är förlåtet. Nästan allt.',
  'Veckan är nollställd. Dags att göra samma sak igen, fast bättre.',
  'Ny vecka. Lootgudarna har blandat om korten. 🎲',
];

async function postReset(client: Client, db: Queryable, guildId: string): Promise<void> {
  if (!(await features().isEnabled(guildId, 'reset_post'))) return;
  const guild = await client.guilds.fetch(guildId).catch(() => null);
  if (!guild) return;
  const channelId = await boundChannelId(db, guild, 'ch.annonser', 'annonser');
  const ch = channelId ? await guild.channels.fetch(channelId).catch(() => null) : null;
  if (!ch || ch.type !== ChannelType.GuildText) {
    log.warn({ guildId }, 'no #annonser channel for the reset post');
    return;
  }
  const upcoming = await db.query<{ title: string; starts_at: Date; message_id: string | null; channel_id: string; kind: string }>(
    `SELECT title, starts_at, message_id, channel_id, kind FROM bot.raid_events
     WHERE guild_id = $1 AND status = 'open' AND starts_at > now() AND starts_at < now() + interval '7 days'
     ORDER BY starts_at LIMIT 10`,
    [guildId],
  );
  const embed = new EmbedBuilder()
    .setTitle('🗓️ Ny vecka!')
    .setDescription(pick(OPENERS))
    .setColor(0x9b59b6)
    .addFields({
      name: 'Veckans planerade grupper',
      value: upcoming.rows.length
        ? upcoming.rows
            .map((e) => `${e.kind === 'dungeon' ? '🔑' : '🐉'} **${e.title}** ${discordTimestamp(new Date(e.starts_at), 'f')}${e.message_id ? ` · [anmälan](https://discord.com/channels/${guildId}/${e.channel_id}/${e.message_id})` : ''}`)
            .join('\n')
        : 'Inget inbokat än. Skapa något med `/raid skapa`!',
    })
    .setFooter({ text: 'Weekly reset' });
  await (ch as TextChannel).send({ embeds: [embed] });
}

export function resetJob(getClient: () => Client, db: Queryable): JobHandler<{ guildId: string }> {
  return async (payload, { job }) => {
    try {
      await postReset(getClient(), db, payload.guildId);
    } catch (err) {
      log.error({ err, guildId: payload.guildId }, 'reset post failed');
    }
    // Recurring: always schedule the next week, even if this one failed.
    return { nextRunAt: nextReset(new Date(Math.max(Date.now(), new Date(job.run_at).getTime()))) };
  };
}

/** Make sure every guild has a pending weekly reset job (idempotent via dedupe key). */
export async function ensureResetJobs(client: Client, scheduler: Scheduler): Promise<void> {
  for (const guildId of client.guilds.cache.keys()) {
    const key = `wow-reset:${guildId}`;
    if (await scheduler.hasPending(key)) continue;
    await scheduler.schedule({ guildId, kind: 'wow-reset', runAt: nextReset(new Date()), payload: { guildId }, dedupeKey: key });
  }
}
