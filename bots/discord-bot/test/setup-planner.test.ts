import { describe, expect, it } from 'vitest';
import { PermissionFlagsBits } from 'discord.js';
import { wowBlueprint } from '../src/setup/blueprint.js';
import { normaliseName, planSetup, type GuildSnapshot, type PlanStep, type SnapshotChannel } from '../src/setup/planner.js';

const bp = wowBlueprint('forever');

function ch(id: string, name: string, kind: SnapshotChannel['kind'], parentId: string | null = null, extra: Partial<SnapshotChannel> = {}): SnapshotChannel {
  return { id, name, kind, parentId, everyoneAllow: 0n, everyoneDeny: 0n, ...extra };
}

function snap(channels: SnapshotChannel[], extra: Partial<GuildSnapshot> = {}): GuildSnapshot {
  return { channels, roles: [], bindings: {}, protectedChannelIds: new Set(), ...extra };
}

const ops = (steps: PlanStep[]) => steps.map((s) => s.op);
const count = (steps: PlanStep[], op: PlanStep['op']) => steps.filter((s) => s.op === op).length;

describe('normaliseName', () => {
  it('ignores emoji, case and separators', () => {
    expect(normaliseName('⚔️ WoW')).toBe('wow');
    expect(normaliseName('raid-anmälan')).toBe(normaliseName('Raid Anmälan'));
    expect(normaliseName('➕ Skapa grupp')).toBe('skapagrupp');
  });
});

describe('planSetup', () => {
  it('creates everything on an empty server and archives nothing', () => {
    const plan = planSetup(bp, snap([]), { archiveOthers: true });
    expect(count(plan.steps, 'create-category')).toBe(4);
    expect(count(plan.steps, 'create-channel')).toBe(bp.channels.length);
    expect(count(plan.steps, 'create-role')).toBe(bp.roles.length);
    expect(count(plan.steps, 'archive-channel')).toBe(0);
    expect(ops(plan.steps).slice(-2)).toEqual(['role-picker', 'onboarding']);
    // Forever has 9 classes and no M+.
    expect(bp.roles.filter((r) => r.group === 'class')).toHaveLength(9);
    expect(bp.roles.map((r) => r.name)).toContain('Dungeons');
    expect(bp.channels.find((c) => c.key === 'ch.lfg')?.forumTags).not.toContain('M+');
  });

  it('reuses matching channels, moves misplaced ones and archives unknown ones', () => {
    const channels = [
      ch('c1', '⚔️ WoW', 'category'),
      ch('t1', 'allmänt', 'text', 'c1'),
      ch('t2', 'Annonser', 'text', null), // exists but not in Info and not read-only
      ch('t3', 'memes', 'text', 'c1'), // not in blueprint → archive
      ch('v1', 'Raid', 'voice', null),
      ch('rules', 'regler', 'text', null), // protected
    ];
    const plan = planSetup(bp, snap(channels, { protectedChannelIds: new Set(['rules']) }), { archiveOthers: true });
    const reuse = plan.steps.filter((s) => s.op === 'reuse-channel').map((s) => (s as { id: string }).id);
    expect(reuse.sort()).toEqual(['t1', 't2', 'v1']);
    const moved = plan.steps.filter((s) => s.op === 'move-channel').map((s) => (s as { id: string }).id);
    expect(moved.sort()).toEqual(['t2', 'v1']); // allmänt already sits in ⚔️ WoW
    expect(plan.steps.find((s) => s.op === 'set-readonly' && s.id === 't2')).toBeDefined();
    const archived = plan.steps.filter((s) => s.op === 'archive-channel').map((s) => (s as { id: string }).id);
    expect(archived).toEqual(['t3']);
    expect(plan.steps.some((s) => s.op === 'create-category' && s.key === 'cat.arkiv')).toBe(true);
  });

  it('is idempotent: a fully set-up server needs no mutating steps except picker/onboarding refresh', () => {
    const first = planSetup(bp, snap([]), { archiveOthers: true });
    // Simulate the result of executing the first plan.
    const channels: SnapshotChannel[] = [];
    const bindings: Record<string, string> = {};
    let n = 0;
    for (const s of first.steps) {
      if (s.op === 'create-category') {
        const id = `cat${n++}`;
        channels.push(ch(id, s.name, 'category'));
        bindings[s.key] = id;
      }
    }
    for (const s of first.steps) {
      if (s.op === 'create-channel') {
        const id = `ch${n++}`;
        const parent = 'key' in s.parent ? bindings[s.parent.key]! : s.parent.id;
        channels.push(
          ch(id, s.channel.name, s.channel.kind, parent, {
            everyoneDeny: s.channel.readOnly ? PermissionFlagsBits.SendMessages : 0n,
            forumTags: s.channel.forumTags,
          }),
        );
        bindings[s.channel.key] = id;
      }
    }
    const roles = bp.roles.map((r, i) => ({ id: `r${i}`, name: r.name, color: r.color ?? 0, mentionable: r.mentionable ?? false, manageable: true }));
    const second = planSetup(bp, snap(channels, { roles, bindings }), { archiveOthers: true });
    expect(ops(second.steps).filter((op) => !op.startsWith('reuse-'))).toEqual(['role-picker', 'onboarding']);
  });

  it('finds renamed channels through their binding', () => {
    const channels = [ch('x', 'mina-raider', 'text', null)];
    const plan = planSetup(bp, snap(channels, { bindings: { 'ch.raid': 'x' } }), { archiveOthers: true });
    expect(plan.steps.find((s) => s.op === 'reuse-channel' && s.id === 'x')).toMatchObject({ channel: { key: 'ch.raid' } });
    expect(count(plan.steps, 'archive-channel')).toBe(0);
  });

  it('adds missing forum tags and warns about roles it cannot manage', () => {
    const channels = [ch('f', 'lfg', 'forum', null, { forumTags: ['Raid'] })];
    const roles = [{ id: 'r', name: 'Tank', color: 123, mentionable: false, manageable: false }];
    const plan = planSetup(bp, snap(channels, { roles }), { archiveOthers: false });
    const tags = plan.steps.find((s) => s.op === 'add-forum-tags') as { tags: string[] } | undefined;
    expect(tags?.tags).toEqual(['Dungeon', 'PvP', 'Leveling', 'Övrigt']);
    expect(plan.warnings.join(' ')).toMatch(/@Tank/);
  });

  it('can skip archiving', () => {
    const plan = planSetup(bp, snap([ch('m', 'memes', 'text')]), { archiveOthers: false });
    expect(count(plan.steps, 'archive-channel')).toBe(0);
  });
});
