import { describe, expect, it } from 'vitest';
import { extractClock, extractKeyLevel, isFull, needsFromPresent } from '../src/wow/lfg-parse.js';
import { classesFor, compositionFor, findClass, lfgTagsFor } from '../src/wow/game-data.js';
import { compositionLine } from '../src/wow/raid.js';
import { ManualSource, RaiderIoClient, RetailSource, slugifyRealm } from '../src/wow/data-source.js';
import { nextReset } from '../src/wow/reset.js';

describe('LFG regex extraction', () => {
  it('finds key levels in the ways people write them', () => {
    expect(extractKeyLevel('LF tank +12 Ara-Kara')).toBe(12);
    expect(extractKeyLevel('kör m+ 15 ikväll')).toBe(15);
    expect(extractKeyLevel('M+10 anyone?')).toBe(10);
    expect(extractKeyLevel('har en key 8 att bränna')).toBe(8);
    expect(extractKeyLevel('nyckel 14 om en timme')).toBe(14);
    expect(extractKeyLevel('(+7) chill run')).toBe(7);
  });

  it('does not mistake times, ilvl or big numbers for keys', () => {
    expect(extractKeyLevel('raid 20:30')).toBeNull();
    expect(extractKeyLevel('behöver 612 ilvl')).toBeNull();
    expect(extractKeyLevel('+1')).toBeNull();
    expect(extractKeyLevel('hej allihop')).toBeNull();
  });

  it('extracts clock times', () => {
    expect(extractClock('kör 20:30')).toEqual({ hour: 20, minute: 30 });
    expect(extractClock('kl 21 ikväll')).toEqual({ hour: 21, minute: 0 });
    expect(extractClock('kl. 19.15')).toEqual({ hour: 19, minute: 15 });
    expect(extractClock('+12 nu direkt')).toBeNull();
  });

  it('turns present roles into open slots', () => {
    expect(needsFromPresent({ tank: true, healer: false, dps: true })).toEqual({ tank: 0, healer: 1, dps: 2 });
    expect(isFull({ tank: 0, healer: 0, dps: 0 })).toBe(true);
    expect(isFull({ tank: 0, healer: 1, dps: 0 })).toBe(false);
  });
});

describe('game data', () => {
  it('has 13 retail classes and 9 Forever classes', () => {
    expect(classesFor('retail')).toHaveLength(13);
    expect(classesFor('forever').map((c) => c.name)).toEqual([
      'Druid', 'Hunter', 'Mage', 'Paladin', 'Priest', 'Rogue', 'Shaman', 'Warlock', 'Warrior',
    ]);
    expect(findClass('retail', 'death knight')?.color).toBe(0xc41e3a);
    expect(findClass('forever', 'Evoker')).toBeUndefined();
  });

  it('has no M+ or Delves outside retail', () => {
    expect(lfgTagsFor('retail')).toContain('M+');
    expect(lfgTagsFor('forever')).not.toContain('M+');
    expect(lfgTagsFor('forever')).not.toContain('Delves');
  });

  it('raid compositions', () => {
    expect(compositionFor(5)).toEqual({ tank: 1, healer: 1, dps: 3 });
    expect(compositionFor(10)).toEqual({ tank: 2, healer: 2, dps: 6 });
    expect(compositionFor(20)).toEqual({ tank: 2, healer: 5, dps: 13 });
    expect(compositionFor(40)).toEqual({ tank: 4, healer: 10, dps: 26 });
    const signups = [
      { status: 'tank' as const }, { status: 'tank' as const },
      ...Array.from({ length: 4 }, () => ({ status: 'healer' as const })),
      ...Array.from({ length: 11 }, () => ({ status: 'dps' as const })),
      { status: 'maybe' as const },
    ];
    expect(compositionLine(signups, 20)).toBe('🛡️ 2/2 tanks · 💚 4/5 heals · ⚔️ 11/13 DPS');
  });
});

describe('data sources', () => {
  it('slugifies realms like Blizzard does', () => {
    expect(slugifyRealm('Tarren Mill')).toBe('tarren-mill');
    expect(slugifyRealm("Twisting Nether")).toBe('twisting-nether');
    expect(slugifyRealm("Mal'Ganis")).toBe('malganis');
    expect(slugifyRealm('Aggra (Português)')).toBe('aggra-portugues');
  });

  it('WoW Forever: manual source offers rulesets and the default realm', async () => {
    const src = new ManualSource('forever', 'Gehennas');
    expect(src.supportsLookup).toBe(false);
    const all = await src.realms('');
    expect(all.map((r) => r.name)).toEqual(['Gehennas', 'Normal', 'PvP', 'Roleplaying', 'Hardcore']);
    expect((await src.realms('pv')).map((r) => r.slug)).toContain('pvp');
    expect(await src.lookup()).toBeNull();
  });

  it('retail: Raider.IO profile is mapped and cached', async () => {
    let calls = 0;
    const fakeFetch = (async (url: string) => {
      calls += 1;
      expect(String(url)).toContain('fields=gear%2Cmythic_plus_scores_by_season%3Acurrent');
      return new Response(
        JSON.stringify({
          name: 'Kalle',
          realm: 'Tarren Mill',
          class: 'Mage',
          active_spec_name: 'Frost',
          active_spec_role: 'DPS',
          profile_url: 'https://raider.io/characters/eu/tarren-mill/Kalle',
          gear: { item_level_equipped: 612.4 },
          mythic_plus_scores_by_season: [{ scores: { all: 2450.5 } }],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as unknown as typeof fetch;
    const src = new RetailSource('eu', new RaiderIoClient('eu', undefined, fakeFetch), null);
    const p = await src.lookup('kalle', 'tarren-mill');
    expect(p).toMatchObject({ className: 'Mage', spec: 'Frost', role: 'dps', itemLevel: 612.4, mplusScore: 2450.5, source: 'raiderio' });
    await src.lookup('Kalle', 'tarren-mill');
    expect(calls).toBe(1); // 15-minute cache, case-insensitive name
  });
});

describe('weekly reset', () => {
  it('defaults to Wednesday 04:00 UTC', () => {
    expect(nextReset(new Date('2026-10-01T16:00:00Z')).toISOString()).toBe('2026-10-07T04:00:00.000Z');
  });
});
