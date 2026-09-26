/**
 * Emoji reflexes: Jev reads a fresh message and Clanker reacts with a fitting emoji, but only when the
 * guild flag `jev_reflexer` is on AND the channel opted in (/jev reflexer på), the author is human and
 * not opted out, the message is long enough, the channel is not in cooldown, and Jev is confident
 * (≥ 0.75). Jev only picks among fixed options, so text in the message cannot make the bot do more
 * than choose a different emoji.
 */
import type { Message } from 'discord.js';
import type { MessageHandler } from '../core/message-pipeline.js';
import { features } from '../core/features.js';
import { childLogger } from '../core/logger.js';
import { isJevUnavailable, jev } from './client.js';
import { jevOptOut } from './store.js';
import { choice } from './types.js';

const log = childLogger('jev-reflexes');

export const REFLEX_OPTIONS = {
  laugh: { emoji: '😂', desc: 'A clear joke or something genuinely funny' },
  skull: { emoji: '💀', desc: 'Absurd, cringe or "I am dead" level funny' },
  fire: { emoji: '🔥', desc: 'Hype, bragging about something impressive, a big achievement' },
  party: { emoji: '🎉', desc: 'Celebration: a win, birthday, congratulations, good news' },
  heart: { emoji: '🫶', desc: 'Wholesome, kind, affectionate or thankful' },
  sad: { emoji: '😢', desc: 'Sad news or disappointment where sympathy fits' },
  eyes: { emoji: '👀', desc: 'Gossip, something suspicious, a teaser or intriguing reveal' },
  thinking: { emoji: '🤔', desc: 'A genuinely puzzling question or philosophical musing' },
  muscle: { emoji: '💪', desc: 'Motivation, working out, grinding or getting things done' },
  food: { emoji: '🍕', desc: 'Talking about food, cooking, eating or being hungry' },
  sleepy: { emoji: '😴', desc: 'Being tired or going to sleep' },
  game: { emoji: '🎮', desc: 'Inviting others to play a game or hyping a gaming session' },
  none: { emoji: '', desc: 'None of the above clearly fits: ordinary chat, logistics, questions, links' },
} as const;

export type ReflexOption = keyof typeof REFLEX_OPTIONS;

export const REFLEX_MIN_CONFIDENCE = 0.75;
const MIN_LENGTH = 12;
const COOLDOWN_MS = Number(process.env.JEV_REFLEX_COOLDOWN_S ?? '60') * 1000;
/** Even without a reaction, don't ask Jev about the same channel more often than this. */
const CALL_SPACING_MS = 10_000;

const lastReactionAt = new Map<string, number>();
const lastCallAt = new Map<string, number>();

const question = choice<ReflexOption>(
  'Which single emoji reaction would a friendly Discord member most naturally add to `message`? Pick "none" unless one option clearly fits.',
  Object.fromEntries(Object.entries(REFLEX_OPTIONS).map(([k, v]) => [k, v.desc])) as Record<ReflexOption, string>,
);

/** Decision rule, exported for tests. */
export function reflexEmoji(answer: { choice: string; confidence: number }): string | null {
  if (answer.choice === 'none' || answer.confidence < REFLEX_MIN_CONFIDENCE) return null;
  const opt = REFLEX_OPTIONS[answer.choice as ReflexOption];
  return opt?.emoji || null;
}

async function handle(message: Message): Promise<void> {
  if (!message.guildId || message.author.bot || message.system) return;
  const text = message.content.trim();
  if (text.length < MIN_LENGTH) return;
  const client = jev();
  if (!client.enabled || client.breakerState === 'open') return;
  if (jevOptOut().isOptedOut(message.author.id)) return;

  const now = Date.now();
  if (now - (lastReactionAt.get(message.channelId) ?? 0) < COOLDOWN_MS) return;
  if (now - (lastCallAt.get(message.channelId) ?? 0) < CALL_SPACING_MS) return;
  if (!(await features().isChannelEnabled(message.guildId, message.channelId, 'jev_reflexer'))) return;
  lastCallAt.set(message.channelId, now);

  try {
    const res = await client.ask({ message: text.slice(0, 1500) }, { reaction: question }, { feature: 'reflex', guildId: message.guildId });
    const emoji = reflexEmoji(res.answers.reaction);
    if (!emoji) return;
    await message.react(emoji);
    lastReactionAt.set(message.channelId, Date.now());
    log.debug({ channelId: message.channelId, emoji, confidence: res.answers.reaction.confidence }, 'reacted');
  } catch (err) {
    if (isJevUnavailable(err)) return;
    throw err;
  }
}

export const reflexHandler: MessageHandler = { name: 'jev-reflexes', handle };
