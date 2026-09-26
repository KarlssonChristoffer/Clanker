/**
 * Executes a setup plan against Discord and records every change in bot.setup_changes so that
 * "Ångra senaste setup" can replay it backwards. Also renders plans (dry run) in Swedish.
 *
 * Undo is conservative: things the run created are only deleted when nothing else depends on them
 * (no messages from people in a channel, no members in a role); otherwise they are left and reported.
 */
import { isPostable } from '../core/channels.js';
import {
  ActionRowBuilder,
  ChannelType,
  EmbedBuilder,
  GuildFeature,
  GuildOnboardingMode,
  PermissionFlagsBits,
  StringSelectMenuBuilder,
  type CategoryChannel,
  type ForumChannel,
  type Guild,
  type GuildBasedChannel,
  type GuildChannelCreateOptions,
  type GuildOnboardingPromptData,
  type PermissionOverwriteOptions,
} from 'discord.js';
import type { Queryable } from '../db.js';
import { childLogger } from '../core/logger.js';
import { customId } from '../core/components.js';
import type { Blueprint, BlueprintRole, RoleGroup } from './blueprint.js';
import {
  READ_ONLY_DENY,
  type CategoryRef,
  type GuildSnapshot,
  type Plan,
  type PlanStep,
  type SnapshotChannel,
  type SnapshotChannelKind,
} from './planner.js';

const log = childLogger('setup');

export const ROLE_PICKER_BINDING = 'msg.role-picker';
const READ_ONLY_FLAGS = ['SendMessages', 'SendMessagesInThreads', 'CreatePublicThreads', 'CreatePrivateThreads'] as const;
type ReadOnlyFlag = (typeof READ_ONLY_FLAGS)[number];

/** Permissions the bot needs for /setup. */
export const SETUP_BOT_PERMISSIONS = [
  ['ManageChannels', PermissionFlagsBits.ManageChannels],
  ['ManageRoles', PermissionFlagsBits.ManageRoles],
  ['ManageGuild', PermissionFlagsBits.ManageGuild],
  ['ViewChannel', PermissionFlagsBits.ViewChannel],
  ['SendMessages', PermissionFlagsBits.SendMessages],
  ['EmbedLinks', PermissionFlagsBits.EmbedLinks],
] as const;

// ── Bindings ─────────────────────────────────────────────────────────────────

/** Bindings are read on hot paths (every #lfg message, every voice join): cache per guild for 60 s. */
const BINDINGS_TTL_MS = 60_000;
const bindingsCache = new Map<string, { at: number; data: Record<string, string> }>();

export async function loadBindings(db: Queryable, guildId: string): Promise<Record<string, string>> {
  const cached = bindingsCache.get(guildId);
  if (cached && Date.now() - cached.at < BINDINGS_TTL_MS) return cached.data;
  const res = await db.query<{ blueprint_key: string; discord_id: string }>(
    'SELECT blueprint_key, discord_id FROM bot.setup_bindings WHERE guild_id = $1',
    [guildId],
  );
  const data = Object.fromEntries(res.rows.map((r) => [r.blueprint_key, r.discord_id]));
  bindingsCache.set(guildId, { at: Date.now(), data });
  return data;
}

export async function bind(db: Queryable, guildId: string, key: string, kind: string, id: string): Promise<void> {
  await db.query(
    `INSERT INTO bot.setup_bindings (guild_id, blueprint_key, kind, discord_id, updated_at)
     VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (guild_id, blueprint_key) DO UPDATE SET kind = EXCLUDED.kind, discord_id = EXCLUDED.discord_id, updated_at = now()`,
    [guildId, key, kind, id],
  );
  bindingsCache.delete(guildId);
}

/** Channel id bound to a blueprint key (e.g. 'ch.annonser'), falling back to a channel with that name. */
export async function boundChannelId(db: Queryable, guild: Guild, key: string, fallbackName: string): Promise<string | null> {
  const bindings = await loadBindings(db, guild.id);
  const id = bindings[key];
  if (id && guild.channels.cache.has(id)) return id;
  const byName = guild.channels.cache.find((c) => c.name.toLowerCase() === fallbackName.toLowerCase());
  return byName?.id ?? null;
}

// ── Snapshot ─────────────────────────────────────────────────────────────────

function kindOf(type: ChannelType): SnapshotChannelKind | null {
  switch (type) {
    case ChannelType.GuildCategory:
      return 'category';
    case ChannelType.GuildText:
    case ChannelType.GuildAnnouncement:
      return 'text';
    case ChannelType.GuildForum:
      return 'forum';
    case ChannelType.GuildVoice:
    case ChannelType.GuildStageVoice:
      return 'voice';
    case ChannelType.GuildMedia:
      return 'other';
    default:
      return null; // threads, DMs
  }
}

export async function snapshotGuild(guild: Guild, db: Queryable): Promise<GuildSnapshot> {
  await guild.channels.fetch();
  await guild.roles.fetch();
  const channels: SnapshotChannel[] = [];
  for (const c of guild.channels.cache.values()) {
    const kind = kindOf(c.type);
    if (!kind || c.isThread()) continue;
    const ow = 'permissionOverwrites' in c ? c.permissionOverwrites.cache.get(guild.id) : undefined;
    channels.push({
      id: c.id,
      name: c.name,
      kind,
      parentId: c.parentId ?? null,
      everyoneAllow: ow?.allow.bitfield ?? 0n,
      everyoneDeny: ow?.deny.bitfield ?? 0n,
      forumTags: c.type === ChannelType.GuildForum ? (c as ForumChannel).availableTags.map((t) => t.name) : undefined,
    });
  }
  const roles = [...guild.roles.cache.values()]
    .filter((r) => r.id !== guild.id && !r.managed)
    .map((r) => ({ id: r.id, name: r.name, color: r.color, mentionable: r.mentionable, manageable: r.editable }));
  const temp = await db.query<{ channel_id: string }>('SELECT channel_id FROM bot.temp_voice_channels WHERE guild_id = $1', [guild.id]);
  const protectedIds = new Set<string>(
    [guild.rulesChannelId, guild.publicUpdatesChannelId, guild.safetyAlertsChannelId, ...temp.rows.map((r) => r.channel_id)].filter(
      (x): x is string => Boolean(x),
    ),
  );
  return { channels, roles, bindings: await loadBindings(db, guild.id), protectedChannelIds: protectedIds };
}

// ── Rendering (dry run and summaries) ───────────────────────────────────────

function kindIcon(kind: string): string {
  return kind === 'voice' ? '🔊' : kind === 'forum' ? '💬' : kind === 'category' ? '📁' : '#';
}

export function renderPlan(plan: Plan, guild: Guild, blueprint: Blueprint): EmbedBuilder[] {
  const nameOfCategory = (ref: CategoryRef) =>
    'id' in ref ? (guild.channels.cache.get(ref.id)?.name ?? ref.id) : ([...blueprint.categories, blueprint.archive].find((c) => c.key === ref.key)?.name ?? ref.key);
  const nameOfParent = (id: string | null) => (id ? (guild.channels.cache.get(id)?.name ?? 'okänd kategori') : 'utan kategori');
  const sections: Record<string, string[]> = {
    '➕ Skapas': [],
    '📦 Flyttas': [],
    '🔒 Skrivskyddas': [],
    '🏷️ Forumtaggar läggs till': [],
    '🎨 Roller justeras': [],
    '🗄️ Arkiveras (flyttas till 📦 Arkiv, skrivskyddas, raderas aldrig)': [],
    '♻️ Återanvänds': [],
    '🧭 Onboarding': [],
  };
  for (const s of plan.steps) {
    switch (s.op) {
      case 'create-role':
        sections['➕ Skapas']!.push(`@${s.role.name}${s.role.mentionable ? ' (pingbar)' : ''}`);
        break;
      case 'create-category':
        sections['➕ Skapas']!.push(`📁 ${s.name}`);
        break;
      case 'create-channel':
        sections['➕ Skapas']!.push(
          `${kindIcon(s.channel.kind)}${s.channel.name} i ${nameOfCategory(s.parent)}${s.channel.readOnly ? ' (skrivskyddad)' : ''}${s.channel.forumTags ? ` (taggar: ${s.channel.forumTags.join(', ')})` : ''}`,
        );
        break;
      case 'move-channel':
        sections['📦 Flyttas']!.push(`${kindIcon(s.channel.kind)}${s.currentName}: ${nameOfParent(s.fromParentId)} → ${nameOfCategory(s.parent)}`);
        break;
      case 'set-readonly':
        sections['🔒 Skrivskyddas']!.push(`#${s.currentName}`);
        break;
      case 'add-forum-tags':
        sections['🏷️ Forumtaggar läggs till']!.push(`#${s.channel.name}: ${s.tags.join(', ')}`);
        break;
      case 'edit-role':
        sections['🎨 Roller justeras']!.push(
          `@${s.role.name}: ${[s.changes.color !== undefined ? 'klassfärg' : '', s.changes.mentionable !== undefined ? (s.changes.mentionable ? 'blir pingbar' : 'blir icke-pingbar') : ''].filter(Boolean).join(', ')}`,
        );
        break;
      case 'archive-channel':
        sections['🗄️ Arkiveras (flyttas till 📦 Arkiv, skrivskyddas, raderas aldrig)']!.push(`${s.name} (från ${nameOfParent(s.fromParentId)})`);
        break;
      case 'reuse-role':
        sections['♻️ Återanvänds']!.push(`@${s.role.name}`);
        break;
      case 'reuse-category':
        sections['♻️ Återanvänds']!.push(`📁 ${s.name}`);
        break;
      case 'reuse-channel':
        sections['♻️ Återanvänds']!.push(`${kindIcon(s.channel.kind)}${s.currentName}`);
        break;
      case 'role-picker':
        sections['🧭 Onboarding']!.push('Rollväljare (klass, roll, intresse) i #välkommen skapas eller uppdateras');
        break;
      case 'onboarding':
        sections['🧭 Onboarding']!.push(
          guild.features.includes(GuildFeature.Community)
            ? 'Discords inbyggda onboarding slås på med samma rollval'
            : 'Servern har inte Community påslaget: Discords onboarding hoppas över (rollväljaren räcker)',
        );
        break;
    }
  }
  const embeds: EmbedBuilder[] = [];
  let current = new EmbedBuilder().setColor(0x5865f2);
  let fields = 0;
  for (const [title, lines] of Object.entries(sections)) {
    if (!lines.length) continue;
    const chunks: string[] = [];
    let buf = '';
    for (const line of lines) {
      const next = buf ? `${buf}\n${line}` : line;
      if (next.length > 1000) {
        chunks.push(buf);
        buf = line;
      } else buf = next;
    }
    if (buf) chunks.push(buf);
    for (const [i, chunk] of chunks.entries()) {
      if (fields >= 20) {
        embeds.push(current);
        current = new EmbedBuilder().setColor(0x5865f2);
        fields = 0;
      }
      current.addFields({ name: i === 0 ? `${title} (${lines.length})` : `${title} (forts.)`, value: chunk });
      fields += 1;
    }
  }
  if (plan.warnings.length) current.addFields({ name: '⚠️ Varningar', value: plan.warnings.join('\n').slice(0, 1000) });
  embeds.push(current);
  return embeds.slice(0, 10);
}

// ── Execution ────────────────────────────────────────────────────────────────

type Recorder = (action: string, kind: string, id: string, key: string | null, before: unknown, after: unknown) => Promise<void>;

function readOnlyOverwrite(deny: boolean): PermissionOverwriteOptions {
  return Object.fromEntries(READ_ONLY_FLAGS.map((f) => [f, deny ? false : null])) as PermissionOverwriteOptions;
}

function overwriteState(channel: GuildBasedChannel, id: string): Record<ReadOnlyFlag, boolean | null> {
  const ow = 'permissionOverwrites' in channel ? channel.permissionOverwrites.cache.get(id) : undefined;
  return Object.fromEntries(
    READ_ONLY_FLAGS.map((f) => {
      const bit = PermissionFlagsBits[f];
      return [f, ow?.allow.has(bit) ? true : ow?.deny.has(bit) ? false : null];
    }),
  ) as Record<ReadOnlyFlag, boolean | null>;
}

async function makeReadOnly(channel: GuildBasedChannel, guild: Guild, record: Recorder, key: string | null): Promise<void> {
  if (!('permissionOverwrites' in channel)) return;
  const before = overwriteState(channel, guild.id);
  await channel.permissionOverwrites.edit(guild.id, readOnlyOverwrite(true), { reason: 'Clanker /setup: skrivskydd' });
  await record('permissions', 'channel', channel.id, key, { everyone: before }, { everyone: readOnlyOverwrite(true) });
}

export type ExecutionResult = { done: number; failures: string[]; notes: string[] };

export async function executePlan(opts: {
  guild: Guild;
  db: Queryable;
  plan: Plan;
  blueprint: Blueprint;
  runId: string;
}): Promise<ExecutionResult> {
  const { guild, db, plan, blueprint, runId } = opts;
  const me = guild.members.me!;
  let seq = 0;
  const record: Recorder = async (action, kind, id, key, before, after) => {
    seq += 1;
    await db.query(
      `INSERT INTO bot.setup_changes (run_id, seq, action, target_kind, target_id, blueprint_key, before, after)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb)`,
      [runId, seq, action, kind, id, key, before === undefined ? null : JSON.stringify(before), after === undefined ? null : JSON.stringify(after)],
    );
  };
  const categoryIds = new Map<string, string>();
  const roleIds = new Map<string, string>();
  const channelIds = new Map<string, string>();
  const resolveParent = (ref: CategoryRef) => ('id' in ref ? ref.id : categoryIds.get(ref.key));
  const reason = 'Clanker /setup wow';
  const result: ExecutionResult = { done: 0, failures: [], notes: [] };

  const run = async (label: string, fn: () => Promise<void>) => {
    try {
      await fn();
      result.done += 1;
    } catch (err) {
      log.warn({ err, step: label, guildId: guild.id }, 'setup step failed');
      result.failures.push(`${label}: ${(err as Error).message}`);
    }
  };

  for (const step of plan.steps) {
    switch (step.op) {
      case 'create-role':
        await run(`skapa @${step.role.name}`, async () => {
          const role = await guild.roles.create({
            name: step.role.name,
            colors: step.role.color !== undefined ? { primaryColor: step.role.color } : undefined,
            mentionable: step.role.mentionable ?? false,
            permissions: [],
            reason,
          });
          roleIds.set(step.role.key, role.id);
          await bind(db, guild.id, step.role.key, 'role', role.id);
          await record('create', 'role', role.id, step.role.key, null, { name: role.name });
        });
        break;
      case 'reuse-role':
        roleIds.set(step.role.key, step.id);
        await bind(db, guild.id, step.role.key, 'role', step.id);
        break;
      case 'edit-role':
        await run(`justera @${step.role.name}`, async () => {
          const role = await guild.roles.fetch(step.id);
          if (!role) throw new Error('rollen finns inte längre');
          const before = { color: role.color, mentionable: role.mentionable };
          await role.edit({
            ...(step.changes.color !== undefined ? { colors: { primaryColor: step.changes.color } } : {}),
            ...(step.changes.mentionable !== undefined ? { mentionable: step.changes.mentionable } : {}),
            reason,
          });
          await record('edit', 'role', role.id, step.role.key, before, step.changes);
        });
        break;
      case 'create-category':
        await run(`skapa 📁 ${step.name}`, async () => {
          const cat = await guild.channels.create({ name: step.name, type: ChannelType.GuildCategory, reason });
          categoryIds.set(step.key, cat.id);
          await bind(db, guild.id, step.key, 'category', cat.id);
          await record('create', 'category', cat.id, step.key, null, { name: step.name });
        });
        break;
      case 'reuse-category':
        categoryIds.set(step.key, step.id);
        await bind(db, guild.id, step.key, 'category', step.id);
        break;
      case 'create-channel':
        await run(`skapa ${step.channel.name}`, async () => {
          const parent = resolveParent(step.parent);
          const type =
            step.channel.kind === 'voice' ? ChannelType.GuildVoice : step.channel.kind === 'forum' ? ChannelType.GuildForum : ChannelType.GuildText;
          const base: GuildChannelCreateOptions = {
            name: step.channel.name,
            type,
            parent: parent ?? null,
            reason,
            ...(step.channel.kind !== 'voice' && step.channel.topic ? { topic: step.channel.topic } : {}),
            ...(step.channel.readOnly
              ? {
                  permissionOverwrites: [
                    { id: guild.id, deny: READ_ONLY_DENY },
                    // Keep the bot able to see and post (Discord hides channels the bot cannot view from 2026-11-16).
                    { id: me.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks] },
                  ],
                }
              : {}),
          };
          let created: GuildBasedChannel;
          if (step.channel.kind === 'forum') {
            try {
              created = await guild.channels.create({
                ...base,
                type: ChannelType.GuildForum,
                availableTags: (step.channel.forumTags ?? []).map((name) => ({ name })),
              });
            } catch (err) {
              log.warn({ err }, 'forum channel creation failed; falling back to a text channel');
              result.notes.push(`#${step.channel.name} blev en textkanal (forumkanal gick inte att skapa: ${(err as Error).message}).`);
              created = await guild.channels.create({ ...base, type: ChannelType.GuildText });
            }
          } else {
            created = await guild.channels.create(base);
          }
          channelIds.set(step.channel.key, created.id);
          await bind(db, guild.id, step.channel.key, step.channel.kind, created.id);
          await record('create', 'channel', created.id, step.channel.key, null, { name: created.name, type: created.type });
        });
        break;
      case 'reuse-channel':
        channelIds.set(step.channel.key, step.id);
        await bind(db, guild.id, step.channel.key, step.channel.kind, step.id);
        break;
      case 'move-channel':
      case 'archive-channel':
        await run(`${step.op === 'move-channel' ? 'flytta' : 'arkivera'} ${step.op === 'move-channel' ? step.currentName : step.name}`, async () => {
          const ch = await guild.channels.fetch(step.id);
          const parent = resolveParent(step.parent);
          if (!ch || !parent || ch.isThread()) throw new Error('kanal eller kategori saknas');
          await ch.setParent(parent, { lockPermissions: false, reason });
          await record('move', 'channel', ch.id, step.op === 'move-channel' ? step.channel.key : null, { parentId: step.fromParentId }, { parentId: parent });
          if (step.op === 'archive-channel') await makeReadOnly(ch, guild, record, null);
        });
        break;
      case 'set-readonly':
        await run(`skrivskydda ${step.currentName}`, async () => {
          const ch = await guild.channels.fetch(step.id);
          if (!ch) throw new Error('kanalen finns inte längre');
          await makeReadOnly(ch, guild, record, step.channel.key);
        });
        break;
      case 'add-forum-tags':
        await run(`forumtaggar #${step.channel.name}`, async () => {
          const ch = await guild.channels.fetch(step.id);
          if (!ch || ch.type !== ChannelType.GuildForum) throw new Error('inte en forumkanal');
          const forum = ch as ForumChannel;
          const before = forum.availableTags.map((t) => ({ id: t.id, name: t.name, moderated: t.moderated, emoji: t.emoji }));
          await forum.setAvailableTags([...forum.availableTags, ...step.tags.map((name) => ({ name }))].slice(0, 20), reason);
          await record('forum-tags', 'channel', forum.id, step.channel.key, { tags: before }, { added: step.tags });
        });
        break;
      case 'role-picker':
        await run('rollväljare i #välkommen', async () => {
          const channelId = channelIds.get('ch.valkommen');
          const ch = channelId ? await guild.channels.fetch(channelId) : null;
          if (!isPostable(ch)) throw new Error('#välkommen saknas');
          const payload = rolePickerMessage(guild, blueprint.roles, roleIds);
          const bindings = await loadBindings(db, guild.id);
          const existingId = bindings[ROLE_PICKER_BINDING];
          const existing = existingId ? await ch.messages.fetch(existingId).catch(() => null) : null;
          if (existing) {
            await existing.edit(payload);
          } else {
            const msg = await ch.send(payload);
            await bind(db, guild.id, ROLE_PICKER_BINDING, 'message', msg.id);
            await record('create', 'message', msg.id, ROLE_PICKER_BINDING, null, { channelId: ch.id });
          }
        });
        break;
      case 'onboarding':
        if (!guild.features.includes(GuildFeature.Community)) {
          result.notes.push('Discords onboarding kräver Community-läge. Rollväljaren i #välkommen gör samma jobb.');
          break;
        }
        await run('onboarding', async () => {
          const before = await guild.fetchOnboarding();
          const prompts = onboardingPrompts(blueprint.roles, roleIds);
          const defaults = blueprint.channels.filter((c) => c.onboardingDefault).map((c) => channelIds.get(c.key)).filter((x): x is string => Boolean(x));
          await guild.editOnboarding({ prompts, defaultChannels: defaults, enabled: true, mode: GuildOnboardingMode.OnboardingDefault, reason });
          await record('onboarding', 'guild', guild.id, null, serialiseOnboarding(before), { enabled: true });
        });
        break;
    }
  }
  return result;
}

// ── Role picker and onboarding content ──────────────────────────────────────

const GROUPS: { group: RoleGroup; placeholder: string; title: string }[] = [
  { group: 'class', placeholder: 'Vilken klass spelar du? (flera går bra)', title: 'Vilken klass spelar du?' },
  { group: 'role', placeholder: 'Vilka roller kan du spela?', title: 'Vilka roller kan du spela?' },
  { group: 'interest', placeholder: 'Vad vill du göra?', title: 'Vad är du här för?' },
];

export function rolePickerMessage(guild: Guild, roles: BlueprintRole[], roleIds: Map<string, string>) {
  const rows = GROUPS.map(({ group, placeholder }) => {
    const options = roles
      .filter((r) => r.group === group && roleIds.has(r.key))
      .map((r) => ({ label: r.name, value: r.key, description: r.description, emoji: r.emoji }));
    return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(customId('roles', 'pick', group))
        .setPlaceholder(placeholder)
        .setMinValues(0)
        .setMaxValues(Math.max(1, options.length))
        .addOptions(options),
    );
  }).filter((row) => row.components[0]!.options.length > 0);
  const embed = new EmbedBuilder()
    .setTitle(`👋 Välkommen till ${guild.name}!`)
    .setDescription(
      'Välj klass, roll och vad du vill göra här under, så får du rätt roller och pingas när en grupp saknar just dig.\n' +
        'Du kan ändra dig när som helst: välj igen så uppdateras rollerna.',
    )
    .setColor(0x57f287);
  return { embeds: [embed], components: rows };
}

function onboardingPrompts(roles: BlueprintRole[], roleIds: Map<string, string>): GuildOnboardingPromptData[] {
  return GROUPS.map(({ group, title }) => ({
    title,
    singleSelect: false,
    required: false,
    inOnboarding: true,
    options: roles
      .filter((r) => r.group === group && roleIds.has(r.key))
      .map((r) => ({ title: r.name, description: r.description ?? null, roles: [roleIds.get(r.key)!], ...(r.emoji ? { emoji: r.emoji } : {}) })),
  })).filter((p) => p.options.length > 0);
}

function serialiseOnboarding(o: Awaited<ReturnType<Guild['fetchOnboarding']>>) {
  return {
    enabled: o.enabled,
    mode: o.mode,
    defaultChannels: [...o.defaultChannels.keys()],
    prompts: [...o.prompts.values()].map((p) => ({
      title: p.title,
      singleSelect: p.singleSelect,
      required: p.required,
      inOnboarding: p.inOnboarding,
      type: p.type,
      options: [...p.options.values()].map((opt) => ({
        title: opt.title,
        description: opt.description,
        roles: [...opt.roles.keys()],
        channels: [...opt.channels.keys()],
        ...(opt.emoji?.id ? { emoji: opt.emoji.id } : opt.emoji?.name ? { emoji: opt.emoji.name } : {}),
      })),
    })),
  };
}

// ── Undo ─────────────────────────────────────────────────────────────────────

type ChangeRow = { seq: number; action: string; target_kind: string; target_id: string; blueprint_key: string | null; before: any; after: any }; // eslint-disable-line @typescript-eslint/no-explicit-any

export type UndoResult = { reverted: number; kept: string[]; failures: string[] };

async function channelHasHumanContent(ch: GuildBasedChannel): Promise<boolean> {
  if (ch.type === ChannelType.GuildCategory) return (ch as CategoryChannel).children.cache.size > 0;
  if (ch.type === ChannelType.GuildVoice || ch.type === ChannelType.GuildStageVoice) return ch.members.size > 0;
  if (ch.type === ChannelType.GuildForum) {
    const active = await (ch as ForumChannel).threads.fetchActive();
    return active.threads.size > 0;
  }
  if (ch.isTextBased() && 'messages' in ch) {
    const msgs = await ch.messages.fetch({ limit: 50 });
    return msgs.some((m) => !m.author.bot);
  }
  return false;
}

export async function undoRun(opts: { guild: Guild; db: Queryable; runId: string }): Promise<UndoResult> {
  const { guild, db, runId } = opts;
  const res = await db.query<ChangeRow>(
    'SELECT seq, action, target_kind, target_id, blueprint_key, before, after FROM bot.setup_changes WHERE run_id = $1 ORDER BY seq DESC',
    [runId],
  );
  const out: UndoResult = { reverted: 0, kept: [], failures: [] };
  const reason = 'Clanker: ångra /setup';
  for (const ch of res.rows) {
    try {
      if (ch.action === 'create' && (ch.target_kind === 'channel' || ch.target_kind === 'category')) {
        const channel = await guild.channels.fetch(ch.target_id).catch(() => null);
        if (!channel) continue;
        if (await channelHasHumanContent(channel)) {
          out.kept.push(`${channel.name} (har innehåll, raderas inte)`);
          continue;
        }
        await channel.delete(reason);
      } else if (ch.action === 'create' && ch.target_kind === 'role') {
        const role = await guild.roles.fetch(ch.target_id).catch(() => null);
        if (!role) continue;
        if (role.members.size > 0) {
          out.kept.push(`@${role.name} (${role.members.size} medlemmar har den)`);
          continue;
        }
        await role.delete(reason);
      } else if (ch.action === 'create' && ch.target_kind === 'message') {
        const channel = await guild.channels.fetch(ch.after?.channelId).catch(() => null);
        if (channel?.isTextBased() && 'messages' in channel) await channel.messages.delete(ch.target_id).catch(() => undefined);
      } else if (ch.action === 'edit' && ch.target_kind === 'role') {
        const role = await guild.roles.fetch(ch.target_id).catch(() => null);
        if (role) await role.edit({ colors: { primaryColor: ch.before.color }, mentionable: ch.before.mentionable, reason });
      } else if (ch.action === 'move') {
        const channel = await guild.channels.fetch(ch.target_id).catch(() => null);
        if (channel && !channel.isThread()) {
          const parent = ch.before.parentId && guild.channels.cache.has(ch.before.parentId) ? ch.before.parentId : null;
          await channel.setParent(parent, { lockPermissions: false, reason });
        }
      } else if (ch.action === 'permissions') {
        const channel = await guild.channels.fetch(ch.target_id).catch(() => null);
        if (channel && 'permissionOverwrites' in channel) {
          await channel.permissionOverwrites.edit(guild.id, ch.before.everyone as PermissionOverwriteOptions, { reason });
        }
      } else if (ch.action === 'forum-tags') {
        const channel = await guild.channels.fetch(ch.target_id).catch(() => null);
        if (channel?.type === ChannelType.GuildForum) await (channel as ForumChannel).setAvailableTags(ch.before.tags, reason);
      } else if (ch.action === 'onboarding') {
        await guild.editOnboarding({ ...ch.before, reason });
      }
      out.reverted += 1;
    } catch (err) {
      log.warn({ err, change: ch.seq, runId }, 'undo step failed');
      out.failures.push(`${ch.action} ${ch.target_kind} ${ch.target_id}: ${(err as Error).message}`);
    }
  }
  await db.query(`UPDATE bot.setup_runs SET status = 'undone', undone_at = now() WHERE id = $1`, [runId]);
  // Drop bindings that point at things that no longer exist.
  const bindings = await loadBindings(db, guild.id);
  for (const [key, id] of Object.entries(bindings)) {
    const exists = guild.channels.cache.has(id) || guild.roles.cache.has(id) || key === ROLE_PICKER_BINDING;
    if (!exists) await db.query('DELETE FROM bot.setup_bindings WHERE guild_id = $1 AND blueprint_key = $2', [guild.id, key]);
  }
  bindingsCache.delete(guild.id);
  return out;
}

export function missingBotPermissions(guild: Guild): string[] {
  const me = guild.members.me;
  if (!me) return SETUP_BOT_PERMISSIONS.map(([n]) => n);
  return SETUP_BOT_PERMISSIONS.filter(([, bit]) => !me.permissions.has(bit)).map(([n]) => n);
}

export type { PlanStep };
