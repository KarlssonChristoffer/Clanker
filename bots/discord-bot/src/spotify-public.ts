/**
 * Spotify links without API keys. Public pages carry enough to find a song on YouTube:
 * - open.spotify.com/track/<id>: <meta og:title> (song), music:musician_description (artist), music:duration (s)
 * - open.spotify.com/oembed?url=…: {"title": …} for tracks, albums and playlists
 * Album and playlist track lists come from the embed page (parsed in music-player.ts).
 * Verified against live pages 2026-09-26, from the bot container on tincan.
 */
import { childLogger } from './core/logger.js';

const log = childLogger('spotify');

export type SpotifyKind = 'track' | 'album' | 'playlist' | 'artist' | 'show' | 'episode';

/**
 * An honest bot UA on purpose: for a full browser UA Spotify serves the client-rendered app without the
 * <meta> tags (only ~164 kB of JS shell); a non-browser UA gets the server-rendered page with them.
 */
const USER_AGENT = 'Clanker/1.0 (Discord bot; +https://github.com/KarlssonChristoffer/Clanker)';

/** open.spotify.com/[intl-xx/]<kind>/<id>[?si=…] → { kind, id }. */
export function parseSpotifyUrl(url: string): { kind: SpotifyKind; id: string } | null {
  const m = url.match(/spotify\.com\/(?:intl-[a-z]{2}(?:-[a-z]{2})?\/)?(track|album|playlist|artist|show|episode)\/([A-Za-z0-9]+)/i);
  return m ? { kind: m[1]!.toLowerCase() as SpotifyKind, id: m[2]! } : null;
}

export function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number(dec)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function meta(html: string, attr: 'property' | 'name', key: string): string | null {
  const re = new RegExp(`<meta\\s+${attr}="${key.replace(/[.:]/g, '\\$&')}"\\s+content="([^"]*)"`, 'i');
  const m = html.match(re);
  return m ? decodeHtmlEntities(m[1]!).trim() : null;
}

/** Song, artist and length from a public track page, or null when the page has no track metadata. */
export function parseSpotifyTrackPage(html: string): { title: string; artist: string | null; durationSec: number | null } | null {
  const title = meta(html, 'property', 'og:title');
  if (!title) return null;
  const artist = meta(html, 'name', 'music:musician_description') ?? meta(html, 'property', 'og:description')?.split(' · ')[0] ?? null;
  const duration = Number(meta(html, 'name', 'music:duration'));
  return { title, artist: artist || null, durationSec: Number.isFinite(duration) && duration > 0 ? duration : null };
}

// ── Matching on YouTube ──────────────────────────────────────────────────────

/** "Artist Title" without remaster tags, which mostly steer YouTube search to odd uploads. */
export function youtubeQueryFor(song: { title: string; artist: string | null }): string {
  const title =
    song.title.replace(/\s*(?:[([][^)\]]*\bremaster(?:ed)?\b[^)\]]*[)\]]|-\s*[^-]*\bremaster(?:ed)?\b.*)$/i, '').trim() || song.title;
  return `${song.artist ?? ''} ${title}`.trim();
}

const UNWANTED_VERSIONS = ['live', 'cover', 'karaoke', 'instrumental', 'remix', 'sped up', 'slowed', 'nightcore', 'reaction'];

/**
 * Best YouTube hit for a Spotify song: drop live/cover/karaoke-style uploads unless the song itself is one,
 * then take the highest-ranked hit within 15 s of Spotify's length, else the highest-ranked remaining hit.
 */
export function pickYoutubeMatch<T extends { title?: string; durationInSec?: number }>(
  results: T[],
  song: { title: string; durationSec: number | null },
): T | null {
  if (!results.length) return null;
  const songTitle = song.title.toLowerCase();
  const isUnwanted = (r: T) =>
    UNWANTED_VERSIONS.some((w) => !songTitle.includes(w) && new RegExp(`\\b${w}\\b`, 'i').test(r.title ?? ''));
  const pool = results.filter((r) => !isUnwanted(r));
  const candidates = pool.length ? pool : results;
  const target = song.durationSec;
  const close = target ? candidates.find((r) => r.durationInSec && Math.abs(r.durationInSec - target) <= 15) : undefined;
  return close ?? candidates[0]!;
}

async function getText(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'en-US,en;q=0.9' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      log.warn({ status: res.status, url }, 'Spotify public page failed');
      return null;
    }
    return await res.text();
  } catch (err) {
    log.warn({ err, url }, 'Spotify public page failed');
    return null;
  }
}

export async function fetchSpotifyTrackPublic(id: string) {
  const html = await getText(`https://open.spotify.com/track/${encodeURIComponent(id)}`);
  return html ? parseSpotifyTrackPage(html) : null;
}

/** Display name of a track, album or playlist via oEmbed (no key needed). */
export async function fetchSpotifyTitle(kind: SpotifyKind, id: string): Promise<string | null> {
  const target = `https://open.spotify.com/${kind}/${encodeURIComponent(id)}`;
  const body = await getText(`https://open.spotify.com/oembed?url=${encodeURIComponent(target)}`);
  if (!body) return null;
  try {
    const title = (JSON.parse(body) as { title?: unknown }).title;
    return typeof title === 'string' && title.trim() ? title.trim() : null;
  } catch {
    return null;
  }
}
