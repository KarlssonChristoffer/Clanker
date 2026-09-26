/**
 * Music playback commands: /play, /skip, /previous, /pause, /resume, /stop, /queue.
 * Playback itself lives in music-player.ts; the hub controls the same player over bot HTTP.
 */
import { EmbedBuilder, SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import type { SlashCommand } from '../core/commands.js';
import { features } from '../core/features.js';
import { childLogger } from '../core/logger.js';
import { UserFacingError } from '../core/interaction-errors.js';
import { getPool } from '../db.js';
import { enqueue, pause, previous, resume, skip, stop } from '../music-player.js';
import { musicChannelId, rememberMusicChannel } from '../music-panel.js';
import { EPHEMERAL, plural, requireGuildId, resolveVoiceChannelId } from './_shared.js';

const log = childLogger('music');

/** Remember where music is being asked for (panel fallback) and point to #musik when it's elsewhere. */
export async function panelHint(interaction: ChatInputCommandInteraction): Promise<string> {
  if (!interaction.guild) return '';
  rememberMusicChannel(interaction.guild.id, interaction.channelId);
  const panelChannel = await musicChannelId(interaction.guild).catch(() => null);
  return panelChannel && panelChannel !== interaction.channelId ? `\n-# Kön och knapparna finns i <#${panelChannel}>.` : '';
}

export const play: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('play')
    .setDescription('Spela en låt eller lägg till i kön.')
    .addStringOption((o) =>
      o.setName('query').setDescription('YouTube/Spotify/SoundCloud URL eller sökterm').setRequired(true),
    ),
  async execute(interaction) {
    const guildId = requireGuildId(interaction);
    await features().require(guildId, 'musik');
    const channelId = resolveVoiceChannelId(interaction);
    await interaction.deferReply({ flags: EPHEMERAL });
    const hint = await panelHint(interaction);
    const query = interaction.options.getString('query', true);
    let result;
    try {
      result = await enqueue(interaction.client, guildId, query, interaction.user.id, channelId);
    } catch (err) {
      log.error({ err, guildId, query }, 'enqueue failed');
      throw new UserFacingError(`❌ Kunde inte spela det där: ${(err as Error).message}`);
    }
    if (!result) {
      await interaction.editReply('❌ Hittade varken låt eller spellista. Prova en annan sökning eller en direktlänk.');
      return;
    }
    if (result.kind === 'playlist') {
      await interaction.editReply(`▶️ **${result.title}**: ${plural(result.queued, 'låt', 'låtar')} lades till i kön.${hint}`);
    } else {
      const t = result.track;
      await interaction.editReply(`▶️ **${t.title}**${t.artist ? ` – ${t.artist}` : ''} lades till i kön.${hint}`);
    }
  },
};

export const skipCommand: SlashCommand = {
  data: new SlashCommandBuilder().setName('skip').setDescription('Hoppa till nästa låt i kön.'),
  async execute(interaction) {
    const guildId = requireGuildId(interaction);
    await features().require(guildId, 'musik');
    await skip(guildId);
    await interaction.reply({ content: '⏭ Hoppade till nästa låt.', flags: EPHEMERAL });
  },
};

export const previousCommand: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('previous')
    .setDescription('Spela föregående låt (senast spelade i denna session).'),
  async execute(interaction) {
    const guildId = requireGuildId(interaction);
    await features().require(guildId, 'musik');
    const wentBack = await previous(guildId);
    await interaction.reply({
      content: wentBack ? '⏮️ Spelar föregående låt.' : 'ℹ️ Ingen tidigare låt i den här sessionen.',
      flags: EPHEMERAL,
    });
  },
};

export const pauseCommand: SlashCommand = {
  data: new SlashCommandBuilder().setName('pause').setDescription('Pausa uppspelningen.'),
  async execute(interaction) {
    const guildId = requireGuildId(interaction);
    await features().require(guildId, 'musik');
    await pause(guildId);
    await interaction.reply({ content: '⏸ Pausad.', flags: EPHEMERAL });
  },
};

export const resumeCommand: SlashCommand = {
  data: new SlashCommandBuilder().setName('resume').setDescription('Återuppta uppspelningen.'),
  async execute(interaction) {
    const guildId = requireGuildId(interaction);
    await features().require(guildId, 'musik');
    await resume(guildId);
    await interaction.reply({ content: '▶️ Återupptog uppspelningen.', flags: EPHEMERAL });
  },
};

export const stopCommand: SlashCommand = {
  data: new SlashCommandBuilder().setName('stop').setDescription('Stoppa musiken och töm kön.'),
  async execute(interaction) {
    const guildId = requireGuildId(interaction);
    await features().require(guildId, 'musik');
    await stop(guildId);
    await interaction.reply({ content: '⏹ Stoppad och kön tömd.', flags: EPHEMERAL });
  },
};

export const queue: SlashCommand = {
  data: new SlashCommandBuilder().setName('queue').setDescription('Visa nuvarande kö.'),
  async execute(interaction) {
    const guildId = requireGuildId(interaction);
    await features().require(guildId, 'musik');
    await interaction.deferReply({ flags: EPHEMERAL });
    const pool = getPool();
    const [nowRes, queueRes] = await Promise.all([
      pool.query<{ title: string; artist: string | null; is_paused: boolean }>(
        'SELECT title, artist, is_paused FROM bot.music_now_playing WHERE guild_id = $1',
        [guildId],
      ),
      pool.query<{ title: string; artist: string | null }>(
        'SELECT title, artist FROM bot.music_queue WHERE guild_id = $1 ORDER BY added_at LIMIT 10',
        [guildId],
      ),
    ]);

    const now = nowRes.rows[0];
    if (!now) {
      await interaction.editReply('📭 Tyst som i ett bibliotek. Inget spelas just nu.');
      return;
    }
    const embed = new EmbedBuilder().setTitle('🎵 Musikkön').addFields({
      name: now.is_paused ? '⏸ Pausad' : '▶️ Spelar nu',
      value: `**${now.title}**${now.artist ? ` – ${now.artist}` : ''}`,
    });
    if (queueRes.rows.length) {
      embed.addFields({
        name: 'Kö',
        value: queueRes.rows.map((r, i) => `${i + 1}. **${r.title}**${r.artist ? ` – ${r.artist}` : ''}`).join('\n'),
      });
    }
    await interaction.editReply({ embeds: [embed] });
  },
};
