/**
 * Music panel: one bot-owned message per server that shows what is playing, what is next and buttons
 * for pause, skip and stop, so nobody has to remember commands or wonder what is on.
 *
 * It lives in #musik (setup binding `ch.musik`, or any channel named "musik"); a server without one gets
 * it in the channel where /play was last used. The message id is kept in bot.setup_bindings, like the
 * role picker. Every player change (slash commands, these buttons and the hub over HTTP) redraws it,
 * debounced. In #musik a new song reposts it so it stays at the bottom of the channel.
 */
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  escapeMarkdown,
  type Channel,
  type Client,
  type Guild,
  type Message,
  type VoiceChannel,
} from 'discord.js';
import { EPHEMERAL, clock, plural, requireGuildId } from './commands/_shared.js';
import { isPostable, type PostableChannel } from './core/channels.js';
import { customId, type ComponentHandler } from './core/components.js';
import { features } from './core/features.js';
import { UserFacingError } from './core/interaction-errors.js';
import { isShuttingDown } from './core/lifecycle.js';
import { childLogger } from './core/logger.js';
import { discordTimestamp } from './core/time.js';
import { db, type Queryable } from './db.js';
import {
  isPaused,
  musicEvents,
  pause,
  playFromQueue,
  previous,
  resume,
  shuffleQueue,
  skip,
  stop,
  type MusicChange,
} from './music-player.js';
import { bind, boundChannelId, loadBindings } from './setup/executor.js';

const log = childLogger('music-panel');

export const MUSIC_CHANNEL_KEY = 'ch.musik';
export const MUSIC_PANEL_BINDING = 'msg.music-panel';
const MUSIC_PANEL_CHANNEL_BINDING = 'msg.music-panel.channel';
const DEBOUNCE_MS = 1_000;
const QUEUE_PREVIEW = 5;

type PanelChannel = PostableChannel | VoiceChannel;

export type MusicState = {
  now: {
    title: string;
    artist: string | null;
    trackUrl: string;
    thumbnail: string | null;
    durationSec: number | null;
    requestedBy: string;
    voiceChannelId: string;
    paused: boolean;
    startedAt: Date;
    updatedAt: Date;
  } | null;
  queue: { title: string; artist: string | null; durationSec: number | null }[];
  queueTotal: number;
};

export async function loadMusicState(q: Queryable, guildId: string): Promise<MusicState> {
  const [nowRes, queueRes, countRes] = await Promise.all([
    q.query<{
      title: string; artist: string | null; track_url: string; thumbnail: string | null; duration_sec: number | null;
      requested_by: string; channel_id: string; is_paused: boolean; started_at: Date; updated_at: Date;
    }>(
      `SELECT title, artist, track_url, thumbnail, duration_sec, requested_by, channel_id, is_paused, started_at, updated_at
       FROM bot.music_now_playing WHERE guild_id = $1`,
      [guildId],
    ),
    q.query<{ title: string; artist: string | null; duration_sec: number | null }>(
      'SELECT title, artist, duration_sec FROM bot.music_queue WHERE guild_id = $1 ORDER BY added_at LIMIT $2',
      [guildId, QUEUE_PREVIEW],
    ),
    q.query<{ n: string }>('SELECT count(*)::text AS n FROM bot.music_queue WHERE guild_id = $1', [guildId]),
  ]);
  const n = nowRes.rows[0];
  return {
    now: n
      ? {
          title: n.title,
          artist: n.artist,
          trackUrl: n.track_url,
          thumbnail: n.thumbnail,
          durationSec: n.duration_sec,
          requestedBy: n.requested_by,
          voiceChannelId: n.channel_id,
          paused: n.is_paused,
          startedAt: new Date(n.started_at),
          updatedAt: new Date(n.updated_at),
        }
      : null,
    queue: queueRes.rows.map((r) => ({ title: r.title, artist: r.artist, durationSec: r.duration_sec })),
    queueTotal: Number(countRes.rows[0]?.n ?? 0),
  };
}

// ── Rendering ────────────────────────────────────────────────────────────────

const isHttpUrl = (s: string | null | undefined): s is string => !!s && /^https?:\/\//i.test(s);

function trackLine(t: { title: string; artist: string | null; durationSec: number | null }): string {
  return `${escapeMarkdown(t.title)}${t.artist ? ` – ${escapeMarkdown(t.artist)}` : ''}${t.durationSec ? ` \`${clock(t.durationSec)}\`` : ''}`;
}

function queueField(state: MusicState): { name: string; value: string } {
  if (!state.queueTotal) return { name: '📜 Näst på tur', value: 'Kön är tom. Lägg till fler med `/play`.' };
  const lines = state.queue.map((t, i) => `${i + 1}. ${trackLine(t)}`);
  const more = state.queueTotal - state.queue.length;
  if (more > 0) lines.push(`-# …och ${plural(more, 'låt', 'låtar')} till`);
  return { name: `📜 Näst på tur (${state.queueTotal})`, value: lines.join('\n').slice(0, 1024) };
}

function button(action: string, emoji: string, label: string, style: ButtonStyle): ButtonBuilder {
  return new ButtonBuilder().setCustomId(customId('music', action)).setEmoji(emoji).setLabel(label).setStyle(style);
}

export function renderMusicPanel(state: MusicState) {
  if (!state.now) {
    const embed = new EmbedBuilder()
      .setTitle('🎵 Musik')
      .setColor(0x4f545c)
      .setDescription(
        state.queueTotal > 0
          ? `Tyst just nu, men ${plural(state.queueTotal, 'låt väntar', 'låtar väntar')} i kön.\n` +
              'Hoppa in i en röstkanal och tryck **Fortsätt kön**, eller kör `/play` med något nytt.'
          : 'Tyst just nu. Hoppa in i en röstkanal och kör `/play` med en låt, en länk eller en spellista.\n' +
              'Här syns sen vad som spelas, vad som står på tur och knappar för paus, nästa och stopp.',
      );
    if (state.queueTotal > 0) embed.addFields(queueField(state));
    const components =
      state.queueTotal > 0
        ? [new ActionRowBuilder<ButtonBuilder>().addComponents(button('start', '▶️', 'Fortsätt kön', ButtonStyle.Success))]
        : [];
    return { embeds: [embed], components };
  }

  const t = state.now;
  const pausedAt = Math.max(0, (t.updatedAt.getTime() - t.startedAt.getTime()) / 1000);
  const timing = t.durationSec
    ? t.paused
      ? `⏸️ Pausad vid ${clock(pausedAt)} av ${clock(t.durationSec)}`
      : `⏱️ ${clock(t.durationSec)} · slut ${discordTimestamp(new Date(t.startedAt.getTime() + t.durationSec * 1000), 'R')}`
    : t.paused
      ? '⏸️ Pausad'
      : `⏱️ Startade ${discordTimestamp(t.startedAt, 'R')}`;
  const embed = new EmbedBuilder()
    .setTitle(t.paused ? '⏸️ Pausad' : '🎶 Spelar nu')
    .setDescription(
      [
        `**${escapeMarkdown(t.title)}**${t.artist ? `\n${escapeMarkdown(t.artist)}` : ''}`,
        '',
        timing,
        `🎧 <#${t.voiceChannelId}> · önskad av <@${t.requestedBy}>`,
      ].join('\n'),
    )
    .setColor(t.paused ? 0xfaa61a : 0x1db954)
    .addFields(queueField(state))
    .setFooter({ text: 'Knapparna styr musiken för alla · /play lägger till fler låtar' });
  if (isHttpUrl(t.trackUrl)) embed.setURL(t.trackUrl);
  if (isHttpUrl(t.thumbnail)) embed.setThumbnail(t.thumbnail);

  const controls = new ActionRowBuilder<ButtonBuilder>().addComponents(
    button('prev', '⏮️', 'Förra', ButtonStyle.Secondary),
    t.paused ? button('toggle', '▶️', 'Spela', ButtonStyle.Success) : button('toggle', '⏸️', 'Pausa', ButtonStyle.Primary),
    button('skip', '⏭️', 'Nästa', ButtonStyle.Secondary),
    button('shuffle', '🔀', 'Blanda', ButtonStyle.Secondary).setDisabled(state.queueTotal < 2),
    button('stop', '⏹️', 'Stopp', ButtonStyle.Danger),
  );
  return { embeds: [embed], components: [controls] };
}

// ── Where the panel lives ────────────────────────────────────────────────────

/** Where /play was last used per guild: the panel's home in servers without #musik. */
const lastCommandChannel = new Map<string, string>();

export function rememberMusicChannel(guildId: string, channelId: string): void {
  lastCommandChannel.set(guildId, channelId);
}

function isPanelChannel(ch: Channel | null | undefined): ch is PanelChannel {
  return isPostable(ch) || ch?.type === ChannelType.GuildVoice;
}

/** The server's dedicated music channel (#musik), if it has one. */
export async function musicChannelId(guild: Guild): Promise<string | null> {
  const id = await boundChannelId(db, guild, MUSIC_CHANNEL_KEY, 'musik');
  return id && isPanelChannel(guild.channels.cache.get(id)) ? id : null;
}

async function resolvePanelChannel(guild: Guild): Promise<{ channel: PanelChannel; dedicated: boolean } | null> {
  const dedicated = await musicChannelId(guild);
  if (dedicated) return { channel: guild.channels.cache.get(dedicated) as PanelChannel, dedicated: true };
  const bindings = await loadBindings(db, guild.id);
  for (const id of [lastCommandChannel.get(guild.id), bindings[MUSIC_PANEL_CHANNEL_BINDING]]) {
    const ch = id ? guild.channels.cache.get(id) : undefined;
    if (isPanelChannel(ch)) return { channel: ch, dedicated: false };
  }
  return null;
}

// ── Refreshing ───────────────────────────────────────────────────────────────

const inflight = new Map<string, Promise<void>>();
const pending = new Map<string, { timer: NodeJS.Timeout; repost: boolean }>();

/** Redraw (or first post) the panel now. Serialised per guild so two refreshes never post twice. */
export function refreshMusicPanel(client: Client, guildId: string, opts: { repost?: boolean } = {}): Promise<void> {
  const prev = inflight.get(guildId) ?? Promise.resolve();
  const next = prev.catch(() => undefined).then(() => doRefresh(client, guildId, opts.repost ?? false));
  inflight.set(guildId, next);
  void next.finally(() => {
    if (inflight.get(guildId) === next) inflight.delete(guildId);
  }).catch(() => undefined);
  return next;
}

async function doRefresh(client: Client, guildId: string, repost: boolean): Promise<void> {
  if (isShuttingDown()) return;
  const guild = client.guilds.cache.get(guildId);
  if (!guild) return;
  const target = await resolvePanelChannel(guild);
  if (!target) return;
  const state = await loadMusicState(db, guildId);
  const bindings = await loadBindings(db, guildId);
  const oldId = bindings[MUSIC_PANEL_BINDING];
  const oldChannelId = bindings[MUSIC_PANEL_CHANNEL_BINDING];

  let msg: Message | null = null;
  if (oldId && oldChannelId === target.channel.id) {
    msg = await target.channel.messages.fetch(oldId).catch(() => null);
  } else if (oldId && oldChannelId) {
    // The panel moved to another channel: remove the old one so there is only ever one.
    const oldChannel = guild.channels.cache.get(oldChannelId);
    if (isPanelChannel(oldChannel)) await oldChannel.messages.delete(oldId).catch(() => undefined);
  }
  // Outside #musik, don't start a new panel just to announce silence.
  if (!msg && !state.now && !target.dedicated) return;

  const payload = { ...renderMusicPanel(state), allowedMentions: { parse: [] } };
  if (msg && repost && target.dedicated && target.channel.lastMessageId !== msg.id) {
    await msg.delete().catch(() => undefined);
    msg = null;
  }
  if (msg) {
    await msg.edit(payload);
    return;
  }
  const sent = await target.channel.send(payload);
  await bind(db, guildId, MUSIC_PANEL_BINDING, 'message', sent.id);
  await bind(db, guildId, MUSIC_PANEL_CHANNEL_BINDING, 'channel', target.channel.id);
}

function scheduleRefresh(client: Client, guildId: string, change: MusicChange): void {
  if (isShuttingDown()) return;
  const prev = pending.get(guildId);
  if (prev) clearTimeout(prev.timer);
  const repost = (prev?.repost ?? false) || change === 'track';
  const timer = setTimeout(() => {
    pending.delete(guildId);
    refreshMusicPanel(client, guildId, { repost }).catch((err) => log.warn({ err, guildId }, 'music panel refresh failed'));
  }, DEBOUNCE_MS);
  timer.unref();
  pending.set(guildId, { timer, repost });
}

/** Redraw the panel whenever the player changes, wherever the change came from. */
export function registerMusicPanel(client: Client): void {
  musicEvents.on('change', (guildId, change) => scheduleRefresh(client, guildId, change));
}

/** After login: bring every panel in line with reality (a restart stops playback). */
export async function refreshAllMusicPanels(client: Client<true>): Promise<void> {
  for (const guildId of client.guilds.cache.keys()) {
    await refreshMusicPanel(client, guildId).catch((err) => log.warn({ err, guildId }, 'music panel refresh failed'));
  }
}

// ── Buttons ──────────────────────────────────────────────────────────────────

export const musicPanelComponents: ComponentHandler = {
  prefix: 'music',
  async handle(interaction, parsed) {
    if (!interaction.isButton()) return;
    const guildId = requireGuildId(interaction);
    await features().require(guildId, 'musik');

    if (parsed.action === 'start') {
      const voiceChannelId = interaction.guild?.members.cache.get(interaction.user.id)?.voice.channelId;
      if (!voiceChannelId) throw new UserFacingError('🎧 Hoppa in i en röstkanal först, så kommer jag efter.');
      await interaction.deferUpdate();
      const track = await playFromQueue(interaction.client, guildId, voiceChannelId);
      if (!track) await interaction.followUp({ content: '📭 Kön är tom, eller så spelas det redan något.', flags: EPHEMERAL });
      return;
    }

    await interaction.deferUpdate();
    switch (parsed.action) {
      case 'toggle':
        if (isPaused(guildId)) await resume(guildId);
        else await pause(guildId);
        break;
      case 'skip':
        await skip(guildId);
        break;
      case 'prev':
        if (!(await previous(guildId))) {
          await interaction.followUp({ content: 'ℹ️ Ingen tidigare låt i den här sessionen.', flags: EPHEMERAL });
        }
        break;
      case 'shuffle': {
        const n = await shuffleQueue(guildId);
        await interaction.followUp({ content: `🔀 Blandade ${plural(n, 'låt', 'låtar')} i kön.`, flags: EPHEMERAL });
        break;
      }
      case 'stop':
        await stop(guildId);
        break;
      default:
        throw new UserFacingError('Den här knappen känner jag inte igen.');
    }
    log.info({ guildId, userId: interaction.user.id, action: parsed.action }, 'music panel button');
    // A panel left over from before a restart gets back in sync even when the press changed nothing.
    scheduleRefresh(interaction.client, guildId, 'state');
  },
};
