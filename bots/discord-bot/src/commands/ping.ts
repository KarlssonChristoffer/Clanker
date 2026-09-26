import { SlashCommandBuilder } from 'discord.js';
import type { SlashCommand } from '../core/commands.js';
import { EPHEMERAL, pick } from './_shared.js';

const LINES = ['Pong! 🏓', 'Pong. Jag lever, tyvärr för er. 🤖', 'Pong! Fortfarande snabbare än er ping i raid. ⚡'];

export const ping: SlashCommand = {
  data: new SlashCommandBuilder().setName('ping').setDescription('Kolla att Clanker lever (och hur snabbt).'),
  async execute(interaction) {
    const ws = interaction.client.ws.ping;
    await interaction.reply({
      content: `${pick(LINES)}\n-# gateway ${ws >= 0 ? `${ws} ms` : 'mäts fortfarande'}`,
      flags: EPHEMERAL,
    });
  },
};
