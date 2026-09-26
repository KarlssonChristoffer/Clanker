/** /orakel <påstående>: one Noul question, shown as "Oraklet säger: 73 % ja" with a bar and a quip. */
import { EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import type { SlashCommand } from '../core/commands.js';
import { features } from '../core/features.js';
import { isJevUnavailable, jev } from '../jev/client.js';
import { noul } from '../jev/types.js';
import { jevUnavailableText } from '../jev/ui.js';
import { bar, pick, requireGuildId } from './_shared.js';

const QUIPS: { min: number; lines: string[] }[] = [
  { min: 0.9, lines: ['Stjärnorna är överens. Så är det.', 'Oraklet har inga tvivel. Inga alls.', 'Skriv det i sten.'] },
  { min: 0.65, lines: ['Troligen. Men säg inte att jag sa det.', 'Lutar åt ja. Ganska kraftigt.', 'Kristallkulan nickar försiktigt.'] },
  { min: 0.35, lines: ['Dimman är tjock. Fråga igen efter kaffet.', 'Kanske. Kanske inte. Oraklet vägrar ta ställning.', 'Femtio-femtio, som allt annat i livet.'] },
  { min: 0.1, lines: ['Tveksamt. Mycket tveksamt.', 'Oraklet höjer ett ögonbryn.', 'Jag skulle inte satsa gold på det.'] },
  { min: 0, lines: ['Nej. Bara nej.', 'Oraklet skrattar högt åt det här.', 'Glöm det. Helt.'] },
];

export function oracleQuip(p: number, random: () => number = Math.random): string {
  const bucket = QUIPS.find((b) => p >= b.min) ?? QUIPS[QUIPS.length - 1]!;
  return pick(bucket.lines, random);
}

const question = noul('Is the statement in `claim` true? Use general world knowledge and common sense.', {
  true: 'The claim is true or very likely true',
  false: 'The claim is false or very unlikely',
});

export const orakel: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('orakel')
    .setDescription('Fråga oraklet om ett påstående stämmer.')
    .addStringOption((o) =>
      o.setName('påstående').setDescription('Till exempel: "Pizza med ananas är gott"').setRequired(true).setMaxLength(300),
    ),
  async execute(interaction) {
    const guildId = requireGuildId(interaction);
    await features().require(guildId, 'jev');
    const claim = interaction.options.getString('påstående', true).trim();
    await interaction.deferReply();
    let p: number;
    try {
      const res = await jev().ask({ claim }, { verdict: question }, { feature: 'orakel', guildId });
      p = Math.min(1, Math.max(0, res.answers.verdict.noul));
    } catch (err) {
      if (isJevUnavailable(err)) {
        await interaction.editReply(jevUnavailableText(err));
        return;
      }
      throw err;
    }
    const pct = Math.round(p * 100);
    const embed = new EmbedBuilder()
      .setTitle('🔮 Oraklet har talat')
      .setDescription(`> ${claim}\n\n**Oraklet säger: ${pct} % ja**\n${bar(p, 20)}\n\n*${oracleQuip(p)}*`)
      .setFooter({ text: `Frågat av ${interaction.user.displayName}` })
      .setColor(0x9b59b6);
    await interaction.editReply({ embeds: [embed] });
  },
};
