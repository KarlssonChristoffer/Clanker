/**
 * Server blueprints for /setup. Keys are stable identifiers (stored in bot.setup_bindings) so a re-run
 * finds channels and roles even after they were renamed in Discord.
 */
import type { WowFlavor } from '../core/config.js';
import { classesFor, groupContentRoleName, lfgTagsFor } from '../wow/game-data.js';

export type ChannelKind = 'text' | 'forum' | 'voice';

export type BlueprintCategory = { key: string; name: string };

export type BlueprintChannel = {
  key: string;
  name: string;
  kind: ChannelKind;
  category: string;
  topic?: string;
  /** @everyone may read but not post (admins and the bot still can). */
  readOnly?: boolean;
  forumTags?: string[];
  /** Listed as an onboarding default channel. */
  onboardingDefault?: boolean;
};

export type RoleGroup = 'class' | 'role' | 'interest';

export type BlueprintRole = {
  key: string;
  name: string;
  group: RoleGroup;
  color?: number;
  mentionable?: boolean;
  /** Label + emoji for the role picker / onboarding. */
  emoji?: string;
  description?: string;
};

export type Blueprint = {
  id: string;
  categories: BlueprintCategory[];
  channels: BlueprintChannel[];
  roles: BlueprintRole[];
  archive: BlueprintCategory;
};

export const ARCHIVE_CATEGORY: BlueprintCategory = { key: 'cat.arkiv', name: '📦 Arkiv' };

export function wowBlueprint(flavor: WowFlavor): Blueprint {
  const groupRole = groupContentRoleName(flavor);
  return {
    id: 'wow',
    archive: ARCHIVE_CATEGORY,
    categories: [
      { key: 'cat.info', name: 'ℹ️ Info' },
      { key: 'cat.wow', name: '⚔️ WoW' },
      { key: 'cat.socialt', name: '🎉 Socialt' },
      { key: 'cat.rost', name: '🔊 Röst' },
    ],
    channels: [
      { key: 'ch.valkommen', name: 'välkommen', kind: 'text', category: 'cat.info', readOnly: true, onboardingDefault: true, topic: 'Välkommen! Välj klass, roll och vad du vill göra här nedanför.' },
      { key: 'ch.annonser', name: 'annonser', kind: 'text', category: 'cat.info', readOnly: true, onboardingDefault: true, topic: 'Nyheter, weekly reset och veckorapporten.' },
      { key: 'ch.allmant', name: 'allmänt', kind: 'text', category: 'cat.wow', onboardingDefault: true, topic: 'Allt om WoW som inte passar någon annanstans.' },
      { key: 'ch.lfg', name: 'lfg', kind: 'forum', category: 'cat.wow', forumTags: lfgTagsFor(flavor), onboardingDefault: true, topic: 'Ett inlägg per grupp. Skriv vad, när och vilka roller ni saknar, så hjälper Clanker till.' },
      { key: 'ch.raid', name: 'raid-anmälan', kind: 'text', category: 'cat.wow', onboardingDefault: true, topic: 'Raider och dungeons: anmäl dig med knapparna. Skapa med /raid skapa.' },
      { key: 'ch.loot', name: 'loot-och-flex', kind: 'text', category: 'cat.wow', onboardingDefault: true, topic: 'Visa upp loot, achievements och annat skryt.' },
      { key: 'ch.guider', name: 'guider-och-addons', kind: 'text', category: 'cat.wow', onboardingDefault: true, topic: 'Guider, addons, WeakAuras och macros.' },
      { key: 'ch.clips', name: 'clips', kind: 'text', category: 'cat.socialt', onboardingDefault: true, topic: 'Klipp och skärmdumpar.' },
      { key: 'ch.citat', name: 'citat', kind: 'text', category: 'cat.socialt', onboardingDefault: true, topic: 'Reagera med 💬 på ett meddelande så hamnar det i citatboken.' },
      { key: 'ch.musik', name: 'musik', kind: 'text', category: 'cat.rost', onboardingDefault: true, topic: 'Styr musiken här: /play <låt, länk eller spellista>. Panelen visar vad som spelas och har knappar för paus, nästa och stopp.' },
      { key: 'vc.raid', name: 'Raid', kind: 'voice', category: 'cat.rost' },
      { key: 'vc.skapa', name: '➕ Skapa grupp', kind: 'voice', category: 'cat.rost' },
      { key: 'vc.afk', name: 'AFK', kind: 'voice', category: 'cat.rost' },
    ],
    roles: [
      ...classesFor(flavor).map((c) => ({
        key: `role.class.${c.key}`,
        name: c.name,
        group: 'class' as const,
        color: c.color,
        mentionable: false,
      })),
      { key: 'role.tank', name: 'Tank', group: 'role', mentionable: true, emoji: '🛡️', description: 'Pingas när en grupp saknar tank' },
      { key: 'role.healer', name: 'Healer', group: 'role', mentionable: true, emoji: '💚', description: 'Pingas när en grupp saknar healer' },
      { key: 'role.dps', name: 'DPS', group: 'role', mentionable: true, emoji: '⚔️', description: 'Pingas när en grupp saknar DPS' },
      { key: 'role.raider', name: 'Raider', group: 'interest', mentionable: true, emoji: '🐉', description: 'Raidar regelbundet' },
      { key: 'role.group', name: groupRole, group: 'interest', mentionable: true, emoji: '🔑', description: flavor === 'retail' ? 'Kör M+-nycklar' : 'Kör dungeons' },
      { key: 'role.casual', name: 'Casual', group: 'interest', mentionable: true, emoji: '🌿', description: 'Spelar när andan faller på' },
    ],
  };
}
