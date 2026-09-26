/**
 * /tankeläsare: think of something (animal, object, food, place or WoW thing); Clanker asks yes/no
 * questions chosen by expected information gain and guesses when it is > 70 % sure (or after 15
 * questions). Maths in jev/mindreader/engine.ts; P(yes|thing, property) comes from Jev once per model.
 * Games live in memory for 30 minutes (a restart ends running games).
 */
import { randomBytes } from 'node:crypto';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  SlashCommandBuilder,
  type ButtonInteraction,
} from 'discord.js';
import type { SlashCommand } from '../core/commands.js';
import { customId, type ComponentHandler } from '../core/components.js';
import { features } from '../core/features.js';
import { UserFacingError } from '../core/interaction-errors.js';
import { db } from '../db.js';
import { jev } from '../jev/client.js';
import { PROPERTIES, type Candidate } from '../jev/mindreader/data.js';
import {
  eliminate,
  nextQuestion,
  shouldGuess,
  topK,
  uniform,
  update,
  type Answer,
} from '../jev/mindreader/engine.js';
import { loadMatrix, type LoadedMatrix } from '../jev/mindreader/matrix.js';
import { bar, pick, requireGuildId } from './_shared.js';

const GAME_TTL_MS = 30 * 60_000;
const MAX_TOTAL_QUESTIONS = 20;
const MAX_GUESSES = 3;
const MIN_CANDIDATES = 20;

type Game = {
  id: string;
  userId: string;
  candidates: Candidate[];
  matrix: number[][];
  posterior: number[];
  asked: Set<number>;
  questions: number;
  current: number | null;
  guess: number | null;
  guesses: number;
  touchedAt: number;
};

const games = new Map<string, Game>();
let matrixCache: { model: string; at: number; data: LoadedMatrix } | null = null;

function sweep(): void {
  const now = Date.now();
  for (const [id, g] of games) if (now - g.touchedAt > GAME_TTL_MS) games.delete(id);
}

async function getMatrix(): Promise<LoadedMatrix> {
  const model = jev().model;
  if (matrixCache && matrixCache.model === model && Date.now() - matrixCache.at < 10 * 60_000) return matrixCache.data;
  const data = await loadMatrix(db, model);
  matrixCache = { model, at: Date.now(), data };
  return data;
}

const ANSWER_CODES: Record<string, Answer> = { y: 'yes', n: 'no', m: 'maybe', u: 'unknown' };

function suspectList(game: Game): string {
  return topK(game.posterior, 5)
    .map(({ index, p }) => `${bar(p, 10)} \`${String(Math.round(p * 100)).padStart(3, ' ')} %\` ${game.candidates[index]!.sv}`)
    .join('\n');
}

function questionView(game: Game) {
  const prop = PROPERTIES[game.current!]!;
  const embed = new EmbedBuilder()
    .setTitle(`🧠 Tankeläsaren · fråga ${game.questions + 1}`)
    .setDescription(`## ${prop.sv}`)
    .addFields({ name: 'Mina misstankar just nu', value: suspectList(game) })
    .setColor(0x5865f2);
  const btn = (code: string, label: string, style: ButtonStyle) =>
    new ButtonBuilder().setCustomId(customId('mind', 'a', game.id, code)).setLabel(label).setStyle(style);
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    btn('y', 'Ja', ButtonStyle.Success),
    btn('n', 'Nej', ButtonStyle.Danger),
    btn('m', 'Kanske', ButtonStyle.Secondary),
    btn('u', 'Vet inte', ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(customId('mind', 'q', game.id)).setLabel('Ge upp').setStyle(ButtonStyle.Secondary).setEmoji('🏳️'),
  );
  return { embeds: [embed], components: [row] };
}

function guessView(game: Game) {
  const cand = game.candidates[game.guess!]!;
  const p = game.posterior[game.guess!]!;
  const embed = new EmbedBuilder()
    .setTitle('🧠 Tankeläsaren gissar…')
    .setDescription(`Du tänker på… **${cand.sv}**!\n-# ${Math.round(p * 100)} % säker efter ${game.questions} frågor`)
    .setColor(0xfee75c);
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(customId('mind', 'g', game.id, 'r')).setLabel('Rätt!').setEmoji('🎉').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(customId('mind', 'g', game.id, 'w')).setLabel('Nej, fel').setStyle(ButtonStyle.Danger),
  );
  return { embeds: [embed], components: [row] };
}

function endView(game: Game, won: boolean) {
  const embed = won
    ? new EmbedBuilder()
        .setTitle('🧠 Tankeläsaren vann!')
        .setDescription(
          `${pick(['Jag visste det.', 'Som att läsa en öppen bok.', 'Ingen hemlighet är säker hos mig.'])} Det var **${game.candidates[game.guess!]!.sv}**, klart på ${game.questions} frågor.`,
        )
        .setColor(0x57f287)
    : new EmbedBuilder()
        .setTitle('🏳️ Du vann!')
        .setDescription(`Jag ger upp. Du är för klurig. Mina bästa gissningar var:\n${suspectList(game)}`)
        .setColor(0xed4245);
  return { embeds: [embed], components: [] };
}

/** Advance to the next question or a guess; returns the message payload. */
function advance(game: Game) {
  const canAsk = game.questions < MAX_TOTAL_QUESTIONS;
  const next = canAsk ? nextQuestion(game.posterior, game.matrix, game.asked) : null;
  const wantGuess = shouldGuess(game.posterior, game.questions) || next === null;
  if (wantGuess && game.guesses < MAX_GUESSES) {
    game.guess = topK(game.posterior, 1)[0]!.index;
    game.current = null;
    return guessView(game);
  }
  if (next === null) return endView(game, false);
  game.current = next;
  game.guess = null;
  return questionView(game);
}

export const tankelasare: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('tankeläsare')
    .setDescription('Tänk på något, så läser Clanker dina tankar med ja/nej-frågor.'),
  async execute(interaction) {
    const guildId = requireGuildId(interaction);
    await features().require(guildId, 'jev');
    sweep();
    const { candidates, matrix } = await getMatrix();
    if (candidates.length < MIN_CANDIDATES) {
      throw new UserFacingError(
        jev().enabled
          ? '🧠 Tankeläsaren värmer fortfarande upp hjärnan (Jev räknar fram sina ledtrådar). Prova igen om några minuter.'
          : '😴 Tankeläsaren behöver Jev, och Jev sover (ingen API-nyckel).',
      );
    }
    const game: Game = {
      id: randomBytes(4).toString('hex'),
      userId: interaction.user.id,
      candidates,
      matrix,
      posterior: uniform(candidates.length),
      asked: new Set(),
      questions: 0,
      current: null,
      guess: null,
      guesses: 0,
      touchedAt: Date.now(),
    };
    games.set(game.id, game);
    const view = advance(game);
    await interaction.reply({
      content: `🧠 ${interaction.user} tänker på något: ett djur, en sak, något ätbart, en plats eller något från WoW. Jag läser av…`,
      ...view,
    });
  },
};

async function onAnswer(interaction: ButtonInteraction, game: Game, code: string): Promise<void> {
  const answer = ANSWER_CODES[code];
  if (!answer || game.current === null) throw new UserFacingError('Den frågan är redan besvarad.');
  game.posterior = update(game.posterior, game.matrix, game.current, answer);
  game.asked.add(game.current);
  game.questions += 1;
  await interaction.update(advance(game));
}

async function onGuess(interaction: ButtonInteraction, game: Game, verdict: string): Promise<void> {
  if (game.guess === null) throw new UserFacingError('Jag har inte gissat än.');
  game.guesses += 1;
  if (verdict === 'r') {
    games.delete(game.id);
    await interaction.update(endView(game, true));
    return;
  }
  game.posterior = eliminate(game.posterior, game.guess);
  const view = game.guesses >= MAX_GUESSES ? endView(game, false) : advance(game);
  if (game.guesses >= MAX_GUESSES) games.delete(game.id);
  await interaction.update(view);
}

export const tankelasareComponents: ComponentHandler = {
  prefix: 'mind',
  async handle(interaction, parsed) {
    if (!interaction.isButton()) return;
    const [gameId, arg] = parsed.args;
    const game = gameId ? games.get(gameId) : undefined;
    if (!game) throw new UserFacingError('⌛ Det här spelet har gått ut. Starta ett nytt med `/tankeläsare`.');
    if (interaction.user.id !== game.userId) {
      await interaction.reply({ content: '🙅 Det här är inte ditt spel. Starta ett eget med `/tankeläsare`!', flags: MessageFlags.Ephemeral });
      return;
    }
    game.touchedAt = Date.now();
    if (parsed.action === 'a') return onAnswer(interaction, game, arg ?? '');
    if (parsed.action === 'g') return onGuess(interaction, game, arg ?? '');
    if (parsed.action === 'q') {
      games.delete(game.id);
      await interaction.update(endView(game, false));
    }
  },
};
