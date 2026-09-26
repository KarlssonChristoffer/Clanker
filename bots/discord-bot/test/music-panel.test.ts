import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { APIButtonComponentWithCustomId } from 'discord.js';
import { loadMusicState, renderMusicPanel, type MusicState } from '../src/music-panel.js';
import { createTestDb, type TestDb } from './helpers/test-db.js';

const buttons = (panel: ReturnType<typeof renderMusicPanel>) =>
  panel.components.flatMap((row) => row.toJSON().components as APIButtonComponentWithCustomId[]);

const playing = (over: Partial<NonNullable<MusicState['now']>> = {}): NonNullable<MusicState['now']> => ({
  title: 'Never Gonna Give You Up',
  artist: 'Rick Astley',
  trackUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
  thumbnail: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hq720.jpg',
  durationSec: 214,
  requestedBy: 'u1',
  voiceChannelId: 'v1',
  paused: false,
  startedAt: new Date('2026-09-26T10:30:00Z'),
  updatedAt: new Date('2026-09-26T10:30:00Z'),
  ...over,
});

describe('music panel rendering', () => {
  it('explains how to start music when nothing plays, without buttons', () => {
    const panel = renderMusicPanel({ now: null, queue: [], queueTotal: 0 });
    expect(panel.embeds[0]!.data.description).toContain('/play');
    expect(panel.components).toHaveLength(0);
  });

  it('offers "Fortsätt kön" when a restart left songs in the queue', () => {
    const panel = renderMusicPanel({ now: null, queue: [{ title: 'Sandstorm', artist: 'Darude', durationSec: 225 }], queueTotal: 1 });
    expect(panel.embeds[0]!.data.description).toContain('1 låt väntar');
    expect(buttons(panel).map((b) => b.custom_id)).toEqual(['music:start']);
  });

  it('shows the song, who asked for it, the next tracks and the controls', () => {
    const queue = Array.from({ length: 5 }, (_, i) => ({ title: `Låt ${i + 1}`, artist: null, durationSec: 60 }));
    const panel = renderMusicPanel({ now: playing(), queue, queueTotal: 7 });
    const embed = panel.embeds[0]!.data;
    expect(embed.title).toBe('🎶 Spelar nu');
    expect(embed.url).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    expect(embed.description).toContain('**Never Gonna Give You Up**');
    expect(embed.description).toContain('<#v1>');
    expect(embed.description).toContain('<@u1>');
    expect(embed.description).toMatch(/slut <t:\d+:R>/);
    expect(embed.fields![0]!.name).toBe('📜 Näst på tur (7)');
    expect(embed.fields![0]!.value).toContain('…och 2 låtar till');
    const b = buttons(panel);
    expect(b.map((x) => x.custom_id)).toEqual(['music:prev', 'music:toggle', 'music:skip', 'music:shuffle', 'music:stop']);
    expect(b[1]!.label).toBe('Pausa');
    expect(b[3]!.disabled).toBe(false);
  });

  it('shows where a paused song stopped and turns the toggle into "Spela"', () => {
    const panel = renderMusicPanel({
      now: playing({ paused: true, updatedAt: new Date('2026-09-26T10:31:30Z') }),
      queue: [],
      queueTotal: 0,
    });
    expect(panel.embeds[0]!.data.title).toBe('⏸️ Pausad');
    expect(panel.embeds[0]!.data.description).toContain('Pausad vid 1:30 av 3:34');
    const b = buttons(panel);
    expect(b[1]!.label).toBe('Spela');
    expect(b[3]!.disabled).toBe(true); // nothing to shuffle
  });

  it('escapes markdown in titles and skips non-http thumbnails', () => {
    const panel = renderMusicPanel({ now: playing({ title: '*Hot* _Remix_', thumbnail: 'not-a-url' }), queue: [], queueTotal: 0 });
    expect(panel.embeds[0]!.data.description).toContain('\\*Hot\\* \\_Remix\\_');
    expect(panel.embeds[0]!.data.thumbnail).toBeUndefined();
  });
});

describe('music panel state', () => {
  let t: TestDb;
  beforeEach(async () => {
    t = await createTestDb();
  }, 60_000);
  afterEach(async () => {
    await t.close();
  });

  it('reads now playing, the first five queued tracks and the queue size', async () => {
    const q = t.db.query.bind(t.db);
    await q(
      `INSERT INTO bot.music_now_playing (guild_id, track_url, title, artist, duration_sec, source, requested_by, channel_id, is_paused)
       VALUES ('g1', 'https://y/1', 'Nu', 'Artist', 100, 'youtube', 'u1', 'v1', false)`,
    );
    for (let i = 1; i <= 7; i++) {
      await q(
        `INSERT INTO bot.music_queue (guild_id, track_url, title, source, requested_by, added_at)
         VALUES ('g1', $1, $2, 'youtube', 'u1', now() + ($3 || ' seconds')::interval)`,
        [`https://y/q${i}`, `Kö ${i}`, String(i)],
      );
    }
    const state = await loadMusicState(t.db, 'g1');
    expect(state.now).toMatchObject({ title: 'Nu', voiceChannelId: 'v1', paused: false, durationSec: 100 });
    expect(state.queue.map((x) => x.title)).toEqual(['Kö 1', 'Kö 2', 'Kö 3', 'Kö 4', 'Kö 5']);
    expect(state.queueTotal).toBe(7);
    expect(await loadMusicState(t.db, 'other')).toEqual({ now: null, queue: [], queueTotal: 0 });
  });
});
