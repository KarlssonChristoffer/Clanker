/** /playlist: saved playlists per server (bot.playlists / bot.playlist_tracks). */
import { EmbedBuilder, SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import type { SlashCommand } from '../core/commands.js';
import { features } from '../core/features.js';
import {
  addTrackToPlaylist,
  createPlaylist,
  deletePlaylist,
  getPlaylistTracks,
  listPlaylists,
  playPlaylist,
  removeTrackFromPlaylist,
} from '../music-player.js';
import { EPHEMERAL, fmtDuration, requireGuildId, resolveVoiceChannelId } from './_shared.js';

async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const sub = interaction.options.getSubcommand(true);
  const guildId = requireGuildId(interaction);
  await features().require(guildId, 'musik');
  const userId = interaction.user.id;

  if (sub === 'skapa') {
    const name = interaction.options.getString('namn', true);
    const pl = await createPlaylist(guildId, name, userId);
    if (!pl) {
      await interaction.reply({ content: `❌ En spellista med namnet **${name}** finns redan.`, flags: EPHEMERAL });
      return;
    }
    await interaction.reply({ content: `✅ Spellistan **${pl.name}** skapades.`, flags: EPHEMERAL });
    return;
  }

  if (sub === 'radera') {
    const name = interaction.options.getString('namn', true);
    const ok = await deletePlaylist(guildId, name);
    await interaction.reply({ content: ok ? `🗑️ **${name}** raderades.` : `❌ Hittade ingen spellista med det namnet.`, flags: EPHEMERAL });
    return;
  }

  if (sub === 'lista') {
    const lists = await listPlaylists(guildId);
    if (!lists.length) {
      await interaction.reply({ content: '📭 Inga spellistor skapade ännu. Använd `/playlist skapa`.', flags: EPHEMERAL });
      return;
    }
    const embed = new EmbedBuilder()
      .setTitle('🎶 Spellistor')
      .setDescription(lists.map((p) => `**${p.name}** — ${p.trackCount} spår`).join('\n'));
    await interaction.reply({ embeds: [embed], flags: EPHEMERAL });
    return;
  }

  if (sub === 'visa') {
    const name = interaction.options.getString('namn', true);
    const tracks = await getPlaylistTracks(guildId, name);
    if (!tracks) {
      await interaction.reply({ content: `❌ Hittade ingen spellista med namnet **${name}**.`, flags: EPHEMERAL });
      return;
    }
    if (!tracks.length) {
      await interaction.reply({ content: `📭 **${name}** är tom. Lägg till låtar med \`/playlist lagg-till\`.`, flags: EPHEMERAL });
      return;
    }
    const embed = new EmbedBuilder()
      .setTitle(`🎶 ${name}`)
      .setDescription(
        tracks.map((t) => `${t.position}. **${t.title}**${t.artist ? ` — ${t.artist}` : ''}${fmtDuration(t.durationSec)}`).join('\n').slice(0, 4000),
      );
    await interaction.reply({ embeds: [embed], flags: EPHEMERAL });
    return;
  }

  if (sub === 'lagg-till') {
    const name = interaction.options.getString('namn', true);
    const query = interaction.options.getString('lat', true);
    await interaction.deferReply({ flags: EPHEMERAL });
    const result = await addTrackToPlaylist(guildId, name, query, userId);
    if (!result) {
      await interaction.editReply(`❌ Hittade ingen spellista **${name}** eller kunde inte lösa låten.`);
      return;
    }
    const { track, position } = result;
    await interaction.editReply(`✅ **${track.title}**${track.artist ? ` — ${track.artist}` : ''} lades till på plats ${position} i **${name}**.`);
    return;
  }

  if (sub === 'ta-bort') {
    const name = interaction.options.getString('namn', true);
    const position = interaction.options.getInteger('position', true);
    const ok = await removeTrackFromPlaylist(guildId, name, position);
    await interaction.reply({ content: ok ? `✅ Spår ${position} togs bort från **${name}**.` : `❌ Hittade inget spår på position ${position} i **${name}**.`, flags: EPHEMERAL });
    return;
  }

  if (sub === 'spela') {
    const name = interaction.options.getString('namn', true);
    const channelId = resolveVoiceChannelId(interaction);
    await interaction.deferReply({ flags: EPHEMERAL });
    const result = await playPlaylist(interaction.client, guildId, name, userId, channelId);
    if (!result) {
      await interaction.editReply(`❌ Hittade ingen spellista med namnet **${name}**.`);
      return;
    }
    if (result.queued === 0) {
      await interaction.editReply(`📭 **${result.name}** är tom.`);
      return;
    }
    await interaction.editReply(`▶️ **${result.name}** — ${result.queued} spår lades till i kön.`);
  }
}

export const playlist: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('playlist')
    .setDescription('Hantera sparade spellistor.')
    .addSubcommand((sub) =>
      sub.setName('skapa').setDescription('Skapa en ny spellista.')
        .addStringOption((o) => o.setName('namn').setDescription('Spellistas namn').setRequired(true)),
    )
    .addSubcommand((sub) =>
      sub.setName('radera').setDescription('Radera en spellista.')
        .addStringOption((o) => o.setName('namn').setDescription('Spellistas namn').setRequired(true)),
    )
    .addSubcommand((sub) =>
      sub.setName('lista').setDescription('Lista alla spellistor i servern.'),
    )
    .addSubcommand((sub) =>
      sub.setName('visa').setDescription('Visa spår i en spellista.')
        .addStringOption((o) => o.setName('namn').setDescription('Spellistas namn').setRequired(true)),
    )
    .addSubcommand((sub) =>
      sub.setName('lagg-till').setDescription('Lägg till en låt i en spellista.')
        .addStringOption((o) => o.setName('namn').setDescription('Spellistas namn').setRequired(true))
        .addStringOption((o) => o.setName('lat').setDescription('URL eller sökterm').setRequired(true)),
    )
    .addSubcommand((sub) =>
      sub.setName('ta-bort').setDescription('Ta bort ett spår från en spellista.')
        .addStringOption((o) => o.setName('namn').setDescription('Spellistas namn').setRequired(true))
        .addIntegerOption((o) => o.setName('position').setDescription('Spårets position (1-baserat)').setRequired(true).setMinValue(1)),
    )
    .addSubcommand((sub) =>
      sub.setName('spela').setDescription('Ladda och spela en spellista.')
        .addStringOption((o) => o.setName('namn').setDescription('Spellistas namn').setRequired(true)),
    ),
  execute,
};
