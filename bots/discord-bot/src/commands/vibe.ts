/**
 * /vibe: Jev reads the channel's last 50 messages (authors pseudonymised, bots and opted-out users
 * removed) and scores the mood. Shown as an embed with ▰▱ bars and a headline.
 */
import { EmbedBuilder, SlashCommandBuilder, type Message } from 'discord.js';
import type { SlashCommand } from '../core/commands.js';
import { features } from '../core/features.js';
import { UserFacingError } from '../core/interaction-errors.js';
import { isJevUnavailable, jev } from '../jev/client.js';
import { jevOptOut } from '../jev/store.js';
import { choice, score, type ScoreAnswer } from '../jev/types.js';
import { jevUnavailableText, requireJev } from '../jev/ui.js';
import { bar, plural, requireGuildId } from './_shared.js';

const HEADINGS = {
  fredagsmys: { label: 'Fredagsmys 🛋️', desc: 'Cosy and relaxed, good vibes, snacks, weekend feeling' },
  krigszon: { label: 'Krigszon ⚔️', desc: 'Arguing, flaming, heated conflict' },
  filosofiseminarium: { label: 'Filosofiseminarium 🧐', desc: 'Deep, serious or philosophical discussion' },
  memefabrik: { label: 'Memefabrik 🏭', desc: 'Memes, jokes and shitposting' },
  planeringsmote: { label: 'Planeringsmöte 📋', desc: 'Organising, scheduling and logistics' },
  spelkvall: { label: 'Spelkväll 🎮', desc: 'Talking about playing games together' },
  nattugglor: { label: 'Nattugglor 🦉', desc: 'Sleepy, late-night, low activity' },
  pepptrask: { label: 'Pepp-central 🚀', desc: 'Hype and excitement about something coming up' },
  supportgrupp: { label: 'Supportgrupp 🫂', desc: 'Venting and comforting each other' },
  vardagsbrus: { label: 'Vardagsbrus 📻', desc: 'None of these clearly fits; ordinary everyday chat' },
} as const;
type Heading = keyof typeof HEADINGS;

const SCORES = [
  { key: 'energi', sv: 'Energi', q: score('How much energy is there in `messages`?', ['dead quiet', 'calm', 'normal', 'lively', 'hyper, exclamation marks everywhere']) },
  { key: 'kaos', sv: 'Kaos', q: score('How chaotic and all over the place is the conversation in `messages`?', ['one clear topic', 'mostly focused', 'some tangents', 'many parallel threads', 'total chaos']) },
  { key: 'pepp', sv: 'Pepp', q: score('How excited or hyped are the people in `messages`?', ['not at all', 'a little', 'clearly excited', 'very hyped']) },
  { key: 'brak', sv: 'Bråk', q: score('How much arguing or friction is there in `messages`?', ['none', 'mild disagreement', 'heated debate', 'a real fight']) },
  { key: 'trotthet', sv: 'Trötthet', q: score('How tired do the people in `messages` sound?', ['wide awake', 'normal', 'a bit tired', 'exhausted, going to bed']) },
  { key: 'humor', sv: 'Humor', q: score('How much joking and humour is there in `messages`?', ['none', 'a little', 'plenty', 'non-stop jokes']) },
] as const;

function pseudonym(i: number): string {
  return i < 26 ? String.fromCharCode(65 + i) : `U${i}`;
}

export const vibe: SlashCommand = {
  data: new SlashCommandBuilder().setName('vibe').setDescription('Jev läser av stämningen i kanalen (senaste 50 meddelandena).'),
  async execute(interaction) {
    const guildId = requireGuildId(interaction);
    await features().require(guildId, 'jev');
    requireJev();
    const channel = interaction.channel;
    if (!channel || !channel.isTextBased() || !('messages' in channel)) {
      throw new UserFacingError('Jag kan bara läsa av stämningen i textkanaler.');
    }
    await interaction.deferReply();

    const fetched = await channel.messages.fetch({ limit: 50 });
    const optOut = jevOptOut();
    const names = new Map<string, string>();
    const messages = [...fetched.values()]
      .filter((m: Message) => !m.author.bot && m.content.trim() && !optOut.isOptedOut(m.author.id))
      .sort((a, b) => a.createdTimestamp - b.createdTimestamp)
      .map((m) => {
        if (!names.has(m.author.id)) names.set(m.author.id, pseudonym(names.size));
        return { author: names.get(m.author.id)!, text: m.content.slice(0, 300) };
      });
    if (messages.length < 5) {
      await interaction.editReply('🦗 För lite snack här för att läsa av någon stämning. Prata lite först!');
      return;
    }

    const questions = {
      ...Object.fromEntries(SCORES.map((s) => [s.key, s.q])),
      rubrik: choice<Heading>(
        'Which headline best describes the overall mood of `messages`?',
        Object.fromEntries(Object.entries(HEADINGS).map(([k, v]) => [k, v.desc])) as Record<Heading, string>,
      ),
    };
    let res;
    try {
      res = await jev().ask({ messages }, questions, { feature: 'vibe', guildId });
    } catch (err) {
      if (isJevUnavailable(err)) {
        await interaction.editReply(jevUnavailableText(err));
        return;
      }
      throw err;
    }
    const answers = res.answers as unknown as Record<string, ScoreAnswer> & { rubrik: { choice: Heading; confidence: number } };
    const heading = HEADINGS[answers.rubrik.choice] ?? HEADINGS.vardagsbrus;
    const lines = SCORES.map((s) => {
      const a = answers[s.key]!;
      const levels = s.q.criteria.length - 1;
      const pct = Math.round((a.confidence ?? 0) * 100);
      return `\`${s.sv.padEnd(8, ' ')}\` ${bar(a.score / levels)} -# ${pct} %`;
    });
    const embed = new EmbedBuilder()
      .setTitle(`Vibe-koll: ${heading.label}`)
      .setDescription(`${lines.join('\n')}\n\n-# Rubriksäkerhet ${Math.round(answers.rubrik.confidence * 100)} % · säkerhet per rad till höger`)
      .setFooter({ text: `${plural(messages.length, 'meddelande', 'meddelanden')} · ${plural(names.size, 'person', 'personer')} · ${res.model}` })
      .setColor(0xeb459e);
    await interaction.editReply({ embeds: [embed] });
  },
};
