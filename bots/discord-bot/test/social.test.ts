import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { findQuote, saveQuote } from '../src/social/quotes.js';
import { collectWeeklyStats } from '../src/social/weekly-report.js';
import { createTestDb, type TestDb } from './helpers/test-db.js';

let t: TestDb;
beforeEach(async () => {
  t = await createTestDb();
}, 60_000);
afterEach(async () => {
  await t.close();
});

const base = {
  guildId: 'g1',
  channelId: 'c1',
  authorId: 'u1',
  authorName: 'Kalle',
  savedBy: 'u2',
  saidAt: new Date('2026-09-30T20:00:00Z'),
};

describe('quote book', () => {
  it('saves each message once and finds quotes by text, name or author', async () => {
    expect(await saveQuote(t.db, { ...base, messageId: 'm1', content: 'Jag pullar inte, jag bara tittar' })).toBe(true);
    expect(await saveQuote(t.db, { ...base, messageId: 'm1', content: 'dubblett' })).toBe(false);
    await saveQuote(t.db, { ...base, messageId: 'm2', authorId: 'u3', authorName: 'Lisa', content: 'Healern är alltid skyldig' });

    const count = await t.db.query<{ n: string }>('SELECT count(*)::text AS n FROM bot.quotes');
    expect(count.rows[0]!.n).toBe('2');
    expect((await findQuote(t.db, 'g1', 'pullar', null))?.message_id).toBe('m1');
    expect((await findQuote(t.db, 'g1', 'lisa', null))?.message_id).toBe('m2');
    expect((await findQuote(t.db, 'g1', null, 'u3'))?.content).toContain('Healern');
    expect(await findQuote(t.db, 'g1', 'finns-inte', null)).toBeNull();
    expect(await findQuote(t.db, 'other-guild', null, null)).toBeNull();
  });
});

describe('weekly report stats', () => {
  it('sums voice time inside the window, counts messages, finds the top song and quotes', async () => {
    const now = new Date('2026-10-04T17:00:00Z');
    const q = t.db.query.bind(t.db);
    // Voice: u1 2 h inside the window; u2 session started before the window (only 1 h counts).
    await q(
      `INSERT INTO stats.voice_sessions (guild_id, user_id, channel_id, username, joined_at, left_at) VALUES
       ('g1','u1','v','kalle','2026-10-02T18:00:00Z','2026-10-02T20:00:00Z'),
       ('g1','u2','v','lisa','2026-09-27T16:00:00Z','2026-09-27T18:00:00Z'),
       ('g1','u3','v','old','2026-09-01T10:00:00Z','2026-09-01T12:00:00Z')`,
    );
    await q(
      `INSERT INTO stats.message_log (message_id, guild_id, channel_id, user_id, username, content, created_at) VALUES
       ('a','g1','c','u1','kalle','hej','2026-10-03T10:00:00Z'),
       ('b','g1','c','u1','kalle','hej','2026-10-03T10:01:00Z'),
       ('c','g1','c','u2','lisa','hej','2026-10-03T10:02:00Z')`,
    );
    await q(
      `INSERT INTO bot.music_playback_log (guild_id, event, title, artist, created_at) VALUES
       ('g1','play_start','Darude','Sandstorm','2026-10-02T20:00:00Z'),
       ('g1','play_start','Darude','Sandstorm','2026-10-03T20:00:00Z'),
       ('g1','play_start','Other','X','2026-10-03T21:00:00Z')`,
    );
    await saveQuote(t.db, { ...base, messageId: 'q1', content: 'Veckans visdom' });
    // saved_at defaults to the real now(); move it into the fake week.
    await q(`UPDATE bot.quotes SET saved_at = '2026-10-03T12:00:00Z' WHERE message_id = 'q1'`);

    const stats = await collectWeeklyStats(t.db, 'g1', now);
    expect(stats.voiceHours).toBeCloseTo(3, 5);
    expect(stats.topVoice[0]).toMatchObject({ name: 'kalle' });
    expect(stats.topVoice[0]!.hours).toBeCloseTo(2, 5);
    expect(stats.topVoice[1]!.hours).toBeCloseTo(1, 5);
    expect(stats.topChatters).toEqual([
      { userId: 'u1', name: 'kalle', count: 2 },
      { userId: 'u2', name: 'lisa', count: 1 },
    ]);
    expect(stats.topSong).toEqual({ title: 'Darude', artist: 'Sandstorm', plays: 2 });
    expect(stats.quotes.map((x) => x.content)).toEqual(['Veckans visdom']);
  });

  it('leaves bots out of the voice and chat toplists', async () => {
    const now = new Date('2026-10-04T17:00:00Z');
    const q = t.db.query.bind(t.db);
    await q(
      `INSERT INTO stats.voice_sessions (guild_id, user_id, channel_id, username, joined_at, left_at) VALUES
       ('g1','bot','v','Clanker','2026-10-02T18:00:00Z','2026-10-02T23:00:00Z'),
       ('g1','u1','v','kalle','2026-10-02T18:00:00Z','2026-10-02T20:00:00Z')`,
    );
    await q(
      `INSERT INTO stats.message_log (message_id, guild_id, channel_id, user_id, username, content, created_at) VALUES
       ('a','g1','c','bot','Clanker','beep','2026-10-03T10:00:00Z'),
       ('b','g1','c','u1','kalle','hej','2026-10-03T10:01:00Z')`,
    );
    const stats = await collectWeeklyStats(t.db, 'g1', now, { excludeUserIds: ['bot'] });
    expect(stats.topVoice.map((v) => v.userId)).toEqual(['u1']);
    expect(stats.voiceHours).toBeCloseTo(2, 5);
    expect(stats.topChatters.map((c) => c.userId)).toEqual(['u1']);
  });
});
