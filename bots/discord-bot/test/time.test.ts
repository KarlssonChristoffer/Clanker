import { describe, expect, it } from 'vitest';
import { nextWeeklyStockholm, nextWeeklyUtc, parseWhen, zonedParts, zonedToUtc } from '../src/core/time.js';

// Thursday 2026-10-01 18:00 CEST (16:00 UTC)
const NOW = new Date('2026-10-01T16:00:00Z');
const at = (input: string, now = NOW) => parseWhen(input, now)?.at.toISOString() ?? null;

describe('zonedToUtc (Europe/Stockholm)', () => {
  it('uses CEST in summer and CET in winter', () => {
    expect(zonedToUtc(2026, 7, 1, 20, 0).toISOString()).toBe('2026-07-01T18:00:00.000Z');
    expect(zonedToUtc(2026, 12, 1, 20, 0).toISOString()).toBe('2026-12-01T19:00:00.000Z');
  });

  it('handles the October fall-back and the March spring-forward', () => {
    // 2026-10-25: 03:00 CEST → 02:00 CET. 02:30 happens twice; we pick the later (CET) one.
    expect(zonedToUtc(2026, 10, 25, 2, 30).toISOString()).toBe('2026-10-25T01:30:00.000Z');
    expect(zonedToUtc(2026, 10, 25, 20, 0).toISOString()).toBe('2026-10-25T19:00:00.000Z');
    expect(zonedToUtc(2026, 10, 24, 20, 0).toISOString()).toBe('2026-10-24T18:00:00.000Z');
    // 2027-03-28: 02:00 CET → 03:00 CEST. 02:30 does not exist and moves forward to 03:30.
    expect(zonedToUtc(2027, 3, 28, 2, 30).toISOString()).toBe('2027-03-28T01:30:00.000Z');
    expect(zonedParts(new Date('2027-03-28T01:30:00Z')).hour).toBe(3);
  });
});

describe('parseWhen', () => {
  it('clock times → next occurrence', () => {
    expect(at('20:00')).toBe('2026-10-01T18:00:00.000Z');
    expect(at('kl 20.30')).toBe('2026-10-01T18:30:00.000Z');
    expect(at('20')).toBe('2026-10-01T18:00:00.000Z');
    expect(at('17:00')).toBe('2026-10-02T15:00:00.000Z'); // already passed today → tomorrow
    expect(at('kl.21')).toBe('2026-10-01T19:00:00.000Z');
  });

  it('day words', () => {
    expect(at('ikväll')).toBe('2026-10-01T18:00:00.000Z'); // default 20:00
    expect(at('ikväll 9')).toBe('2026-10-01T19:00:00.000Z'); // 9 in the evening = 21
    expect(at('i kväll kl 21:30')).toBe('2026-10-01T19:30:00.000Z');
    expect(at('imorgon 19')).toBe('2026-10-02T17:00:00.000Z');
    expect(at('i morgon kl 18:15')).toBe('2026-10-02T16:15:00.000Z');
    expect(at('övermorgon 20')).toBe('2026-10-03T18:00:00.000Z');
    expect(at('idag 19')).toBe('2026-10-01T17:00:00.000Z');
    expect(at('idag 17')).toBeNull(); // in the past
  });

  it('weekdays → next occurrence, today only if still ahead', () => {
    expect(at('fredag 20')).toBe('2026-10-02T18:00:00.000Z');
    expect(at('fre 20:30')).toBe('2026-10-02T18:30:00.000Z');
    expect(at('lördag')).toBe('2026-10-03T18:00:00.000Z');
    expect(at('tors 21')).toBe('2026-10-01T19:00:00.000Z'); // today, still ahead
    expect(at('torsdag 17')).toBe('2026-10-08T15:00:00.000Z'); // today but passed → next week
    expect(at('söndag kl 19')).toBe('2026-10-04T17:00:00.000Z');
    expect(at('mån 20')).toBe('2026-10-05T18:00:00.000Z');
  });

  it('dates in several formats, DST-aware', () => {
    expect(at('2026-10-03 20:00')).toBe('2026-10-03T18:00:00.000Z');
    expect(at('3/10 20:00')).toBe('2026-10-03T18:00:00.000Z');
    expect(at('3 okt 20')).toBe('2026-10-03T18:00:00.000Z');
    expect(at('30 oktober kl 20:15')).toBe('2026-10-30T19:15:00.000Z'); // after DST ends → CET
    expect(at('3/10/2027 20')).toBe('2027-10-03T18:00:00.000Z');
    expect(at('1/9 20')).toBe('2027-09-01T18:00:00.000Z'); // passed this year → next year
    expect(at('2026-09-01 20:00')).toBeNull(); // explicit past date
    expect(at('31/2 20')).toBeNull(); // invalid date
  });

  it('relative times', () => {
    expect(at('om 30 min')).toBe('2026-10-01T16:30:00.000Z');
    expect(at('om 2 h')).toBe('2026-10-01T18:00:00.000Z');
    expect(at('om 1,5 timmar')).toBe('2026-10-01T17:30:00.000Z');
    expect(at('om 3 dagar')).toBe('2026-10-04T16:00:00.000Z');
    expect(at('om 1 vecka')).toBe('2026-10-08T16:00:00.000Z');
    expect(at('om lite')).toBeNull();
  });

  it('refuses to guess on unknown words', () => {
    expect(at('raid ikväll')).toBeNull();
    expect(at('snart')).toBeNull();
    expect(at('')).toBeNull();
    expect(at('25:00')).toBeNull();
  });

  it('reports whether a clock time was given', () => {
    expect(parseWhen('fredag', NOW)?.hasTime).toBe(false);
    expect(parseWhen('fredag 19', NOW)?.hasTime).toBe(true);
  });
});

describe('weekly slots', () => {
  it('EU reset: next Wednesday 04:00 UTC', () => {
    expect(nextWeeklyUtc(NOW, 3, 4, 0).toISOString()).toBe('2026-10-07T04:00:00.000Z');
    expect(nextWeeklyUtc(new Date('2026-10-07T04:00:00Z'), 3, 4, 0).toISOString()).toBe('2026-10-14T04:00:00.000Z');
    expect(nextWeeklyUtc(new Date('2026-10-07T03:59:00Z'), 3, 4, 0).toISOString()).toBe('2026-10-07T04:00:00.000Z');
  });

  it('Sunday 19:00 Stockholm keeps local time across DST', () => {
    expect(nextWeeklyStockholm(NOW, 7, 19, 0).toISOString()).toBe('2026-10-04T17:00:00.000Z');
    expect(nextWeeklyStockholm(new Date('2026-10-20T12:00:00Z'), 7, 19, 0).toISOString()).toBe('2026-10-25T18:00:00.000Z');
  });
});
