/**
 * Static WoW data per flavor (WOW_FLAVOR). Verified 2026-09-26:
 * - retail (Midnight): 13 classes; Demon Hunter gained a third spec (Devourer, ranged DPS).
 * - forever (WoW Forever, launches 2026-11-04): the 9 original classes; Paladin and Shaman are
 *   available to both factions. No M+, no Delves.
 * - classic: the 9 original classes (Era/Anniversary namespaces via the Blizzard API).
 * Colours are the in-game class colours (warcraft.wiki.gg "Class colors"); Forever is assumed to
 * use the same colours.
 */
import type { WowFlavor } from '../core/config.js';

export type Role = 'tank' | 'healer' | 'dps';

export type WowClass = { key: string; name: string; color: number; roles: Role[] };

const cls = (key: string, name: string, color: number, roles: Role[]): WowClass => ({ key, name, color, roles });

const CLASSIC_CLASSES: WowClass[] = [
  cls('druid', 'Druid', 0xff7c0a, ['tank', 'healer', 'dps']),
  cls('hunter', 'Hunter', 0xaad372, ['dps']),
  cls('mage', 'Mage', 0x3fc7eb, ['dps']),
  cls('paladin', 'Paladin', 0xf48cba, ['tank', 'healer', 'dps']),
  cls('priest', 'Priest', 0xffffff, ['healer', 'dps']),
  cls('rogue', 'Rogue', 0xfff468, ['dps']),
  cls('shaman', 'Shaman', 0x0070dd, ['healer', 'dps']),
  cls('warlock', 'Warlock', 0x8788ee, ['dps']),
  cls('warrior', 'Warrior', 0xc69b6d, ['tank', 'dps']),
];

const RETAIL_CLASSES: WowClass[] = [
  cls('deathknight', 'Death Knight', 0xc41e3a, ['tank', 'dps']),
  cls('demonhunter', 'Demon Hunter', 0xa330c9, ['tank', 'dps']),
  cls('druid', 'Druid', 0xff7c0a, ['tank', 'healer', 'dps']),
  cls('evoker', 'Evoker', 0x33937f, ['healer', 'dps']),
  cls('hunter', 'Hunter', 0xaad372, ['dps']),
  cls('mage', 'Mage', 0x3fc7eb, ['dps']),
  cls('monk', 'Monk', 0x00ff98, ['tank', 'healer', 'dps']),
  cls('paladin', 'Paladin', 0xf48cba, ['tank', 'healer', 'dps']),
  cls('priest', 'Priest', 0xffffff, ['healer', 'dps']),
  cls('rogue', 'Rogue', 0xfff468, ['dps']),
  cls('shaman', 'Shaman', 0x0070dd, ['healer', 'dps']),
  cls('warlock', 'Warlock', 0x8788ee, ['dps']),
  cls('warrior', 'Warrior', 0xc69b6d, ['tank', 'dps']),
];

export function classesFor(flavor: WowFlavor): WowClass[] {
  return flavor === 'retail' ? RETAIL_CLASSES : CLASSIC_CLASSES;
}

export function findClass(flavor: WowFlavor, name: string | null | undefined): WowClass | undefined {
  if (!name) return undefined;
  const k = name.toLowerCase().replace(/[^a-z]/g, '');
  return classesFor(flavor).find((c) => c.key === k || c.name.toLowerCase().replace(/[^a-z]/g, '') === k);
}

export const ROLE_LABEL: Record<Role, string> = { tank: 'Tank', healer: 'Healer', dps: 'DPS' };
export const ROLE_EMOJI: Record<Role, string> = { tank: '🛡️', healer: '💚', dps: '⚔️' };

/** Tags for the #lfg forum (Discord allows at most 20, each ≤ 20 chars). */
export function lfgTagsFor(flavor: WowFlavor): string[] {
  return flavor === 'retail' ? ['M+', 'Raid', 'Delves', 'PvP', 'Övrigt'] : ['Dungeon', 'Raid', 'PvP', 'Leveling', 'Övrigt'];
}

/** Group-content interest role (@M+ on retail; there is no M+ in Forever/Classic). */
export function groupContentRoleName(flavor: WowFlavor): string {
  return flavor === 'retail' ? 'M+' : 'Dungeons';
}

/** Realm-ish choices when there is no realm API. WoW Forever uses rulesets instead of realms. */
export const FOREVER_RULESETS = [
  { name: 'Normal', slug: 'normal' },
  { name: 'PvP', slug: 'pvp' },
  { name: 'Roleplaying', slug: 'roleplaying' },
  { name: 'Hardcore', slug: 'hardcore' },
] as const;

/** Default raid/dungeon sizes when /raid skapa has no explicit size. */
export function defaultRaidSize(flavor: WowFlavor): number {
  return flavor === 'retail' ? 20 : 40;
}

/** Target composition for a group size (tanks / healers / dps). */
export function compositionFor(size: number): Record<Role, number> {
  if (size <= 5) return { tank: 1, healer: 1, dps: Math.max(0, size - 2) };
  if (size <= 10) return { tank: 2, healer: 2, dps: size - 4 };
  const healer = Math.round(size / 4);
  // 20 → 2/5/13, 25 → 2/6/17, 40 → 4/10/26
  const tank = size <= 25 ? 2 : 4;
  return { tank, healer, dps: size - tank - healer };
}
