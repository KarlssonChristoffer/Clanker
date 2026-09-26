import { describe, expect, it, vi } from 'vitest';
import type { Client } from 'discord.js';

vi.mock('../src/music-player.js', () => ({
  enqueue: vi.fn(),
  skip: vi.fn(async () => undefined),
  previous: vi.fn(),
  pause: vi.fn(),
  resume: vi.fn(),
  stop: vi.fn(),
  seek: vi.fn(),
  shuffleQueue: vi.fn(),
  reorderMusicQueue: vi.fn(),
  addTrackToPlaylist: vi.fn(),
  playPlaylist: vi.fn(),
}));

const { createBotHttpApp, secretMatches } = await import('../src/music-http.js');

const notReadyClient = { isReady: () => false, ws: { status: 5 } } as unknown as Client;

function app(secret: string | undefined, bind = '127.0.0.1') {
  return createBotHttpApp({ client: notReadyClient, bind, secret, version: '1.2.3' });
}

describe('secretMatches', () => {
  it('accepts only the exact secret', () => {
    expect(secretMatches('s3cret', 's3cret')).toBe(true);
    expect(secretMatches('s3cret ', 's3cret')).toBe(false);
    expect(secretMatches('', 's3cret')).toBe(false);
    expect(secretMatches(undefined, 's3cret')).toBe(false);
    expect(secretMatches('a-much-longer-value-than-the-secret', 's3cret')).toBe(false);
  });
});

describe('bot HTTP auth', () => {
  it('rejects music routes without the header when a secret is configured', async () => {
    const res = await app('topsecret').request('/skip', {
      method: 'POST',
      body: JSON.stringify({ guildId: '123456789012345678' }),
      headers: { 'content-type': 'application/json' },
    });
    expect(res.status).toBe(401);
  });

  it('rejects a wrong secret', async () => {
    const res = await app('topsecret').request('/music/state?guildId=123456789012345678', {
      headers: { 'x-clanker-secret': 'nope' },
    });
    expect(res.status).toBe(401);
  });

  it('lets a correct secret through to the route', async () => {
    const res = await app('topsecret').request('/skip', {
      method: 'POST',
      body: JSON.stringify({ guildId: '123456789012345678' }),
      headers: { 'content-type': 'application/json', 'x-clanker-secret': 'topsecret' },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('refuses music routes on a public bind when no secret is set', async () => {
    const res = await app(undefined, '0.0.0.0').request('/music/state?guildId=bad');
    expect(res.status).toBe(503);
  });

  it('allows music routes on loopback when no secret is set (dev)', async () => {
    const res = await app(undefined, '127.0.0.1').request('/music/state?guildId=bad');
    expect(res.status).toBe(400);
  });
});

describe('GET /health', () => {
  it('is public and reports 503 when Discord and the DB are down', async () => {
    const res = await app('topsecret').request('/health');
    expect(res.status).toBe(503);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ discord: 'down', db: 'fail', jev: 'disabled', version: '1.2.3' });
    expect(typeof body.uptime).toBe('number');
  });
});
