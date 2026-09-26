/**
 * Weekly report, Sunday 19:00 (Europe/Stockholm) in #annonser (feature `veckorapport`), or on demand
 * with /admin veckorapport-nu. Numbers come from existing tables (voice sessions, message log, music
 * playback log, raids); Jev only picks the quote of the week among this week's quotes (Choice) and a
 * mood headline. Without Jev a random quote and a neutral headline are used.
 */
import { isPostable, type PostableChannel } from '../core/channels.js';
import { EmbedBuilder, type Client, type Guild } from 'discord.js';
import { registerAdminSubcommand } from '../commands/admin.js';
import { EPHEMERAL, pick } from '../commands/_shared.js';
import { features } from '../core/features.js';
import { UserFacingError } from '../core/interaction-errors.js';
import { childLogger } from '../core/logger.js';
import type { JobHandler, Scheduler } from '../core/scheduler.js';
import { nextWeeklyStockholm } from '../core/time.js';
import { db, type Queryable } from '../db.js';
import { isJevUnavailable, jev } from '../jev/client.js';
import { jevOptOut } from '../jev/store.js';
import { choice } from '../jev/types.js';
import { boundChannelId } from '../setup/executor.js';

const log = childLogger('weekly-report');
export const REPORT_WEEKDAY = 7; // Sunday
export const REPORT_HOUR = 19;

export type WeeklyStats = {
  voiceHours: number;
  topVoice: { name: string; hours: number }[];
  topChatters: { name: string; count: number }[];
  topSong: { title: string; artist: string | null; plays: number } | null;
  quotes: { id: string; content: string; author_id: string; author_name: string }[];
  raidsHeld: number;
  raidsUpcoming: number;
};

export async function collectWeeklyStats(q: Queryable, guildId: string, now: Date): Promise<WeeklyStats> {
  const from = new Date(now.getTime() - 7 * 86_400_000);
  const [voice, chat, song, quotes, raids] = await Promise.all([
    q.query<{ username: string; secs: string }>(
      `SELECT max(username) AS username,
              sum(extract(epoch FROM (LEAST(COALESCE(left_at, $3), $3) - GREATEST(joined_at, $2))))::text AS secs
       FROM stats.voice_sessions
       WHERE guild_id = $1 AND joined_at < $3 AND COALESCE(left_at, $3) > $2
       GROUP BY user_id ORDER BY sum(extract(epoch FROM (LEAST(COALESCE(left_at, $3), $3) - GREATEST(joined_at, $2)))) DESC`,
      [guildId, from, now],
    ),
    q.query<{ username: string; n: string }>(
      `SELECT max(username) AS username, count(*)::text AS n FROM stats.message_log
       WHERE guild_id = $1 AND created_at >= $2 AND created_at < $3
       GROUP BY user_id ORDER BY count(*) DESC LIMIT 3`,
      [guildId, from, now],
    ),
    q.query<{ title: string; artist: string | null; n: string }>(
      `SELECT title, artist, count(*)::text AS n FROM bot.music_playback_log
       WHERE guild_id = $1 AND event = 'play_start' AND created_at >= $2 AND created_at < $3 AND title IS NOT NULL
       GROUP BY title, artist ORDER BY count(*) DESC, max(created_at) DESC LIMIT 1`,
      [guildId, from, now],
    ),
    q.query<{ id: string; content: string; author_id: string; author_name: string }>(
      `SELECT id::text AS id, content, author_id, author_name FROM bot.quotes
       WHERE guild_id = $1 AND saved_at >= $2 AND saved_at < $3 ORDER BY saved_at LIMIT 25`,
      [guildId, from, now],
    ),
    q.query<{ held: string; upcoming: string }>(
      `SELECT count(*) FILTER (WHERE starts_at >= $2 AND starts_at < $3 AND status <> 'cancelled')::text AS held,
              count(*) FILTER (WHERE starts_at >= $3 AND starts_at < $3::timestamptz + interval '7 days' AND status = 'open')::text AS upcoming
       FROM bot.raid_events WHERE guild_id = $1`,
      [guildId, from, now],
    ),
  ]);
  const voiceRows = voice.rows.map((r) => ({ name: r.username, hours: Number(r.secs) / 3600 })).filter((r) => r.hours > 0);
  return {
    voiceHours: voiceRows.reduce((a, r) => a + r.hours, 0),
    topVoice: voiceRows.slice(0, 3),
    topChatters: chat.rows.map((r) => ({ name: r.username, count: Number(r.n) })),
    topSong: song.rows[0] ? { title: song.rows[0].title, artist: song.rows[0].artist, plays: Number(song.rows[0].n) } : null,
    quotes: quotes.rows,
    raidsHeld: Number(raids.rows[0]?.held ?? 0),
    raidsUpcoming: Number(raids.rows[0]?.upcoming ?? 0),
  };
}

const HEADLINES = {
  kaos: 'Veckan då allt brann (lite) 🔥',
  mys: 'Mysveckan 🛋️',
  pepp: 'Peppveckan 🚀',
  dramatik: 'Såpoperaveckan 🎭',
  lugn: 'Den lugna veckan 🌙',
  galenskap: 'Veckan ingen kommer förklara för sina föräldrar 🤪',
} as const;
type Headline = keyof typeof HEADLINES;
const HEADLINE_CRITERIA: Record<Headline, string> = {
  kaos: 'Chaotic, messy, lots going wrong but funny',
  mys: 'Cosy, warm, friendly and relaxed',
  pepp: 'Excited, hyped, celebrating wins',
  dramatik: 'Drama, arguments, spicy moments',
  lugn: 'Quiet, calm, not much happening',
  galenskap: 'Absurd, unhinged, surreal humour',
};

async function pickQuoteAndHeadline(stats: WeeklyStats, guildId: string): Promise<{ quote: WeeklyStats['quotes'][number] | null; headline: string }> {
  const optOut = jevOptOut();
  const eligible = stats.quotes.filter((q) => !optOut.isOptedOut(q.author_id));
  const fallback = { quote: stats.quotes.length ? pick(stats.quotes) : null, headline: 'Veckan som var 📰' };
  const client = jev();
  if (!client.enabled || eligible.length === 0 || !(await features().isEnabled(guildId, 'jev'))) return fallback;
  try {
    const options = Object.fromEntries(eligible.map((q, i) => [`q${i + 1}`, q.content.slice(0, 300)]));
    const questions = {
      ...(eligible.length >= 2
        ? { best: choice('Which of the options is the funniest or most memorable quote of the week?', options) }
        : {}),
      mood: choice('Which headline best matches the mood of these quotes from a friend group this week?', HEADLINE_CRITERIA),
    };
    const res = await client.ask({ quotes: eligible.map((q) => q.content.slice(0, 300)) }, questions, { feature: 'weekly-report', guildId });
    const answers = res.answers as { best?: { choice: string }; mood: { choice: Headline } };
    const bestIndex = answers.best ? Number(answers.best.choice.slice(1)) - 1 : 0;
    return {
      quote: eligible[bestIndex] ?? eligible[0]!,
      headline: HEADLINES[answers.mood.choice] ?? fallback.headline,
    };
  } catch (err) {
    if (!isJevUnavailable(err)) log.warn({ err }, 'jev pick failed');
    return fallback;
  }
}

function fmtHours(h: number): string {
  return h >= 10 ? `${Math.round(h)} h` : `${h.toFixed(1).replace('.', ',')} h`;
}

export async function buildWeeklyReportEmbed(guild: Guild, now = new Date()): Promise<EmbedBuilder> {
  const stats = await collectWeeklyStats(db, guild.id, now);
  const { quote, headline } = await pickQuoteAndHeadline(stats, guild.id);
  const medals = ['🥇', '🥈', '🥉'];
  const embed = new EmbedBuilder()
    .setTitle(`📰 Veckorapporten: ${headline}`)
    .setColor(0xf39c12)
    .setFooter({ text: `${guild.name} · vecka som slutade ${now.toLocaleDateString('sv-SE', { timeZone: 'Europe/Stockholm' })}` });
  embed.addFields({
    name: '🔊 Röst',
    value: stats.voiceHours > 0
      ? `**${fmtHours(stats.voiceHours)}** tillsammans i röst.\n${stats.topVoice.map((v, i) => `${medals[i]} ${v.name}: ${fmtHours(v.hours)}`).join('\n')}`
      : 'Tyst i röstkanalerna den här veckan. 🦗',
    inline: true,
  });
  embed.addFields({
    name: '💬 Mest aktiva',
    value: stats.topChatters.length ? stats.topChatters.map((c, i) => `${medals[i]} ${c.name}: ${c.count} meddelanden`).join('\n') : 'Ingen sa något. Misstänkt.',
    inline: true,
  });
  embed.addFields({
    name: '🎵 Veckans låt',
    value: stats.topSong ? `**${stats.topSong.title}**${stats.topSong.artist ? ` – ${stats.topSong.artist}` : ''} (${stats.topSong.plays} gånger)` : 'Ingen musik i veckan. Skäms.',
  });
  if (quote) {
    embed.addFields({ name: '📖 Veckans citat', value: `> ${quote.content.slice(0, 900).split('\n').join('\n> ')}\n— **${quote.author_name}**` });
  }
  if (stats.raidsHeld || stats.raidsUpcoming) {
    embed.addFields({ name: '⚔️ WoW', value: `${stats.raidsHeld} raider/dungeons i veckan · ${stats.raidsUpcoming} inbokade nästa vecka` });
  }
  return embed;
}

async function reportChannel(guild: Guild): Promise<PostableChannel | null> {
  const id = await boundChannelId(db, guild, 'ch.annonser', 'annonser');
  const ch = id ? await guild.channels.fetch(id).catch(() => null) : null;
  return isPostable(ch) ? ch : null;
}

export function weeklyReportJob(getClient: () => Client): JobHandler<{ guildId: string }> {
  return async (payload, { job }) => {
    try {
      if (await features().isEnabled(payload.guildId, 'veckorapport')) {
        const guild = await getClient().guilds.fetch(payload.guildId);
        const ch = await reportChannel(guild);
        if (ch) await ch.send({ embeds: [await buildWeeklyReportEmbed(guild)], allowedMentions: { parse: [] } });
        else log.warn({ guildId: payload.guildId }, 'no #annonser channel for the weekly report');
      }
    } catch (err) {
      log.error({ err, guildId: payload.guildId }, 'weekly report failed');
    }
    const after = new Date(Math.max(Date.now(), new Date(job.run_at).getTime()));
    return { nextRunAt: nextWeeklyStockholm(after, REPORT_WEEKDAY, REPORT_HOUR, 0) };
  };
}

export async function ensureWeeklyReportJobs(client: Client, scheduler: Scheduler): Promise<void> {
  for (const guildId of client.guilds.cache.keys()) {
    const key = `weekly-report:${guildId}`;
    if (await scheduler.hasPending(key)) continue;
    await scheduler.schedule({
      guildId,
      kind: 'weekly-report',
      runAt: nextWeeklyStockholm(new Date(), REPORT_WEEKDAY, REPORT_HOUR, 0),
      payload: { guildId },
      dedupeKey: key,
    });
  }
}

registerAdminSubcommand('veckorapport-nu', {
  build: (s) => s.setDescription('Posta veckorapporten nu (i #annonser, annars här).'),
  async execute(interaction) {
    const guild = interaction.guild;
    if (!guild) throw new UserFacingError('Bara i en server.');
    await interaction.deferReply({ flags: EPHEMERAL });
    const embed = await buildWeeklyReportEmbed(guild);
    const ch = (await reportChannel(guild)) ?? (isPostable(interaction.channel) ? interaction.channel : null);
    if (!ch) throw new UserFacingError('Hittar ingen kanal att posta i.');
    await ch.send({ embeds: [embed], allowedMentions: { parse: [] } });
    await interaction.editReply(`📰 Veckorapporten är postad i <#${ch.id}>.`);
  },
});
