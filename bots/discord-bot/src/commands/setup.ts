/**
 * /setup wow [torrkörning] [arkivera_övrigt]  build the WoW server from the blueprint (idempotent)
 * /setup ångra                                 undo the latest setup run in this server
 *
 * Destructive changes only run in guilds listed in SETUP_ALLOWED_GUILD_IDS, and require Manage Guild.
 * Channels that are not in the blueprint are never deleted: they move to 📦 Arkiv, read-only.
 */
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  InteractionContextType,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type Guild,
} from 'discord.js';
import type { SlashCommand } from '../core/commands.js';
import { customId, type ComponentHandler } from '../core/components.js';
import { getConfig } from '../core/config.js';
import { UserFacingError } from '../core/interaction-errors.js';
import { childLogger } from '../core/logger.js';
import { db } from '../db.js';
import { musicChannelId, refreshMusicPanel } from '../music-panel.js';
import { wowBlueprint, type RoleGroup } from '../setup/blueprint.js';
import { executePlan, loadBindings, missingBotPermissions, renderPlan, snapshotGuild, undoRun } from '../setup/executor.js';
import { isMutating, planSetup } from '../setup/planner.js';
import { EPHEMERAL, plural, requireGuildId, requireManageGuild } from './_shared.js';

const log = childLogger('setup');
const running = new Set<string>();

function assertAllowed(guildId: string): void {
  if (!getConfig().setupAllowedGuildIds.includes(guildId)) {
    throw new UserFacingError(
      '🚧 /setup får bara köras i servrar som står i `SETUP_ALLOWED_GUILD_IDS`. Den här servern är inte med där, så jag rör ingenting.',
    );
  }
}

function assertBotPermissions(guild: Guild): void {
  const missing = missingBotPermissions(guild);
  if (missing.length) throw new UserFacingError(`🔧 Jag saknar behörigheter: ${missing.join(', ')}. Ge Clankers roll dem och kör igen.`);
}

function undoButton(runId: string) {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(customId('setup', 'undo', runId)).setLabel('Ångra senaste setup').setEmoji('↩️').setStyle(ButtonStyle.Danger),
  );
}

async function runWowSetup(interaction: ChatInputCommandInteraction): Promise<void> {
  const guild = interaction.guild!;
  const dryRun = interaction.options.getBoolean('torrkörning') ?? false;
  const archiveOthers = interaction.options.getBoolean('arkivera_övrigt') ?? true;
  const flavor = getConfig().wow.flavor;
  const blueprint = wowBlueprint(flavor);

  await interaction.deferReply({ flags: EPHEMERAL });
  const snapshot = await snapshotGuild(guild, db);
  const plan = planSetup(blueprint, snapshot, { archiveOthers });
  const changes = plan.steps.filter(isMutating).length;

  if (dryRun) {
    const embeds = renderPlan(plan, guild, blueprint);
    embeds[0]!.setTitle(`🧪 Torrkörning: /setup wow (${flavor})`).setDescription(
      `Så här skulle servern ändras. **Inget har gjorts än.** ${plural(changes, 'ändring planerad', 'ändringar planerade')}.\nKör \`/setup wow\` utan torrkörning för att genomföra.`,
    );
    await interaction.editReply({ embeds });
    return;
  }

  if (running.has(guild.id)) throw new UserFacingError('⏳ En setup kör redan i den här servern. Vänta tills den är klar.');
  running.add(guild.id);
  try {
    const runRes = await db.query<{ id: string }>(
      `INSERT INTO bot.setup_runs (guild_id, blueprint, flavor, user_id) VALUES ($1, 'wow', $2, $3) RETURNING id::text AS id`,
      [guild.id, flavor, interaction.user.id],
    );
    const runId = runRes.rows[0]!.id;
    await interaction.editReply(`🏗️ Bygger servern (${plural(changes, 'ändring', 'ändringar')})… det här kan ta en halv minut.`);
    const result = await executePlan({ guild, db, plan, blueprint, runId });
    // Put the music panel in #musik right away, so the channel explains itself before anyone plays anything.
    await refreshMusicPanel(interaction.client, guild.id).catch((err) => log.warn({ err, guildId: guild.id }, 'music panel after setup failed'));
    const musicChannel = await musicChannelId(guild).catch(() => null);
    if (musicChannel) result.notes.push(`Musikpanelen finns i <#${musicChannel}>: kör /play där eller var som helst.`);
    await db.query(`UPDATE bot.setup_runs SET status = $2, summary = $3::jsonb WHERE id = $1`, [
      runId,
      result.failures.length ? 'failed' : 'done',
      JSON.stringify(result),
    ]);
    log.info({ guildId: guild.id, runId, done: result.done, failures: result.failures.length }, 'setup run finished');

    const embeds = renderPlan(plan, guild, blueprint);
    embeds[0]!
      .setTitle(result.failures.length ? '⚠️ Setup klar, med fel' : '✅ Setup klar!')
      .setDescription(
        [
          `${result.done} steg genomförda. Knappen nedan ångrar allt den här körningen gjorde (kanaler med innehåll och roller med medlemmar lämnas kvar).`,
          ...result.notes.map((n) => `ℹ️ ${n}`),
          ...result.failures.slice(0, 10).map((f) => `❌ ${f}`),
        ]
          .join('\n')
          .slice(0, 4000),
      );
    await interaction.editReply({ content: '', embeds, components: [undoButton(runId)] });
  } finally {
    running.delete(guild.id);
  }
}

async function undoLatest(guild: Guild, runId?: string) {
  const res = await db.query<{ id: string }>(
    runId
      ? `SELECT id::text AS id FROM bot.setup_runs WHERE id = $2 AND guild_id = $1 AND status <> 'undone'`
      : `SELECT id::text AS id FROM bot.setup_runs WHERE guild_id = $1 AND status IN ('done', 'failed') ORDER BY created_at DESC LIMIT 1`,
    runId ? [guild.id, runId] : [guild.id],
  );
  const run = res.rows[0];
  if (!run) throw new UserFacingError('🤷 Det finns ingen setup att ångra här (eller så är den redan ångrad).');
  const latest = await db.query<{ id: string }>(
    `SELECT id::text AS id FROM bot.setup_runs WHERE guild_id = $1 AND status IN ('done', 'failed') ORDER BY created_at DESC LIMIT 1`,
    [guild.id],
  );
  if (latest.rows[0]?.id !== run.id) throw new UserFacingError('Bara den senaste setupen kan ångras.');
  const result = await undoRun({ guild, db, runId: run.id });
  return new EmbedBuilder()
    .setTitle('↩️ Setup ångrad')
    .setDescription(
      [
        `${plural(result.reverted, 'ändring återställd', 'ändringar återställda')}.`,
        ...result.kept.map((k) => `🟡 Kvar: ${k}`),
        ...result.failures.slice(0, 10).map((f) => `❌ ${f}`),
      ]
        .join('\n')
        .slice(0, 4000),
    )
    .setColor(result.failures.length ? 0xfee75c : 0x57f287);
}

export const setup: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('setup')
    .setDescription('Bygg upp servern från en mall (kräver Hantera server).')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setContexts(InteractionContextType.Guild)
    .addSubcommand((s) =>
      s
        .setName('wow')
        .setDescription('Kanaler, roller, rollväljare och onboarding för WoW-gänget.')
        .addBooleanOption((o) => o.setName('torrkörning').setDescription('Visa bara vad som skulle hända (standard: nej)'))
        .addBooleanOption((o) =>
          o.setName('arkivera_övrigt').setDescription('Flytta kanaler som inte finns i mallen till 📦 Arkiv (standard: ja)'),
        ),
    )
    .addSubcommand((s) => s.setName('ångra').setDescription('Ångra senaste setup i den här servern.')),
  async execute(interaction) {
    requireManageGuild(interaction);
    const guildId = requireGuildId(interaction);
    assertAllowed(guildId);
    assertBotPermissions(interaction.guild!);
    const sub = interaction.options.getSubcommand(true);
    if (sub === 'wow') return runWowSetup(interaction);
    await interaction.deferReply({ flags: EPHEMERAL });
    await interaction.editReply({ embeds: [await undoLatest(interaction.guild!)] });
  },
};

export const setupComponents: ComponentHandler = {
  prefix: 'setup',
  async handle(interaction, parsed) {
    if (!interaction.isButton() || parsed.action !== 'undo') return;
    requireManageGuild(interaction);
    const guildId = requireGuildId(interaction);
    assertAllowed(guildId);
    await interaction.deferUpdate();
    const embed = await undoLatest(interaction.guild!, parsed.args[0]);
    await interaction.editReply({ embeds: [embed], components: [], content: '' });
  },
};

/** Role picker in #välkommen: each select menu sets the member's roles for one group. */
export const rolePickerComponents: ComponentHandler = {
  prefix: 'roles',
  async handle(interaction, parsed) {
    if (!interaction.isStringSelectMenu() || parsed.action !== 'pick') return;
    const guild = interaction.guild;
    if (!guild) throw new UserFacingError('Det här fungerar bara i en server.');
    const group = parsed.args[0] as RoleGroup;
    const blueprint = wowBlueprint(getConfig().wow.flavor);
    const bindings = await loadBindings(db, guild.id);
    const groupRoles = blueprint.roles
      .filter((r) => r.group === group)
      .map((r) => ({ key: r.key, id: bindings[r.key] }))
      .filter((r): r is { key: string; id: string } => Boolean(r.id) && guild.roles.cache.has(r.id!));
    const selected = new Set(interaction.values);
    const member = await guild.members.fetch(interaction.user.id);
    const add = groupRoles.filter((r) => selected.has(r.key) && !member.roles.cache.has(r.id)).map((r) => r.id);
    const remove = groupRoles.filter((r) => !selected.has(r.key) && member.roles.cache.has(r.id)).map((r) => r.id);
    if (add.length) await member.roles.add(add, 'Rollväljaren');
    if (remove.length) await member.roles.remove(remove, 'Rollväljaren');
    const names = groupRoles.filter((r) => selected.has(r.key)).map((r) => `<@&${r.id}>`);
    await interaction.reply({
      content: names.length ? `✅ Klart! Du har nu ${names.join(', ')}.` : '✅ Klart! Inga roller i den gruppen längre.',
      flags: EPHEMERAL,
      allowedMentions: { parse: [] },
    });
  },
};
