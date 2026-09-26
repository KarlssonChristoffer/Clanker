/**
 * The quote book. React with 💬 on a message → it is saved in bot.quotes (once per message) and
 * Clanker confirms with 📖. /citat [sök] [från] shows a random or matching quote. The hub's
 * lore-quote widget reads the same table via discord-hub-api.
 */
import {
  EmbedBuilder,
  Events,
  SlashCommandBuilder,
  type Client,
  type MessageReaction,
  type PartialMessageReaction,
  type PartialUser,
  type User,
} from 'discord.js';
import type { SlashCommand } from '../core/commands.js';
import { features } from '../core/features.js';
import { UserFacingError } from '../core/interaction-errors.js';
import { childLogger } from '../core/logger.js';
import type { Queryable } from '../db.js';
import { db } from '../db.js';
import { requireGuildId } from '../commands/_shared.js';

const log = childLogger('quotes');
export const QUOTE_EMOJI = '💬';
export const SAVED_EMOJI = '📖';

export type QuoteRow = {
  id: string;
  guild_id: string;
  channel_id: string;
  message_id: string;
  author_id: string;
  author_name: string;
  content: string;
  said_at: Date;
  saved_at: Date;
};

/** Inserts a quote; returns false when the message was already in the book. */
export async function saveQuote(
  q: Queryable,
  input: { guildId: string; channelId: string; messageId: string; authorId: string; authorName: string; content: string; savedBy: string; saidAt: Date },
): Promise<boolean> {
  const res = await q.query(
    `INSERT INTO bot.quotes (guild_id, channel_id, message_id, author_id, author_name, content, saved_by, said_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (message_id) DO NOTHING RETURNING id`,
    [input.guildId, input.channelId, input.messageId, input.authorId, input.authorName, input.content, input.savedBy, input.saidAt],
  );
  return res.rows.length > 0;
}

export async function findQuote(q: Queryable, guildId: string, search: string | null, authorId: string | null): Promise<QuoteRow | null> {
  const res = await q.query<QuoteRow>(
    `SELECT id::text AS id, guild_id, channel_id, message_id, author_id, author_name, content, said_at, saved_at
     FROM bot.quotes
     WHERE guild_id = $1
       AND ($2::text IS NULL OR content ILIKE '%' || $2 || '%' OR author_name ILIKE '%' || $2 || '%')
       AND ($3::text IS NULL OR author_id = $3)
     ORDER BY random() LIMIT 1`,
    [guildId, search, authorId],
  );
  return res.rows[0] ?? null;
}

export function quoteEmbed(q: QuoteRow): EmbedBuilder {
  const said = new Date(q.said_at);
  return new EmbedBuilder()
    .setDescription(`${q.content.split('\n').map((l) => `> ${l}`).join('\n').slice(0, 3900)}\n\n— **${q.author_name}**`)
    .setFooter({ text: `${said.toLocaleDateString('sv-SE', { timeZone: 'Europe/Stockholm', day: 'numeric', month: 'long', year: 'numeric' })} · citat #${q.id}` })
    .setURL(`https://discord.com/channels/${q.guild_id}/${q.channel_id}/${q.message_id}`)
    .setTitle('💬 Ur citatboken')
    .setColor(0xfaa61a);
}

async function onReaction(reaction: MessageReaction | PartialMessageReaction, user: User | PartialUser): Promise<void> {
  if (user.bot) return;
  if (reaction.emoji.name !== QUOTE_EMOJI) return;
  const full = reaction.partial ? await reaction.fetch() : reaction;
  const message = full.message.partial ? await full.message.fetch() : full.message;
  if (!message.guildId || message.author.bot) return;
  if (!(await features().isEnabled(message.guildId, 'citat'))) return;
  const content = message.content.trim();
  if (!content) return;
  const saved = await saveQuote(db, {
    guildId: message.guildId,
    channelId: message.channelId,
    messageId: message.id,
    authorId: message.author.id,
    authorName: message.member?.displayName ?? message.author.displayName,
    content: content.slice(0, 2000),
    savedBy: user.id,
    saidAt: message.createdAt,
  });
  if (saved) {
    await message.react(SAVED_EMOJI).catch(() => undefined);
    log.info({ guildId: message.guildId, messageId: message.id }, 'quote saved');
  }
}

export function registerQuoteReactions(client: Client): void {
  client.on(Events.MessageReactionAdd, (reaction, user) => {
    onReaction(reaction, user).catch((err) => log.error({ err }, 'quote reaction failed'));
  });
}

export const citat: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('citat')
    .setDescription('Ett slumpat citat ur citatboken (reagera med 💬 för att spara nya).')
    .addStringOption((o) => o.setName('sök').setDescription('Sök i text eller namn').setMaxLength(100))
    .addUserOption((o) => o.setName('från').setDescription('Bara citat från den här personen')),
  async execute(interaction) {
    const guildId = requireGuildId(interaction);
    await features().require(guildId, 'citat');
    const search = interaction.options.getString('sök')?.trim() || null;
    const from = interaction.options.getUser('från');
    const quote = await findQuote(db, guildId, search, from?.id ?? null);
    if (!quote) {
      throw new UserFacingError(
        search || from
          ? '🔍 Inga citat matchade. Citatboken har luckor, precis som vårt minne.'
          : `📖 Citatboken är tom! Reagera med ${QUOTE_EMOJI} på ett meddelande så sparas det.`,
      );
    }
    await interaction.reply({ embeds: [quoteEmbed(quote)], allowedMentions: { parse: [] } });
  },
};
