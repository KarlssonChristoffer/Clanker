/**
 * Pure setup planner: blueprint + snapshot of the guild → ordered list of steps. The same plan is
 * rendered for the dry run and executed for a real run, so "torrkörning" shows exactly what happens.
 *
 * Idempotency: things are matched by stored binding id first, then by normalised name and kind, so a
 * second run finds everything and plans nothing. Channels that are not in the blueprint are never
 * deleted; they are moved to 📦 Arkiv and made read-only (unless protected, e.g. the rules channel).
 */
import { PermissionFlagsBits } from 'discord.js';
import type { Blueprint, BlueprintChannel, BlueprintRole, ChannelKind } from './blueprint.js';

export type SnapshotChannelKind = ChannelKind | 'category' | 'other';

export type SnapshotChannel = {
  id: string;
  name: string;
  kind: SnapshotChannelKind;
  parentId: string | null;
  /** @everyone overwrite on this channel (bitfields). */
  everyoneAllow: bigint;
  everyoneDeny: bigint;
  forumTags?: string[];
};

export type SnapshotRole = { id: string; name: string; color: number; mentionable: boolean; manageable: boolean };

export type GuildSnapshot = {
  channels: SnapshotChannel[];
  roles: SnapshotRole[];
  bindings: Record<string, string>;
  /** Channels that must never be archived (rules, community updates, temp voice channels…). */
  protectedChannelIds: ReadonlySet<string>;
};

/** Where a channel should end up: an existing category id or a category created earlier in the plan. */
export type CategoryRef = { id: string } | { key: string };

export type PlanStep =
  | { op: 'create-role'; role: BlueprintRole }
  | { op: 'reuse-role'; role: BlueprintRole; id: string }
  | { op: 'edit-role'; role: BlueprintRole; id: string; changes: { color?: number; mentionable?: boolean } }
  | { op: 'create-category'; key: string; name: string }
  | { op: 'reuse-category'; key: string; name: string; id: string }
  | { op: 'create-channel'; channel: BlueprintChannel; parent: CategoryRef }
  | { op: 'reuse-channel'; channel: BlueprintChannel; id: string; currentName: string }
  | { op: 'move-channel'; channel: BlueprintChannel; id: string; currentName: string; fromParentId: string | null; parent: CategoryRef }
  | { op: 'set-readonly'; channel: BlueprintChannel; id: string; currentName: string }
  | { op: 'add-forum-tags'; channel: BlueprintChannel; id: string; tags: string[] }
  | { op: 'archive-channel'; id: string; name: string; fromParentId: string | null; parent: CategoryRef }
  | { op: 'role-picker' }
  | { op: 'onboarding' };

export type Plan = { steps: PlanStep[]; warnings: string[] };

/** Send-type permissions removed for @everyone in read-only and archived channels. */
export const READ_ONLY_DENY =
  PermissionFlagsBits.SendMessages |
  PermissionFlagsBits.SendMessagesInThreads |
  PermissionFlagsBits.CreatePublicThreads |
  PermissionFlagsBits.CreatePrivateThreads;

/** Lowercase, drop emoji/punctuation/separators: "⚔️ WoW" → "wow", "raid-anmälan" → "raidanmälan". */
export function normaliseName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFC')
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

function isReadOnly(ch: SnapshotChannel): boolean {
  return (ch.everyoneDeny & PermissionFlagsBits.SendMessages) !== 0n;
}

export function planSetup(bp: Blueprint, snap: GuildSnapshot, opts: { archiveOthers: boolean }): Plan {
  const steps: PlanStep[] = [];
  const warnings: string[] = [];
  const used = new Set<string>();
  const byId = new Map(snap.channels.map((c) => [c.id, c]));

  const findChannel = (key: string, name: string, kind: SnapshotChannelKind): SnapshotChannel | undefined => {
    const boundId = snap.bindings[key];
    const bound = boundId ? byId.get(boundId) : undefined;
    if (bound && bound.kind === kind && !used.has(bound.id)) return bound;
    const n = normaliseName(name);
    return snap.channels.find((c) => c.kind === kind && !used.has(c.id) && normaliseName(c.name) === n);
  };

  // ── Roles ──────────────────────────────────────────────────────────────────
  for (const role of bp.roles) {
    const boundId = snap.bindings[role.key];
    const existing =
      (boundId ? snap.roles.find((r) => r.id === boundId) : undefined) ??
      snap.roles.find((r) => r.name.toLowerCase() === role.name.toLowerCase());
    if (!existing) {
      steps.push({ op: 'create-role', role });
      continue;
    }
    steps.push({ op: 'reuse-role', role, id: existing.id });
    const changes: { color?: number; mentionable?: boolean } = {};
    if (role.color !== undefined && existing.color !== role.color) changes.color = role.color;
    if (role.mentionable !== undefined && existing.mentionable !== role.mentionable) changes.mentionable = role.mentionable;
    if (Object.keys(changes).length) {
      if (existing.manageable) steps.push({ op: 'edit-role', role, id: existing.id, changes });
      else warnings.push(`Rollen @${existing.name} ligger över botens roll och kan inte justeras (färg/pingbarhet).`);
    }
  }

  // ── Categories ─────────────────────────────────────────────────────────────
  const categoryRef = new Map<string, CategoryRef>();
  for (const cat of bp.categories) {
    const existing = findChannel(cat.key, cat.name, 'category');
    if (existing) {
      used.add(existing.id);
      categoryRef.set(cat.key, { id: existing.id });
      steps.push({ op: 'reuse-category', key: cat.key, name: existing.name, id: existing.id });
    } else {
      categoryRef.set(cat.key, { key: cat.key });
      steps.push({ op: 'create-category', key: cat.key, name: cat.name });
    }
  }

  // ── Blueprint channels ─────────────────────────────────────────────────────
  for (const ch of bp.channels) {
    const parent = categoryRef.get(ch.category)!;
    const existing = findChannel(ch.key, ch.name, ch.kind);
    if (!existing) {
      steps.push({ op: 'create-channel', channel: ch, parent });
      continue;
    }
    used.add(existing.id);
    steps.push({ op: 'reuse-channel', channel: ch, id: existing.id, currentName: existing.name });
    const inPlace = 'id' in parent && existing.parentId === parent.id;
    if (!inPlace) {
      steps.push({ op: 'move-channel', channel: ch, id: existing.id, currentName: existing.name, fromParentId: existing.parentId, parent });
    }
    if (ch.readOnly && !isReadOnly(existing)) {
      steps.push({ op: 'set-readonly', channel: ch, id: existing.id, currentName: existing.name });
    }
    if (ch.kind === 'forum' && ch.forumTags?.length) {
      const have = new Set((existing.forumTags ?? []).map((t) => t.toLowerCase()));
      const missing = ch.forumTags.filter((t) => !have.has(t.toLowerCase()));
      if (missing.length) steps.push({ op: 'add-forum-tags', channel: ch, id: existing.id, tags: missing });
    }
  }

  // ── Archive everything else ────────────────────────────────────────────────
  if (opts.archiveOthers) {
    const archiveExisting = findChannel(bp.archive.key, bp.archive.name, 'category');
    const archiveRef: CategoryRef = archiveExisting ? { id: archiveExisting.id } : { key: bp.archive.key };
    const toArchive = snap.channels.filter(
      (c) =>
        c.kind !== 'category' &&
        !used.has(c.id) &&
        !snap.protectedChannelIds.has(c.id) &&
        !(archiveExisting && c.parentId === archiveExisting.id),
    );
    if (toArchive.length) {
      if (archiveExisting) {
        used.add(archiveExisting.id);
        steps.push({ op: 'reuse-category', key: bp.archive.key, name: archiveExisting.name, id: archiveExisting.id });
      } else {
        steps.push({ op: 'create-category', key: bp.archive.key, name: bp.archive.name });
      }
      for (const c of toArchive) {
        steps.push({ op: 'archive-channel', id: c.id, name: c.name, fromParentId: c.parentId, parent: archiveRef });
      }
    }
  }

  steps.push({ op: 'role-picker' }, { op: 'onboarding' });
  return { steps, warnings };
}

/** Steps that change something in Discord (reuse-* are informational). */
export function isMutating(step: PlanStep): boolean {
  return !step.op.startsWith('reuse-');
}
