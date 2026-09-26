import './media-env.js';
import {
  AudioPlayerStatus,
  VoiceConnectionStatus,
  createAudioPlayer,
  createAudioResource,
  entersState,
  generateDependencyReport,
  getVoiceConnection,
  getVoiceConnections,
  joinVoiceChannel,
  StreamType,
  type AudioPlayer,
  type VoiceConnection,
} from '@discordjs/voice';
import { EventEmitter } from 'node:events';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { type Client } from 'discord.js';
import playdl from 'play-dl';
import { FFMPEG_STATIC_BIN, resolveYtDlpSpawnPath, ytdlpExtraArgs } from './media-env.js';
import { fetchSpotifyTitle, fetchSpotifyTrackPublic, parseSpotifyUrl } from './spotify-public.js';
import { getPool } from './db.js';
import { childLogger } from './core/logger.js';

const log = childLogger('music');

/** yt-dlp `--download-sections` start timestamp, e.g. *1:30-inf (from 90s to end). */
function ytdlpDownloadSectionFromStartSec(startSec: number): string {
  const s = Math.max(0, Math.floor(startSec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  if (h > 0) return `*${h}:${pad(m)}:${pad(sec)}-inf`;
  return `*${m}:${pad(sec)}-inf`;
}

/** yt-dlp needs a real ffmpeg binary for partial downloads (`--download-sections`), not only Opus encoding. */
function ytdlpFfmpegLocationArgs(): string[] {
  const fromEnv = process.env.FFMPEG_PATH?.trim();
  if (fromEnv) {
    const n = path.normalize(fromEnv);
    if (existsSync(n)) return ['--ffmpeg-location', n];
  }
  if (FFMPEG_STATIC_BIN) {
    const n = path.normalize(FFMPEG_STATIC_BIN);
    if (existsSync(n)) return ['--ffmpeg-location', n];
  }
  return [];
}

function logVoiceReadyFailureHints(): void {
  const inDocker = existsSync('/.dockerenv');
  if (inDocker) {
    log.error('Voice never reached Ready (timeout/aborted). In Docker this is usually bridge NAT blocking UDP to Discord.');
    log.error('Fix: Linux/Pi → `discord-bot-host` (compose profile `discord-host`). Docker Desktop → run on host: `npm run bot:dev`.');
  } else {
    log.error('Voice never reached Ready (timeout/aborted). Signalling/UDP to Discord failed (not Opus/FFmpeg if the report below looks OK).');
    log.error('On Windows: allow Node.js in Windows Defender Firewall (private networks); try with VPN off; ensure the bot role can Connect and Speak in that voice channel.');
    log.error('If it still fails, try another network (e.g. phone hotspot) to rule out ISP/router blocking UDP.');
  }
  log.error({ report: generateDependencyReport() }, 'voice dependency report');
}

export type TrackSource = 'youtube' | 'soundcloud' | 'spotify';

export type Track = {
  url: string;
  title: string;
  artist: string | null;
  thumbnail: string | null;
  durationSec: number | null;
  source: TrackSource;
  requestedBy: string;
  channelId: string;
};

const PLAYBACK_HISTORY_MAX = 50;

/**
 * What changed for a guild, so listeners (the Discord music panel) know what to redraw:
 * 'track' = a new song started, 'state' = pause/resume/seek/stop, 'queue' = the queue changed.
 * Emitted after the DB write, from every entry point (slash commands, buttons and the hub over HTTP).
 */
export type MusicChange = 'track' | 'state' | 'queue';
export const musicEvents = new EventEmitter<{ change: [guildId: string, change: MusicChange] }>();

function notifyChange(guildId: string, change: MusicChange): void {
  musicEvents.emit('change', guildId, change);
}

type GuildPlayer = {
  player: AudioPlayer;
  connection: VoiceConnection;
  currentTrack: Track | null;
  /** yt-dlp child for the current YouTube stream; must be killed on skip/stop before the player tears down the pipe. */
  ytdlpProc: ChildProcess | null;
  /** Recent tracks for `/previous` (in-memory, cleared on full stop / voice teardown). */
  playbackHistory: Track[];
  /** Set before `player.stop()` so Idle can log why playback ended (`natural` if unset). */
  idlePlaybackCause: 'natural' | 'skip' | 'stop' | null;
  /** Seek uses `stop(true)`; skip Idle queue pop / teardown so the same track can restart. */
  suppressNextIdleQueueAdvance: boolean;
  /** Merged into `playback_ended` meta (e.g. queue_items_cleared on stop). */
  pendingPlaybackMeta: Record<string, unknown> | null;
};

function pushPlaybackHistory(gp: GuildPlayer, track: Track): void {
  const last = gp.playbackHistory[gp.playbackHistory.length - 1];
  if (last?.url === track.url) return;
  gp.playbackHistory.push({ ...track });
  if (gp.playbackHistory.length > PLAYBACK_HISTORY_MAX) {
    gp.playbackHistory.splice(0, gp.playbackHistory.length - PLAYBACK_HISTORY_MAX);
  }
}

type MusicPlaybackLogEvent =
  | 'queued'
  | 'play_start'
  | 'playback_ended'
  | 'pause'
  | 'resume'
  | 'seek';

/** Best-effort insert; never throws (missing migration or DB errors must not break playback). */
async function recordMusicPlaybackLog(params: {
  guildId: string;
  event: MusicPlaybackLogEvent;
  track?: Track | null;
  meta?: Record<string, unknown> | null;
}): Promise<void> {
  const { guildId, event, track, meta } = params;
  try {
    const pool = getPool();
    const metaJson =
      meta && Object.keys(meta).length > 0 ? JSON.stringify(meta) : null;
    await pool.query(
      `INSERT INTO bot.music_playback_log (
        guild_id, event, track_url, title, artist, source, duration_sec,
        requested_by, channel_id, meta
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)`,
      [
        guildId,
        event,
        track?.url ?? null,
        track?.title ?? null,
        track?.artist ?? null,
        track?.source ?? null,
        track?.durationSec ?? null,
        track?.requestedBy ?? null,
        track?.channelId ?? null,
        metaJson,
      ],
    );
  } catch (e) {
    log.warn({ detail: (e as Error).message }, 'music_playback_log');
  }
}

const players = new Map<string, GuildPlayer>();

function isConnectionUsable(connection: VoiceConnection): boolean {
  return connection.state.status !== VoiceConnectionStatus.Destroyed &&
    connection.state.status !== VoiceConnectionStatus.Disconnected;
}

function isActivelyPlaying(gp: GuildPlayer | undefined): gp is GuildPlayer {
  return !!gp &&
    gp.player.state.status !== AudioPlayerStatus.Idle &&
    gp.connection.state.status === VoiceConnectionStatus.Ready;
}

function destroyGuildPlayer(gid: string, gp: GuildPlayer): void {
  killActiveYtdlp(gid);
  if (gp.connection.state.status !== VoiceConnectionStatus.Destroyed) {
    gp.connection.destroy();
  }
  players.delete(gid);
}

function isBenignYtdlpShutdownMessage(line: string): boolean {
  return /broken pipe|unable to write data|errno\s*32|errno\s*22|invalid argument/i.test(line);
}

/** Stop yt-dlp before closing the audio stream (skip/stop/new track) to avoid broken-pipe noise. */
function killActiveYtdlp(gid: string): void {
  const gp = players.get(gid);
  if (!gp?.ytdlpProc) return;
  const p = gp.ytdlpProc;
  gp.ytdlpProc = null;
  try {
    p.kill('SIGTERM');
  } catch {
    /* ignore */
  }
}

/** Discord snowflakes must be strings for @discordjs/voice; numeric IDs can leave the connection stuck in signalling (see discord.js voice docs / common pitfalls). */
function voiceSnowflake(id: string | number | bigint): string {
  return String(id).trim();
}

let spotifyToken: { access_token: string; expires_at: number } | null = null;

async function getSpotifyToken(): Promise<string | null> {
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  if (spotifyToken && Date.now() < spotifyToken.expires_at - 30_000) {
    return spotifyToken.access_token;
  }

  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });

  if (!res.ok) throw new Error(`Spotify auth failed: ${res.status}`);
  const data = (await res.json()) as { access_token: string; expires_in: number };
  spotifyToken = { access_token: data.access_token, expires_at: Date.now() + data.expires_in * 1000 };
  return spotifyToken.access_token;
}

/**
 * play-dl YouTube search can return videos with `id` set but `url` empty; streaming needs a watch URL.
 */
function youtubeWatchUrlFromSearchResult(yt: { url?: string; id?: string }): string | null {
  const direct = yt.url?.trim();
  if (direct) return direct;
  const id = yt.id?.trim();
  if (id) return `https://www.youtube.com/watch?v=${id}`;
  return null;
}

const PLAYLIST_MAX_TRACKS = 50;

/** Parallel YouTube lookups when resolving Spotify (→ YouTube) playlist rows; avoids N sequential searches. */
function playlistYoutubeSearchConcurrency(): number {
  const raw = process.env.MUSIC_PLAYLIST_SEARCH_CONCURRENCY?.trim();
  const n = raw ? Number(raw) : 12;
  if (!Number.isFinite(n) || n < 1) return 12;
  return Math.min(24, Math.floor(n));
}

/**
 * Run async work over `items` with at most `concurrency` tasks in flight.
 * Results are in the same order as `items`.
 */
async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Math.max(1, Math.min(concurrency, items.length));

  async function worker(): Promise<void> {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i]!, i);
    }
  }

  await Promise.all(Array.from({ length: workers }, () => worker()));
  return out;
}

function spotifyDefaultMarket(): string {
  const m = process.env.SPOTIFY_DEFAULT_MARKET?.trim().toUpperCase();
  return m && /^[A-Z]{2}$/.test(m) ? m : 'US';
}

type PlaylistResolution = { title: string; tracks: Track[] };

type SpotifyPlaylistTrackItem = {
  track: { name: string; artists?: { name?: string }[]; duration_ms?: number } | null;
};

/** Playlist track row after we drop nulls, local files, and episodes without duration. */
type SpotifyMusicTrackRow = { name: string; artists?: { name?: string }[]; duration_ms: number };

/** open.spotify.com/playlist/ID and open.spotify.com/intl-xx/playlist/ID */
function spotifyPlaylistIdFromUrl(url: string): string | null {
  const m = url.match(/spotify\.com\/(?:intl-[a-z]{2}\/)?playlist\/([A-Za-z0-9]+)/i);
  return m?.[1] ?? null;
}

/** Public embed page returns SSR track rows when Web API returns 403 (editorial / policy). */
const SPOTIFY_EMBED_UA =
  process.env.SPOTIFY_EMBED_USER_AGENT?.trim() ||
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

type SpotifyEmbedRow = { name: string; artist: string; durationSec: number | null };

function parseMmSsDuration(s: string): number | null {
  const m = s.trim().match(/^(\d+):(\d{2})$/);
  if (!m) return null;
  const min = Number(m[1]);
  const sec = Number(m[2]);
  if (!Number.isFinite(min) || !Number.isFinite(sec) || sec > 59) return null;
  return min * 60 + sec;
}

function parseSpotifyEmbedPlaylistHtml(html: string): { title: string; rows: SpotifyEmbedRow[] } | null {
  if (!html.includes('TracklistRow_title')) return null;

  const titleMatch = html.match(
    /data-encore-id="text"[^>]*dir="auto">([^<]+)<\/span><span[^>]*CondensedMetadata_separator/u,
  );
  const title = titleMatch?.[1]?.trim() || 'Spotify playlist';

  const rows: SpotifyEmbedRow[] = [];
  const re =
    /<h3[^>]*TracklistRow_title[^>]*>([^<]+)<\/h3>\s*<h4[^>]*TracklistRow_subtitle[^>]*>([^<]+)<\/h4>[\s\S]*?data-testid="duration-cell"[^>]*>([^<]+)<\/div>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null && rows.length < PLAYLIST_MAX_TRACKS) {
    rows.push({
      name: m[1].trim(),
      artist: m[2].trim(),
      durationSec: parseMmSsDuration(m[3] ?? '') ?? null,
    });
  }

  return rows.length ? { title, rows } : null;
}

/** Track rows from the public embed page; album and playlist embeds share the same markup (checked 2026-09-26). */
async function fetchSpotifyListViaEmbed(
  kind: 'playlist' | 'album',
  id: string,
): Promise<{ title: string; rows: SpotifyEmbedRow[] } | null> {
  const embedUrl = `https://open.spotify.com/embed/${kind}/${encodeURIComponent(id)}`;
  try {
    const res = await fetch(embedUrl, {
      headers: {
        'User-Agent': SPOTIFY_EMBED_UA,
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });
    if (!res.ok) {
      log.warn(`Spotify embed page HTTP ${res.status}`);
      return null;
    }
    return parseSpotifyEmbedPlaylistHtml(await res.text());
  } catch (err) {
    log.warn({ detail: (err as Error).message }, 'Spotify embed fetch failed');
    return null;
  }
}

/** Albums always, and playlists without keys, come from the embed page. */
async function resolveSpotifyListViaEmbed(
  kind: 'playlist' | 'album',
  id: string,
  requestedBy: string,
  channelId: string,
): Promise<PlaylistResolution | null> {
  const [embedded, title] = await Promise.all([fetchSpotifyListViaEmbed(kind, id), fetchSpotifyTitle(kind, id)]);
  if (!embedded?.rows.length) {
    log.warn({ kind, id }, 'Spotify embed page listed no tracks (private or removed?)');
    return null;
  }
  const tracks = await spotifyTrackNamesToYoutubeTracks(embedded.rows, requestedBy, channelId);
  if (!tracks.length) return null;
  return { title: title ?? embedded.title, tracks };
}

async function tryResolveSpotifyPlaylistFrom403Embed(
  playlistId: string,
  playlistTitle: string,
  requestedBy: string,
  channelId: string,
): Promise<PlaylistResolution | null> {
  log.warn('Spotify Web API returned 403 (many editorial/algorithmic playlists are blocked for newer developer apps since Nov 2024). Trying open.spotify.com/embed fallback…');
  const embedded = await fetchSpotifyListViaEmbed('playlist', playlistId);
  if (!embedded?.rows.length) {
    log.warn('Embed fallback found no tracks. Options: use a playlist you created (public), a YouTube playlist, or request extended Web API access from Spotify.');
    return null;
  }
  const tracks = await spotifyTrackNamesToYoutubeTracks(
    embedded.rows.map((r) => ({ name: r.name, artist: r.artist, durationSec: r.durationSec })),
    requestedBy,
    channelId,
  );
  if (!tracks.length) {
    log.warn(`Embed listed ${embedded.rows.length} tracks but none resolved on YouTube.`);
    return null;
  }
  if (embedded.rows.length > tracks.length) {
    log.warn(`Embed listed ${embedded.rows.length} tracks; ${tracks.length} resolved on YouTube (rest skipped or search missed).`);
  }
  const title = playlistTitle.trim() || embedded.title;
  return { title, tracks };
}

async function spotifyTrackNamesToYoutubeTracks(
  entries: Array<{ name: string; artist: string | null; durationSec: number | null }>,
  requestedBy: string,
  channelId: string,
): Promise<Track[]> {
  if (entries.length === 0) return [];
  const concurrency = playlistYoutubeSearchConcurrency();
  if (entries.length > 3) {
    log.info(`Spotify→YouTube: matching ${entries.length} tracks (${concurrency} parallel YouTube searches)…`);
  }
  const t0 = Date.now();
  const resolved = await mapWithConcurrency(entries, concurrency, async (t): Promise<Track | null> => {
    const searchQuery = `${t.name} ${t.artist ?? ''}`.trim();
    try {
      const results = await playdl.search(searchQuery, { source: { youtube: 'video' }, limit: 1 });
      if (!results.length) return null;
      const yt = results[0];
      const watchUrl = youtubeWatchUrlFromSearchResult(yt);
      if (!watchUrl) return null;
      const track: Track = {
        url: watchUrl,
        title: t.name,
        artist: t.artist,
        thumbnail: yt.thumbnails?.[0]?.url ?? null,
        durationSec: t.durationSec ?? yt.durationInSec ?? null,
        source: 'spotify',
        requestedBy,
        channelId,
      };
      return track;
    } catch {
      log.warn({ detail: searchQuery }, 'Could not resolve Spotify track');
      return null;
    }
  });
  const tracks = resolved.filter((x): x is Track => x !== null);
  if (entries.length > 3) {
    const sec = ((Date.now() - t0) / 1000).toFixed(1);
    log.info(`Spotify→YouTube: done ${tracks.length}/${entries.length} in ${sec}s (raise MUSIC_PLAYLIST_SEARCH_CONCURRENCY up to 24 if stable).`);
  }
  return tracks;
}

async function resolveSpotifyPlaylist(url: string, requestedBy: string, channelId: string): Promise<PlaylistResolution | null> {
  const playlistId = spotifyPlaylistIdFromUrl(url);
  if (!playlistId) return null;
  const token = await getSpotifyToken().catch(() => null);
  if (!token) return resolveSpotifyListViaEmbed('playlist', playlistId, requestedBy, channelId);

  const market = spotifyDefaultMarket();
  const headers = { Authorization: `Bearer ${token}` };

  const metaRes = await fetch(
    `https://api.spotify.com/v1/playlists/${encodeURIComponent(playlistId)}?fields=name`,
    { headers },
  );
  if (!metaRes.ok) {
    const body = await metaRes.text().catch(() => '');
    log.warn({ detail: body.slice(0, 400) }, `Spotify playlist meta failed: ${metaRes.status} ${metaRes.statusText}`);
    if (metaRes.status === 403) {
      const fromEmbed = await tryResolveSpotifyPlaylistFrom403Embed(
        playlistId,
        '',
        requestedBy,
        channelId,
      );
      if (fromEmbed) return fromEmbed;
    }
    if (metaRes.status === 403 || metaRes.status === 404) {
      log.warn('Tip: https://developer.spotify.com/blog/2024-11-27-changes-to-the-web-api — editorial playlists often need embed fallback or user OAuth.');
    }
    return null;
  }

  const meta = (await metaRes.json()) as { name: string };
  const playlistName = meta.name ?? 'Spotify Playlist';

  const items: SpotifyPlaylistTrackItem[] = [];
  let nextUrl: string | null =
    `https://api.spotify.com/v1/playlists/${encodeURIComponent(playlistId)}/tracks?limit=100&market=${encodeURIComponent(market)}`;
  let triedTracksWithoutMarket = false;

  while (nextUrl && items.length < PLAYLIST_MAX_TRACKS) {
    const res = await fetch(nextUrl, { headers });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      if (
        res.status === 403 &&
        items.length === 0 &&
        !triedTracksWithoutMarket &&
        nextUrl.includes('market=')
      ) {
        triedTracksWithoutMarket = true;
        nextUrl = `https://api.spotify.com/v1/playlists/${encodeURIComponent(playlistId)}/tracks?limit=100`;
        log.warn('Spotify playlist tracks 403 with market=; retrying without market parameter.');
        continue;
      }
      if (res.status === 403 && items.length === 0) {
        const fromEmbed = await tryResolveSpotifyPlaylistFrom403Embed(
          playlistId,
          playlistName,
          requestedBy,
          channelId,
        );
        if (fromEmbed) return fromEmbed;
      }
      log.warn({ detail: body.slice(0, 400) }, `Spotify playlist tracks page failed: ${res.status} ${res.statusText}`);
      return null;
    }
    const page = (await res.json()) as {
      items?: SpotifyPlaylistTrackItem[];
      next?: string | null;
      error?: { message?: string; status?: number };
    };
    if (page.error) {
      log.warn({ detail: page.error }, 'Spotify playlist tracks API error');
      return null;
    }
    const batch = Array.isArray(page.items) ? page.items : [];
    for (const row of batch) {
      if (items.length >= PLAYLIST_MAX_TRACKS) break;
      items.push(row);
    }
    nextUrl = page.next ?? null;
  }

  const withTrack = items
    .filter((i): i is { track: SpotifyMusicTrackRow } =>
      i.track != null &&
      typeof i.track.name === 'string' &&
      typeof i.track.duration_ms === 'number',
    )
    .slice(0, PLAYLIST_MAX_TRACKS);
  if (!withTrack.length) {
    log.warn(`Spotify playlist "${playlistName}" returned no playable track rows (market=${market}). Try SPOTIFY_DEFAULT_MARKET=SE or a public playlist.`);
    return null;
  }

  const entries = withTrack.map((item) => {
    const t = item.track;
    return {
      name: t.name,
      artist: t.artists?.[0]?.name ?? null,
      durationSec: Math.round(t.duration_ms / 1000),
    };
  });
  const tracks = await spotifyTrackNamesToYoutubeTracks(entries, requestedBy, channelId);

  if (!tracks.length) {
    log.warn(`Spotify playlist "${playlistName}" had ${withTrack.length} rows but none resolved to YouTube (search/play-dl).`);
    return null;
  }

  return { title: playlistName, tracks };
}

async function resolvePlaylist(query: string, requestedBy: string, channelId: string): Promise<PlaylistResolution | null> {
  try {
    // Spotify playlist (including open.spotify.com/intl-xx/playlist/…)
    if (/spotify\.com\/(?:intl-[a-z]{2}\/)?playlist\//i.test(query)) {
      return await resolveSpotifyPlaylist(query, requestedBy, channelId);
    }
    const spotifyLink = parseSpotifyUrl(query);
    if (spotifyLink?.kind === 'album') {
      return await resolveSpotifyListViaEmbed('album', spotifyLink.id, requestedBy, channelId);
    }

    // YouTube playlist
    const ytValidate = await playdl.yt_validate(query);
    if (ytValidate === 'playlist') {
      const info = await playdl.playlist_info(query, { incomplete: true });
      const videos = await info.all_videos();
      const tracks: Track[] = videos.slice(0, PLAYLIST_MAX_TRACKS).flatMap((v) => {
        const watchUrl = youtubeWatchUrlFromSearchResult(v);
        if (!watchUrl) return [];
        return [{
          url: watchUrl,
          title: v.title ?? 'Unknown',
          artist: v.channel?.name ?? null,
          thumbnail: v.thumbnails?.[0]?.url ?? null,
          durationSec: v.durationInSec ?? null,
          source: 'youtube' as TrackSource,
          requestedBy,
          channelId,
        }];
      });
      return { title: info.title ?? 'YouTube Playlist', tracks };
    }

    // SoundCloud set/playlist — union type needs explicit playlist branch + all_tracks()
    const scValidate = await playdl.so_validate(query);
    if (scValidate === 'playlist') {
      const info = await playdl.soundcloud(query);
      if (info.type !== 'playlist') return null;
      const playlist = info as {
        name: string;
        all_tracks(): Promise<
          Array<{ url: string; name: string; durationInMs: number; user: { name: string }; thumbnail?: string }>
        >;
      };
      let scTracks: Awaited<ReturnType<typeof playlist.all_tracks>>;
      try {
        scTracks = await playlist.all_tracks();
      } catch {
        return null;
      }
      const tracks: Track[] = scTracks.slice(0, PLAYLIST_MAX_TRACKS).flatMap((t) => {
        const url = t.url?.trim();
        if (!url) return [];
        return [
          {
            url,
            title: t.name,
            artist: t.user?.name ?? null,
            thumbnail: typeof t.thumbnail === 'string' ? t.thumbnail : null,
            durationSec: Math.round(t.durationInMs / 1000),
            source: 'soundcloud' as TrackSource,
            requestedBy,
            channelId,
          },
        ];
      });
      return { title: playlist.name, tracks };
    }

    return null;
  } catch (err) {
    log.error({ err }, 'resolvePlaylist error');
    return null;
  }
}

/** Song + artist for a Spotify track link: Web API when keys are set, otherwise the public track page. */
async function resolveSpotifyTrack(url: string): Promise<{ title: string; artist: string | null; durationSec: number | null } | null> {
  const link = parseSpotifyUrl(url);
  if (link?.kind !== 'track') return null;

  const token = await getSpotifyToken().catch(() => null);
  if (token) {
    const res = await fetch(`https://api.spotify.com/v1/tracks/${encodeURIComponent(link.id)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      const data = (await res.json()) as { name: string; artists: { name: string }[]; duration_ms?: number };
      return {
        title: data.name,
        artist: data.artists[0]?.name ?? null,
        durationSec: data.duration_ms ? Math.round(data.duration_ms / 1000) : null,
      };
    }
    log.warn(`Spotify track API ${res.status}; falling back to the public track page`);
  }
  return fetchSpotifyTrackPublic(link.id);
}

export async function initPlayDl(): Promise<void> {
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
  if (clientId && clientSecret) {
    try {
      await getSpotifyToken();
      log.info('Spotify credentials loaded.');
    } catch (err) {
      log.warn({ detail: (err as Error).message }, 'Spotify credentials failed');
    }
  } else {
    log.info('No Spotify credentials: Spotify links are read from public pages (tracks, albums, playlists).');
  }
}

async function resolveTrack(query: string, requestedBy: string, channelId: string): Promise<Track | null> {
  try {
    // Spotify track (also /intl-xx/ links) — song + artist from Spotify, then search YouTube.
    // Artist, podcast and episode links are not playable.
    const spotifyLink = parseSpotifyUrl(query);
    if (spotifyLink && spotifyLink.kind !== 'track') return null;
    if (spotifyLink) {
      const sp = await resolveSpotifyTrack(query);
      if (!sp) return null;
      const searchQuery = `${sp.title} ${sp.artist}`.trim();
      const results = await playdl.search(searchQuery, { source: { youtube: 'video' }, limit: 1 });
      if (!results.length) return null;
      const yt = results[0];
      const watchUrl = youtubeWatchUrlFromSearchResult(yt);
      if (!watchUrl) {
        log.warn({ detail: searchQuery }, 'YouTube search matched a video but had no url/id');
        return null;
      }
      return {
        url: watchUrl,
        title: sp.title,
        artist: sp.artist || null,
        thumbnail: yt.thumbnails?.[0]?.url ?? null,
        durationSec: yt.durationInSec ?? sp.durationSec ?? null,
        source: 'spotify',
        requestedBy,
        channelId,
      };
    }

    // YouTube URL or search
    const ytValidate = await playdl.yt_validate(query);
    if (ytValidate === 'video') {
      const info = await playdl.video_info(query);
      const d = info.video_details;
      return {
        url: d.url,
        title: d.title ?? 'Unknown',
        artist: d.channel?.name ?? null,
        thumbnail: d.thumbnails?.[0]?.url ?? null,
        durationSec: d.durationInSec ?? null,
        source: 'youtube',
        requestedBy,
        channelId,
      };
    }

    // SoundCloud URL
    const scValidate = await playdl.so_validate(query);
    if (scValidate === 'track') {
      const info = await playdl.soundcloud(query);
      if (info.type !== 'track') return null;
      const scTrack = info as typeof info & { thumbnail?: string };
      return {
        url: info.url,
        title: info.name,
        artist: info.user.name,
        thumbnail: scTrack.thumbnail ?? null,
        durationSec: Math.round(info.durationInMs / 1000),
        source: 'soundcloud',
        requestedBy,
        channelId,
      };
    }

    // Free-text search → YouTube
    const results = await playdl.search(query, { source: { youtube: 'video' }, limit: 1 });
    if (!results.length) return null;
    const yt = results[0];
    const watchUrl = youtubeWatchUrlFromSearchResult(yt);
    if (!watchUrl) {
      log.warn({ detail: query }, 'YouTube search matched a video but had no url/id');
      return null;
    }
    return {
      url: watchUrl,
      title: yt.title ?? 'Unknown',
      artist: yt.channel?.name ?? null,
      thumbnail: yt.thumbnails?.[0]?.url ?? null,
      durationSec: yt.durationInSec ?? null,
      source: 'youtube',
      requestedBy,
      channelId,
    };
  } catch (err) {
    log.error({ err }, 'resolveTrack error');
    return null;
  }
}

async function saveNowPlaying(guildId: string, track: Track): Promise<void> {
  const pool = getPool();
  await pool.query(
    `INSERT INTO bot.music_now_playing
       (guild_id, track_url, title, artist, thumbnail, duration_sec, source,
        requested_by, channel_id, is_paused, started_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,false,now())
     ON CONFLICT (guild_id) DO UPDATE SET
       track_url    = EXCLUDED.track_url,
       title        = EXCLUDED.title,
       artist       = EXCLUDED.artist,
       thumbnail    = EXCLUDED.thumbnail,
       duration_sec = EXCLUDED.duration_sec,
       source       = EXCLUDED.source,
       requested_by = EXCLUDED.requested_by,
       channel_id   = EXCLUDED.channel_id,
       is_paused    = false,
       started_at   = now()`,
    [guildId, track.url, track.title, track.artist, track.thumbnail,
     track.durationSec, track.source, track.requestedBy, track.channelId],
  );
  void recordMusicPlaybackLog({ guildId, event: 'play_start', track });
  notifyChange(guildId, 'track');
}

async function clearNowPlaying(guildId: string): Promise<void> {
  await getPool().query('DELETE FROM bot.music_now_playing WHERE guild_id = $1', [guildId]);
  notifyChange(guildId, 'state');
}

async function popNextFromQueue(guildId: string): Promise<Track | null> {
  const pool = getPool();
  const res = await pool.query<{
    id: number; track_url: string; title: string; artist: string | null;
    thumbnail: string | null; duration_sec: number | null; source: TrackSource;
    requested_by: string; channel_id?: string;
  }>(
    `DELETE FROM bot.music_queue
     WHERE id = (
       SELECT id FROM bot.music_queue WHERE guild_id = $1 ORDER BY added_at LIMIT 1
     )
     RETURNING *`,
    [guildId],
  );
  if (!res.rows.length) return null;
  const r = res.rows[0];
  return {
    url: r.track_url,
    title: r.title,
    artist: r.artist,
    thumbnail: r.thumbnail,
    durationSec: r.duration_sec,
    source: r.source,
    requestedBy: r.requested_by,
    channelId: r.channel_id ?? '',
  };
}

async function addToQueue(guildId: string, track: Track): Promise<void> {
  await getPool().query(
    `INSERT INTO bot.music_queue
       (guild_id, track_url, title, artist, thumbnail, duration_sec, source, requested_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [guildId, track.url, track.title, track.artist, track.thumbnail,
     track.durationSec, track.source, track.requestedBy],
  );
  void recordMusicPlaybackLog({ guildId, event: 'queued', track });
  notifyChange(guildId, 'queue');
}

/** Insert at front of queue (earlier `added_at` than existing rows). */
async function addToQueueFront(guildId: string, track: Track): Promise<void> {
  await getPool().query(
    `INSERT INTO bot.music_queue
       (guild_id, track_url, title, artist, thumbnail, duration_sec, source, requested_by, added_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,
       COALESCE(
         (SELECT MIN(added_at) - interval '1 millisecond' FROM bot.music_queue WHERE guild_id = $1),
         now()
       ))`,
    [guildId, track.url, track.title, track.artist, track.thumbnail,
     track.durationSec, track.source, track.requestedBy],
  );
  void recordMusicPlaybackLog({
    guildId,
    event: 'queued',
    track,
    meta: { queue_position: 'front' },
  });
  notifyChange(guildId, 'queue');
}

async function clearQueue(guildId: string): Promise<void> {
  await getPool().query('DELETE FROM bot.music_queue WHERE guild_id = $1', [guildId]);
  notifyChange(guildId, 'queue');
}

/** Randomize queue order by reassigning `added_at` (earliest plays first). */
export async function shuffleQueue(guildId: string): Promise<number> {
  const gid = voiceSnowflake(guildId);
  const res = await getPool().query(
    `WITH shuffled AS (
       SELECT id, row_number() OVER (ORDER BY random()) AS rn
       FROM bot.music_queue
       WHERE guild_id = $1
     )
     UPDATE bot.music_queue q
     SET added_at = now() + ((s.rn - 1) * interval '1 microsecond')
     FROM shuffled s
     WHERE q.id = s.id AND q.guild_id = $1`,
    [gid],
  );
  notifyChange(gid, 'queue');
  return res.rowCount ?? 0;
}

/**
 * Reassign `added_at` so playback order matches `orderedIds` (must be a permutation of current rows).
 */
export async function reorderMusicQueue(guildId: string, orderedIds: number[]): Promise<boolean> {
  const gid = voiceSnowflake(guildId);
  if (orderedIds.length === 0) return true;
  const pool = getPool();
  const cur = await pool.query<{ id: number }>(
    `SELECT id FROM bot.music_queue WHERE guild_id = $1 ORDER BY added_at`,
    [gid],
  );
  const currentIds = cur.rows.map((r) => r.id);
  if (currentIds.length !== orderedIds.length) return false;
  const setCur = new Set(currentIds);
  if (new Set(orderedIds).size !== orderedIds.length) return false;
  if (!orderedIds.every((id) => setCur.has(id))) return false;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const baseRes = await client.query<{ t: string }>(
      `SELECT clock_timestamp()::text AS t`,
    );
    const base = baseRes.rows[0]?.t;
    if (!base) throw new Error("clock_timestamp failed");
    for (let i = 0; i < orderedIds.length; i++) {
      await client.query(
        `UPDATE bot.music_queue
         SET added_at = $1::timestamptz + ($2::bigint * interval '1 microsecond')
         WHERE id = $3 AND guild_id = $4`,
        [base, i, orderedIds[i], gid],
      );
    }
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
  notifyChange(gid, 'queue');
  return true;
}

async function playTrack(client: Client, guildId: string, track: Track): Promise<void> {
  const gid = voiceSnowflake(guildId);
  const tr: Track = { ...track, channelId: voiceSnowflake(track.channelId) };
  let gp = players.get(gid);

  if (gp && !isConnectionUsable(gp.connection)) {
    log.warn(`Recreating unusable voice connection (${gp.connection.state.status})`);
    destroyGuildPlayer(gid, gp);
    gp = undefined;
  }

  // Ensure we have a voice connection
  if (!gp || gp.connection.state.status === VoiceConnectionStatus.Destroyed) {
    let guild = client.guilds.cache.get(gid);
    if (!guild) {
      try {
        guild = await client.guilds.fetch(gid);
      } catch {
        throw new Error(`Guild ${gid} not found or bot lacks access (try restarting the bot after invite)`);
      }
    }
    let channel = guild.channels.cache.get(tr.channelId);
    if (!channel) {
      try {
        channel = (await guild.channels.fetch(tr.channelId)) ?? undefined;
      } catch {
        throw new Error(`Voice channel ${tr.channelId} not found or bot lacks View Channel`);
      }
    }
    if (!channel) throw new Error(`Voice channel ${tr.channelId} not found`);
    if (!channel.isVoiceBased()) throw new Error(`Channel ${tr.channelId} not a voice channel`);

    // Destroy any stale connection @discordjs/voice may still have registered.
    const stale = getVoiceConnection(gid);
    if (stale) {
      log.info(`Destroying stale voice connection (${stale.state.status})`);
      stale.destroy();
    }

    const connection = joinVoiceChannel({
      channelId: tr.channelId,
      guildId: gid,
      selfDeaf: true,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      adapterCreator: guild.voiceAdapterCreator as any,
    });

    log.info(`Voice connection created, initial state: ${connection.state.status}`);

    connection.on('error', (err) => {
      log.error({ detail: err.message }, `Voice connection error in ${gid}`);
    });

    connection.on('stateChange', (oldState, newState) => {
      if (newState.status === VoiceConnectionStatus.Disconnected) {
        setTimeout(() => {
          const current = players.get(gid);
          if (current?.connection !== connection) return;
          if (connection.state.status !== VoiceConnectionStatus.Disconnected) return;
          log.warn('Voice connection stayed disconnected; tearing down stale player');
          destroyGuildPlayer(gid, current);
          void clearNowPlaying(gid);
        }, 5_000);
      }
      log.debug(`Voice state: ${oldState.status} → ${newState.status}`);
    });

    connection.on('debug', (msg) => {
      log.debug(`Voice debug: ${msg}`);
    });

    try {
      await entersState(connection, VoiceConnectionStatus.Ready, 30_000);
    } catch (err) {
      connection.destroy();
      const msg = (err as Error).message;
      if (msg.includes('aborted')) {
        logVoiceReadyFailureHints();
      }
      throw new Error(`Could not connect to voice channel: ${msg}`);
    }

    const player = createAudioPlayer();
    connection.subscribe(player);

    player.on(AudioPlayerStatus.Idle, async () => {
      const guildPlayer = players.get(gid);
      if (!guildPlayer) return;

      if (guildPlayer.suppressNextIdleQueueAdvance) {
        guildPlayer.suppressNextIdleQueueAdvance = false;
        return;
      }

      const cause = guildPlayer.idlePlaybackCause ?? 'natural';
      guildPlayer.idlePlaybackCause = null;
      const pendingMeta = guildPlayer.pendingPlaybackMeta;
      guildPlayer.pendingPlaybackMeta = null;

      const ended = guildPlayer.currentTrack;
      if (ended) {
        const meta: Record<string, unknown> = { cause };
        if (pendingMeta) Object.assign(meta, pendingMeta);
        void recordMusicPlaybackLog({
          guildId: gid,
          event: 'playback_ended',
          track: ended,
          meta,
        });
      }

      const nextRaw = await popNextFromQueue(gid);
      if (nextRaw) {
        if (ended) pushPlaybackHistory(guildPlayer, ended);
        const voiceCh = String(guildPlayer.connection.joinConfig.channelId);
        const next: Track = {
          ...nextRaw,
          channelId: nextRaw.channelId?.trim() ? nextRaw.channelId : voiceCh,
        };
        guildPlayer.currentTrack = next;
        await saveNowPlaying(gid, next);
        await startStream(player, next, gid);
      } else {
        await clearNowPlaying(gid);
        const still = players.get(gid);
        if (!still) return;
        killActiveYtdlp(gid);
        const conn = still.connection;
        if (conn.state.status !== VoiceConnectionStatus.Destroyed) {
          conn.destroy();
        }
        players.delete(gid);
      }
    });

    player.on('error', (err) => {
      log.error({ err }, `Player error in ${gid}`);
    });

    gp = {
      player,
      connection,
      currentTrack: tr,
      ytdlpProc: null,
      playbackHistory: [],
      idlePlaybackCause: null,
      suppressNextIdleQueueAdvance: false,
      pendingPlaybackMeta: null,
    };
    players.set(gid, gp);
  } else {
    const old = gp.currentTrack;
    if (old) pushPlaybackHistory(gp, old);
    gp.currentTrack = tr;
  }

  await saveNowPlaying(gid, tr);
  await startStream(gp.player, tr, gid);
}

async function startStream(player: AudioPlayer, track: Track, guildId: string, startSec = 0): Promise<void> {
  const gid = voiceSnowflake(guildId);
  const url = track.url?.trim();
  if (!url) {
    throw new Error(`Missing stream URL for track: ${track.title}`);
  }
  if (track.source === 'soundcloud') {
    const stream = await playdl.stream(url, { quality: 2 });
    const resource = createAudioResource(stream.stream, { inputType: stream.type });
    player.play(resource);
  } else {
    // YouTube / Spotify→YouTube: use yt-dlp via direct spawn.
    // youtube-dl-exec's .exec() wrapper uses tinyspawn which immediately attaches a 'data'
    // listener to stdout (for buffering), consuming the stream before we can pipe it.
    // Spawning directly avoids that.
    killActiveYtdlp(gid);
    const gp = players.get(gid);
    if (!gp) throw new Error(`No guild player for ${gid}`);

    const ytdlpBin = resolveYtDlpSpawnPath();
    const baseArgs = [
      url,
      '--format', 'bestaudio/best',
      '--output', '-',
      '--quiet', '--no-warnings', '--no-playlist', '--no-check-certificates',
      ...ytdlpExtraArgs(),
    ];
    /* Seek: `--downloader ffmpeg` + `ffmpeg_i:-ss` is ignored for YouTube's progressive HTTP
       (yt-dlp uses the native HTTP downloader). Partial download via sections requires ffmpeg. */
    const ffmpegLocArgs = startSec > 0 ? ytdlpFfmpegLocationArgs() : [];
    const seekArgs =
      startSec > 0
        ? ['--download-sections', ytdlpDownloadSectionFromStartSec(startSec), ...ffmpegLocArgs]
        : [];
    if (startSec > 0 && !ffmpegLocArgs.length) {
      log.warn('Seek: no ffmpeg binary (ffmpeg-static or FFMPEG_PATH). yt-dlp may fail partial download; install ffmpeg or set FFMPEG_PATH.');
    }
    const proc = spawn(ytdlpBin, [...baseArgs, ...seekArgs], { stdio: ['ignore', 'pipe', 'pipe'] });

    gp.ytdlpProc = proc;

    proc.stderr?.on('data', (chunk: Buffer) => {
      const line = chunk.toString().trim();
      if (line && !isBenignYtdlpShutdownMessage(line)) {
        log.warn({ detail: line.slice(0, 400) }, 'yt-dlp');
      }
    });
    proc.once('error', (err: Error) => log.error({ detail: err.message }, 'yt-dlp process error'));
    proc.once('close', (code: number | null) => {
      if (gp.ytdlpProc === proc) gp.ytdlpProc = null;
      const killed = proc.killed;
      if (code !== 0 && code !== null && !killed) {
        log.warn(`yt-dlp exited with code ${code}`);
      }
    });

    player.play(createAudioResource(proc.stdout!, { inputType: StreamType.Arbitrary }));
  }
}

// --- Public API ---

export type EnqueueResult =
  | { kind: 'track'; track: Track }
  | { kind: 'playlist'; title: string; queued: number; first: Track };

function isPlaylistUrl(query: string): boolean {
  if (/spotify\.com\/(?:intl-[a-z]{2}\/)?(?:playlist|album)\//i.test(query)) return true;
  if (query.includes('list=') && (query.includes('youtube.com') || query.includes('youtu.be'))) return true;
  if (query.includes('soundcloud.com') && query.includes('/sets/')) return true;
  return false;
}

export async function enqueue(
  client: Client,
  guildId: string,
  query: string,
  requestedBy: string,
  channelId: string,
): Promise<EnqueueResult | null> {
  const gid = voiceSnowflake(guildId);
  const cid = voiceSnowflake(channelId);

  if (isPlaylistUrl(query)) {
    const pl = await resolvePlaylist(query, requestedBy, cid);
    if (!pl || !pl.tracks.length) return null;

    const [first, ...rest] = pl.tracks;
    if (isActivelyPlaying(players.get(gid))) {
      for (const t of pl.tracks) await addToQueue(gid, t);
    } else {
      await playTrack(client, gid, first!);
      for (const t of rest) await addToQueue(gid, t);
    }
    return { kind: 'playlist', title: pl.title, queued: pl.tracks.length, first: first! };
  }

  const track = await resolveTrack(query, requestedBy, cid);
  if (!track) return null;

  if (isActivelyPlaying(players.get(gid))) {
    await addToQueue(gid, track);
  } else {
    await playTrack(client, gid, track);
  }
  return { kind: 'track', track };
}

/**
 * Start the queue in `channelId` when nothing is playing, e.g. after a restart left tracks behind.
 * Returns the track that started, or null when the queue is empty or something already plays.
 */
export async function playFromQueue(client: Client, guildId: string, channelId: string): Promise<Track | null> {
  const gid = voiceSnowflake(guildId);
  if (isActivelyPlaying(players.get(gid))) return null;
  const next = await popNextFromQueue(gid);
  if (!next) return null;
  try {
    await playTrack(client, gid, { ...next, channelId: voiceSnowflake(channelId) });
  } catch (err) {
    await addToQueueFront(gid, next);
    throw err;
  }
  return next;
}

export async function skip(guildId: string): Promise<void> {
  const gid = voiceSnowflake(guildId);
  const gp = players.get(gid);
  if (!gp) return;
  gp.idlePlaybackCause = 'skip';
  killActiveYtdlp(gid);
  gp.player.stop(); // triggers Idle → plays next from queue
}

/**
 * Play the last track from in-session history; current track is prepended to the queue.
 * @returns true if playback was rewound, false if there is no history.
 */
export async function previous(guildId: string): Promise<boolean> {
  const gid = voiceSnowflake(guildId);
  const gp = players.get(gid);
  if (!gp || gp.playbackHistory.length === 0) return false;
  const prevTrack = gp.playbackHistory.pop()!;
  const cur = gp.currentTrack;
  if (cur) {
    await addToQueueFront(gid, cur);
  }
  gp.suppressNextIdleQueueAdvance = true;
  killActiveYtdlp(gid);
  gp.player.stop(true);
  gp.player.unpause();
  gp.currentTrack = prevTrack;
  await saveNowPlaying(gid, prevTrack);
  await startStream(gp.player, prevTrack, gid);
  return true;
}

export async function pause(guildId: string): Promise<void> {
  const gid = voiceSnowflake(guildId);
  const gp = players.get(gid);
  if (!gp) return;
  gp.player.pause();
  await getPool().query(
    'UPDATE bot.music_now_playing SET is_paused = true WHERE guild_id = $1',
    [gid],
  );
  void recordMusicPlaybackLog({
    guildId: gid,
    event: 'pause',
    track: gp.currentTrack,
  });
  notifyChange(gid, 'state');
}

export async function resume(guildId: string): Promise<void> {
  const gid = voiceSnowflake(guildId);
  const gp = players.get(gid);
  if (!gp) return;
  gp.player.unpause();
  await getPool().query(
    `UPDATE bot.music_now_playing
     SET
       started_at = now() - greatest(extract(epoch from (updated_at - started_at)), 0) * interval '1 second',
       is_paused = false
     WHERE guild_id = $1`,
    [gid],
  );
  void recordMusicPlaybackLog({
    guildId: gid,
    event: 'resume',
    track: gp.currentTrack,
  });
  notifyChange(gid, 'state');
}

/** True while a guild's player is paused (the panel's play/pause button uses this). */
export function isPaused(guildId: string): boolean {
  return players.get(voiceSnowflake(guildId))?.player.state.status === AudioPlayerStatus.Paused;
}

export async function seek(guildId: string, seekSec: number): Promise<void> {
  const gid = voiceSnowflake(guildId);
  const gp = players.get(gid);
  if (!gp?.currentTrack) return;
  const track = gp.currentTrack;
  const clamped = Math.max(0, track.durationSec ? Math.min(seekSec, track.durationSec - 1) : seekSec);
  // Update started_at so the UI progress bar reflects the new position
  await getPool().query(
    `UPDATE bot.music_now_playing
     SET started_at = now() - ($1 || ' seconds')::interval, is_paused = false
     WHERE guild_id = $2`,
    [clamped, gid],
  );
  gp.suppressNextIdleQueueAdvance = true;
  killActiveYtdlp(gid);
  gp.player.stop(true);
  gp.player.unpause();
  await startStream(gp.player, track, gid, clamped);
  void recordMusicPlaybackLog({
    guildId: gid,
    event: 'seek',
    track,
    meta: { position_sec: clamped },
  });
  notifyChange(gid, 'state');
}

export async function stop(guildId: string): Promise<void> {
  const gid = voiceSnowflake(guildId);
  /* Clear queue + DB before stop(true), or Idle may pop the next track and keep playing.
     Do not destroy the voice connection here — player.stop(true) emits Idle, and the Idle
     handler tears down when the queue is empty (avoids double destroy with @discordjs/voice). */
  const gp = players.get(gid);
  let queueItemsCleared = 0;
  if (gp) {
    gp.playbackHistory = [];
    const qc = await getPool().query<{ c: string }>(
      'SELECT COUNT(*)::text AS c FROM bot.music_queue WHERE guild_id = $1',
      [gid],
    );
    queueItemsCleared = Number(qc.rows[0]?.c ?? 0) || 0;
    gp.idlePlaybackCause = 'stop';
    gp.pendingPlaybackMeta = { queue_items_cleared: queueItemsCleared };
  }
  await clearQueue(gid);
  await clearNowPlaying(gid);
  if (gp) {
    killActiveYtdlp(gid);
    gp.player.stop(true);
  }
}

/**
 * Graceful shutdown: stop every stream and leave voice. The queue stays in the DB; the track that was
 * playing goes back to the front of the queue so a restart does not lose it.
 */
export async function shutdownMusic(): Promise<void> {
  for (const [gid, gp] of players) {
    try {
      if (gp.currentTrack) {
        await addToQueueFront(gid, gp.currentTrack);
      }
      await clearNowPlaying(gid);
    } catch (err) {
      log.warn({ err, guildId: gid }, 'could not persist current track on shutdown');
    }
    gp.suppressNextIdleQueueAdvance = true;
    killActiveYtdlp(gid);
    gp.player.stop(true);
    if (gp.connection.state.status !== VoiceConnectionStatus.Destroyed) {
      gp.connection.destroy();
    }
  }
  players.clear();
  for (const connection of getVoiceConnections().values()) {
    if (connection.state.status !== VoiceConnectionStatus.Destroyed) connection.destroy();
  }
}

export function getLastChannelId(guildId: string): string | null {
  return players.get(voiceSnowflake(guildId))?.currentTrack?.channelId ?? null;
}

// --- Playlist API ---

export type Playlist = { id: number; name: string; createdBy: string; trackCount: number };
export type PlaylistTrack = { position: number; title: string; artist: string | null; durationSec: number | null; source: TrackSource };

export async function createPlaylist(guildId: string, name: string, userId: string): Promise<Playlist | null> {
  const pool = getPool();
  try {
    const res = await pool.query<{ id: number; name: string; created_by: string }>(
      `INSERT INTO bot.playlists (guild_id, name, created_by) VALUES ($1, $2, $3) RETURNING id, name, created_by`,
      [guildId, name.trim(), userId],
    );
    return { id: res.rows[0].id, name: res.rows[0].name, createdBy: res.rows[0].created_by, trackCount: 0 };
  } catch (err: unknown) {
    if ((err as { code?: string }).code === '23505') return null; // duplicate name
    throw err;
  }
}

export async function deletePlaylist(guildId: string, name: string): Promise<boolean> {
  const res = await getPool().query(
    `DELETE FROM bot.playlists WHERE guild_id = $1 AND name = $2`,
    [guildId, name.trim()],
  );
  return (res.rowCount ?? 0) > 0;
}

export async function listPlaylists(guildId: string): Promise<Playlist[]> {
  const res = await getPool().query<{ id: number; name: string; created_by: string; track_count: string }>(
    `SELECT p.id, p.name, p.created_by,
            COUNT(t.id)::text AS track_count
     FROM bot.playlists p
     LEFT JOIN bot.playlist_tracks t ON t.playlist_id = p.id
     WHERE p.guild_id = $1
     GROUP BY p.id
     ORDER BY p.name`,
    [guildId],
  );
  return res.rows.map((r) => ({ id: r.id, name: r.name, createdBy: r.created_by, trackCount: Number(r.track_count) }));
}

export async function getPlaylistTracks(guildId: string, name: string): Promise<PlaylistTrack[] | null> {
  const pool = getPool();
  const pl = await pool.query<{ id: number }>(
    `SELECT id FROM bot.playlists WHERE guild_id = $1 AND name = $2`,
    [guildId, name.trim()],
  );
  if (!pl.rows.length) return null;
  const res = await pool.query<{ position: number; title: string; artist: string | null; duration_sec: number | null; source: TrackSource }>(
    `SELECT position, title, artist, duration_sec, source
     FROM bot.playlist_tracks WHERE playlist_id = $1 ORDER BY position`,
    [pl.rows[0].id],
  );
  return res.rows.map((r) => ({ position: r.position, title: r.title, artist: r.artist, durationSec: r.duration_sec, source: r.source }));
}

export async function addTrackToPlaylist(
  guildId: string,
  playlistName: string,
  query: string,
  userId: string,
): Promise<{ track: PlaylistTrack; position: number } | null> {
  const pool = getPool();
  const pl = await pool.query<{ id: number }>(
    `SELECT id FROM bot.playlists WHERE guild_id = $1 AND name = $2`,
    [guildId, playlistName.trim()],
  );
  if (!pl.rows.length) return null;

  const track = await resolveTrack(query, userId, '');
  if (!track) return null;

  const posRes = await pool.query<{ max: number | null }>(
    `SELECT MAX(position) AS max FROM bot.playlist_tracks WHERE playlist_id = $1`,
    [pl.rows[0].id],
  );
  const position = (posRes.rows[0].max ?? 0) + 1;

  await pool.query(
    `INSERT INTO bot.playlist_tracks
       (playlist_id, position, track_url, title, artist, thumbnail, duration_sec, source, added_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [pl.rows[0].id, position, track.url, track.title, track.artist, track.thumbnail, track.durationSec, track.source, userId],
  );

  return { track: { position, title: track.title, artist: track.artist, durationSec: track.durationSec, source: track.source }, position };
}

export async function removeTrackFromPlaylist(guildId: string, playlistName: string, position: number): Promise<boolean> {
  const pool = getPool();
  const pl = await pool.query<{ id: number }>(
    `SELECT id FROM bot.playlists WHERE guild_id = $1 AND name = $2`,
    [guildId, playlistName.trim()],
  );
  if (!pl.rows.length) return false;

  const del = await pool.query(
    `DELETE FROM bot.playlist_tracks WHERE playlist_id = $1 AND position = $2`,
    [pl.rows[0].id, position],
  );
  if ((del.rowCount ?? 0) === 0) return false;

  // Repack positions to stay contiguous
  await pool.query(
    `UPDATE bot.playlist_tracks
     SET position = position - 1
     WHERE playlist_id = $1 AND position > $2`,
    [pl.rows[0].id, position],
  );
  return true;
}

export async function playPlaylist(
  client: Client,
  guildId: string,
  playlistName: string,
  userId: string,
  channelId: string,
): Promise<{ queued: number; name: string } | null> {
  const pool = getPool();
  const pl = await pool.query<{ id: number; name: string }>(
    `SELECT id, name FROM bot.playlists WHERE guild_id = $1 AND name = $2`,
    [guildId, playlistName.trim()],
  );
  if (!pl.rows.length) return null;

  const res = await pool.query<{
    track_url: string; title: string; artist: string | null;
    thumbnail: string | null; duration_sec: number | null; source: TrackSource;
  }>(
    `SELECT track_url, title, artist, thumbnail, duration_sec, source
     FROM bot.playlist_tracks WHERE playlist_id = $1 ORDER BY position`,
    [pl.rows[0].id],
  );
  if (!res.rows.length) return { queued: 0, name: pl.rows[0].name };

  const gid = voiceSnowflake(guildId);
  const cid = voiceSnowflake(channelId);
  const tracks: Track[] = res.rows.map((r) => ({
    url: r.track_url, title: r.title, artist: r.artist, thumbnail: r.thumbnail,
    durationSec: r.duration_sec, source: r.source, requestedBy: userId, channelId: cid,
  }));

  if (isActivelyPlaying(players.get(gid))) {
    for (const t of tracks) await addToQueue(gid, t);
  } else {
    const [first, ...rest] = tracks;
    await playTrack(client, gid, first!);
    for (const t of rest) await addToQueue(gid, t);
  }

  return { queued: tracks.length, name: pl.rows[0].name };
}
