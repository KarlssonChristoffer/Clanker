import { describe, expect, it } from 'vitest';
import { notFoundText } from '../src/commands/music.js';
import { decodeHtmlEntities, parseSpotifyTrackPage, parseSpotifyUrl } from '../src/spotify-public.js';

// Tags as served by open.spotify.com/track/4KWzsYmXYYbTjb4tYxulvd on 2026-09-26.
const TRACK_PAGE = `<html><head>
<title>Who&#x27;s Crying Now (2022 Remaster) - song and lyrics by Journey | Spotify</title>
<meta property="og:title" content="Who&#x27;s Crying Now (2022 Remaster)"/>
<meta property="og:description" content="Journey · Escape (2022 Remaster) · Song · 1981"/>
<meta name="music:duration" content="300"/>
<meta name="music:musician_description" content="Journey"/>
</head></html>`;

describe('Spotify links without API keys', () => {
  it('reads kind and id from share links, including intl paths and ?si=', () => {
    expect(parseSpotifyUrl('https://open.spotify.com/track/4KWzsYmXYYbTjb4tYxulvd?si=a09c022c4e5d4402')).toEqual({
      kind: 'track',
      id: '4KWzsYmXYYbTjb4tYxulvd',
    });
    expect(parseSpotifyUrl('https://open.spotify.com/intl-sv/album/2noRn2Aes5aoNVsU6iWThc')).toEqual({ kind: 'album', id: '2noRn2Aes5aoNVsU6iWThc' });
    expect(parseSpotifyUrl('https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M')?.kind).toBe('playlist');
    expect(parseSpotifyUrl('never gonna give you up')).toBeNull();
  });

  it('gets song, artist and length from the public track page', () => {
    expect(parseSpotifyTrackPage(TRACK_PAGE)).toEqual({ title: "Who's Crying Now (2022 Remaster)", artist: 'Journey', durationSec: 300 });
    expect(parseSpotifyTrackPage('<html></html>')).toBeNull();
  });

  it('falls back to the first part of og:description for the artist', () => {
    const page = TRACK_PAGE.replace(/<meta name="music:musician_description"[^>]*>/, '');
    expect(parseSpotifyTrackPage(page)?.artist).toBe('Journey');
  });

  it('decodes the entities Spotify uses', () => {
    expect(decodeHtmlEntities('Who&#x27;s &amp; &quot;Rock&quot; &#39;n&#39; roll')).toBe(`Who's & "Rock" 'n' roll`);
  });

  it('explains unplayable Spotify links instead of blaming the search', () => {
    expect(notFoundText('https://open.spotify.com/artist/0rvjqX7ttXeg3mTy8Xscbt')).toContain('poddar');
    expect(notFoundText('https://open.spotify.com/playlist/abc')).toContain('Spotify-länken');
    expect(notFoundText('asdfgh')).toContain('Hittade varken');
  });
});
