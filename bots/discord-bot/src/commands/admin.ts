/**
 * /admin: server-admin tools (requires Manage Guild).
 *   funktioner [funktion] [läge]  show feature flags, or set one; the embed has a toggle menu
 * More subcommands are added by later modules (e.g. veckorapport-nu).
 */
import {
  ActionRowBuilder,
  EmbedBuilder,
  InteractionContextType,
  PermissionFlagsBits,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  type ChatInputCommandInteraction,
  type SlashCommandSubcommandBuilder,
} from 'discord.js';
import type { SlashCommand } from '../core/commands.js';
import { customId, type ComponentHandler } from '../core/components.js';
import { FEATURES, features, isFeatureKey, type FeatureKey } from '../core/features.js';
import { UserFacingError } from '../core/interaction-errors.js';
import { EPHEMERAL, requireGuildId, requireManageGuild } from './_shared.js';

type AdminSubcommand = {
  build: (sub: SlashCommandSubcommandBuilder) => SlashCommandSubcommandBuilder;
  execute: (interaction: ChatInputCommandInteraction) => Promise<void>;
};

/** Other modules register extra /admin subcommands here before the command is built. */
const extraSubcommands = new Map<string, AdminSubcommand>();

export function registerAdminSubcommand(name: string, sub: AdminSubcommand): void {
  if (name === 'funktioner' || extraSubcommands.has(name)) throw new Error(`Duplicate /admin subcommand ${name}`);
  extraSubcommands.set(name, sub);
}

async function featureOverview(guildId: string) {
  const list = await features().listForGuild(guildId);
  const lines = list.map(({ def, enabled, overridden }) => {
    const icon = enabled ? '✅' : '⛔';
    const note = overridden ? '' : ' *(standard)*';
    return `${icon} **${def.label}**${note}\n-# ${def.description}`;
  });
  const embed = new EmbedBuilder()
    .setTitle('🎛️ Funktioner i den här servern')
    .setDescription(lines.join('\n'))
    .setFooter({ text: 'Välj i menyn för att slå av/på. Ändringar gäller direkt.' })
    .setColor(0x5865f2);
  const menu = new StringSelectMenuBuilder()
    .setCustomId(customId('admin', 'toggle'))
    .setPlaceholder('Slå av/på en funktion…')
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(
      list.map(({ key, def, enabled }) => ({
        label: `${enabled ? 'Stäng av' : 'Slå på'}: ${def.label}`.slice(0, 100),
        value: key,
        description: def.description.slice(0, 100),
        emoji: enabled ? '⛔' : '✅',
      })),
    );
  return { embeds: [embed], components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu)] };
}

async function executeFunktioner(interaction: ChatInputCommandInteraction): Promise<void> {
  const guildId = requireGuildId(interaction);
  const feature = interaction.options.getString('funktion');
  const mode = interaction.options.getString('läge');
  if (feature && mode) {
    if (!isFeatureKey(feature)) throw new UserFacingError('Okänd funktion.');
    await features().setEnabled(guildId, feature, mode === 'på', interaction.user.id);
    await interaction.reply({
      content: `${mode === 'på' ? '✅' : '⛔'} **${FEATURES[feature].label}** är nu ${mode === 'på' ? 'påslaget' : 'avstängt'}.`,
      flags: EPHEMERAL,
    });
    return;
  }
  await interaction.reply({ ...(await featureOverview(guildId)), flags: EPHEMERAL });
}

function buildData() {
  const builder = new SlashCommandBuilder()
    .setName('admin')
    .setDescription('Adminverktyg för servern.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setContexts(InteractionContextType.Guild)
    .addSubcommand((sub) =>
      sub
        .setName('funktioner')
        .setDescription('Visa och växla funktioner (feature-flaggor) för servern.')
        .addStringOption((o) =>
          o
            .setName('funktion')
            .setDescription('Funktion att ändra (utelämna för översikt)')
            .addChoices(...(Object.keys(FEATURES) as FeatureKey[]).map((k) => ({ name: FEATURES[k].label, value: k }))),
        )
        .addStringOption((o) =>
          o.setName('läge').setDescription('På eller av').addChoices({ name: 'på', value: 'på' }, { name: 'av', value: 'av' }),
        ),
    );
  for (const [name, sub] of extraSubcommands) {
    builder.addSubcommand((s) => sub.build(s.setName(name)));
  }
  return builder;
}

export function createAdminCommand(): SlashCommand {
  return {
    data: buildData(),
    async execute(interaction) {
      requireManageGuild(interaction);
      const sub = interaction.options.getSubcommand(true);
      if (sub === 'funktioner') return executeFunktioner(interaction);
      const extra = extraSubcommands.get(sub);
      if (!extra) throw new UserFacingError('Okänt underkommando.');
      await extra.execute(interaction);
    },
  };
}

export const adminComponents: ComponentHandler = {
  prefix: 'admin',
  async handle(interaction, parsed) {
    requireManageGuild(interaction);
    const guildId = requireGuildId(interaction);
    if (parsed.action !== 'toggle' || !interaction.isStringSelectMenu()) {
      throw new UserFacingError('Okänd adminåtgärd.');
    }
    const key = interaction.values[0];
    if (!key || !isFeatureKey(key)) throw new UserFacingError('Okänd funktion.');
    const current = await features().isEnabled(guildId, key);
    await features().setEnabled(guildId, key, !current, interaction.user.id);
    await interaction.update(await featureOverview(guildId));
  },
};
