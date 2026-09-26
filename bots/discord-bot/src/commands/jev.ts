/**
 * /jev av | på | status | reflexer — per-user opt-out and per-channel emoji reflexes.
 * /jevstats — calls, tokens, estimated cost, latency, errors, breaker state and model.
 */
import {
  ChannelType,
  EmbedBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';
import type { SlashCommand } from '../core/commands.js';
import { getConfig } from '../core/config.js';
import { features } from '../core/features.js';
import { UserFacingError } from '../core/interaction-errors.js';
import { db } from '../db.js';
import { jev } from '../jev/client.js';
import { jevOptOut, queryJevStats, type JevStatsRow } from '../jev/store.js';
import { EPHEMERAL, requireGuildId } from './_shared.js';

export const jevCommand: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('jev')
    .setDescription('Styr hur Jev (Clankers AI-lager) får använda dina meddelanden.')
    .addSubcommand((s) => s.setName('av').setDescription('Skicka aldrig mina meddelanden till Jev.'))
    .addSubcommand((s) => s.setName('på').setDescription('Jev får läsa mina meddelanden igen.'))
    .addSubcommand((s) => s.setName('status').setDescription('Visa om Jev läser dina meddelanden.'))
    .addSubcommand((s) =>
      s
        .setName('reflexer')
        .setDescription('Emoji-reflexer i den här kanalen (kräver Hantera kanaler).')
        .addStringOption((o) =>
          o.setName('läge').setDescription('på eller av').setRequired(true).addChoices({ name: 'på', value: 'på' }, { name: 'av', value: 'av' }),
        ),
    ),
  async execute(interaction) {
    const sub = interaction.options.getSubcommand(true);
    const optOut = jevOptOut();
    if (sub === 'av') {
      await optOut.optOut(interaction.user.id);
      await interaction.reply({
        content: '🙈 Klart. Dina meddelanden skickas aldrig till Jev: inga reflexer, inte med i /vibe eller LFG-tolkning. Ångra med `/jev på`.',
        flags: EPHEMERAL,
      });
      return;
    }
    if (sub === 'på') {
      await optOut.optIn(interaction.user.id);
      await interaction.reply({ content: '👋 Välkommen tillbaka! Jev får läsa dina meddelanden igen.', flags: EPHEMERAL });
      return;
    }
    if (sub === 'status') {
      const out = optOut.isOptedOut(interaction.user.id);
      const client = jev();
      await interaction.reply({
        content: [
          out ? '🙈 Du har valt bort Jev. Dina meddelanden skickas aldrig dit.' : '👀 Jev får läsa dina meddelanden (reflexer, /vibe, LFG).',
          client.enabled ? `-# Jev är igång (${client.model}).` : '-# Jev är avstängt i den här installationen.',
          '-# Jev används aldrig ensam för moderering, och bara korta utdrag skickas (utan användarnamn i /vibe).',
        ].join('\n'),
        flags: EPHEMERAL,
      });
      return;
    }
    if (sub === 'reflexer') {
      const guildId = requireGuildId(interaction);
      if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageChannels)) {
        throw new UserFacingError('🔒 Det här kräver behörigheten **Hantera kanaler**.');
      }
      if (interaction.channel?.type !== ChannelType.GuildText) {
        throw new UserFacingError('Reflexer går bara att slå på i vanliga textkanaler.');
      }
      const on = interaction.options.getString('läge', true) === 'på';
      await features().setChannelEnabled(guildId, interaction.channelId, 'jev_reflexer', on, interaction.user.id);
      const guildOn = await features().isEnabled(guildId, 'jev_reflexer');
      await interaction.reply({
        content: on
          ? `✨ Emoji-reflexer är på i <#${interaction.channelId}>.${guildOn ? '' : '\n⚠️ Men funktionen **Jev-reflexer** är avstängd för servern. Slå på den med `/admin funktioner`.'}`
          : `🔕 Emoji-reflexer är av i <#${interaction.channelId}>.`,
        flags: EPHEMERAL,
      });
    }
  },
};

function fmtUsd(v: number): string {
  return v < 0.01 ? `$${v.toFixed(4)}` : `$${v.toFixed(2)}`;
}

function statsField(label: string, s: JevStatsRow, usdPerMtok: number) {
  const cost = (s.input_tokens * usdPerMtok) / 1_000_000;
  return {
    name: label,
    value: [
      `Anrop: **${s.calls}** (✅ ${s.ok} · ❌ ${s.errors} · 🧊 ${s.breaker_rejections})`,
      `Tokens: ${s.input_tokens.toLocaleString('sv-SE')} in / ${s.output_tokens.toLocaleString('sv-SE')} ut`,
      `Kostnad (uppsk.): **${fmtUsd(cost)}**`,
      `Latens p50/p95: ${s.p50_ms ?? '–'} / ${s.p95_ms ?? '–'} ms`,
    ].join('\n'),
    inline: true,
  };
}

const BREAKER_LABEL = { closed: '🟢 stängd (allt ok)', 'half-open': '🟡 halvöppen (testar)', open: '🔴 öppen (pausar anrop)' } as const;

export const jevstats: SlashCommand = {
  data: new SlashCommandBuilder().setName('jevstats').setDescription('Statistik för Jev: anrop, tokens, kostnad, latens och status.'),
  async execute(interaction) {
    const client = jev();
    const cfg = getConfig().jev;
    await interaction.deferReply({ flags: EPHEMERAL });
    const [day, all] = await Promise.all([
      queryJevStats(db, new Date(Date.now() - 24 * 3600_000)),
      queryJevStats(db, null),
    ]);
    const mem = client.memoryStats();
    const embed = new EmbedBuilder()
      .setTitle('🧮 Jev-statistik')
      .setDescription(
        [
          `Status: ${client.enabled ? BREAKER_LABEL[client.breakerState] : '⚪ avstängt (ingen API-nyckel)'}`,
          `Modell: \`${client.model}\`${all.last_model && all.last_model !== client.model ? ` (senast svarade \`${all.last_model}\`)` : ''}`,
          `Just nu: ${mem.inFlight} pågående, ${mem.queued} i kö`,
        ].join('\n'),
      )
      .addFields(statsField('Senaste 24 h', day, cfg.usdPerMillionInputTokens), statsField('Totalt', all, cfg.usdPerMillionInputTokens))
      .setFooter({ text: `Pris: $${cfg.usdPerMillionInputTokens} per miljon input-tokens (output är gratis)` })
      .setColor(0x3498db);
    await interaction.editReply({ embeds: [embed] });
  },
};
