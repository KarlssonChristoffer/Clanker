import { describe, expect, it } from 'vitest';
import { notFoundText } from '../src/commands/music.js';
import {
  decodeHtmlEntities,
  parseSpotifyTrackPage,
  parseSpotifyUrl,
  pickYoutubeMatch,
  youtubeQueryFor,
} from '../src/spotify-public.js';

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

  it('searches YouTube for "artist title" without remaster tags', () => {
    expect(youtubeQueryFor({ title: "Who's Crying Now (2022 Remaster)", artist: 'Journey' })).toBe("Journey Who's Crying Now");
    expect(youtubeQueryFor({ title: 'Hotel California - 2013 Remaster', artist: 'Eagles' })).toBe('Eagles Hotel California');
    expect(youtubeQueryFor({ title: 'One More Time', artist: null })).toBe('One More Time');
  });

  it('prefers the studio version at the right length over live uploads', () => {
    // What YouTube returned on 2026-09-26 for this song: the live version ranked first.
    const results = [
      { title: "Journey - Who's Crying Now (Live 1981: Escape Tour - 2022 HD Remaster)", durationInSec: 337 },
      { title: "Journey - Who's Crying Now (Official Audio)", durationInSec: 301 },
      { title: "Who's Crying Now - Journey (Lyrics)", durationInSec: 299 },
    ];
    expect(pickYoutubeMatch(results, { title: "Who's Crying Now (2022 Remaster)", durationSec: 300 })?.durationInSec).toBe(301);
    // A live song on Spotify may match a live upload.
    expect(pickYoutubeMatch(results, { title: "Who's Crying Now - Live", durationSec: 337 })?.durationInSec).toBe(337);
    // Unknown length: first non-live hit.
    expect(pickYoutubeMatch(results, { title: "Who's Crying Now", durationSec: null })?.durationInSec).toBe(301);
    expect(pickYoutubeMatch([], { title: 'x', durationSec: null })).toBeNull();
  });

  it('explains unplayable Spotify links instead of blaming the search', () => {
    expect(notFoundText('https://open.spotify.com/artist/0rvjqX7ttXeg3mTy8Xscbt')).toContain('poddar');
    expect(notFoundText('https://open.spotify.com/playlist/abc')).toContain('Spotify-länken');
    expect(notFoundText('asdfgh')).toContain('Hittade varken');
  });
});
