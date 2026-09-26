/**
 * Message log tracker.
 * Stores one row per Discord message in stats.message_log.
 *
 * Requires privileged intents:
 *   GuildMessages     — receive message events (non-privileged since 2022, but must be enabled)
 *   MessageContent    — read message content (privileged — enable in Developer Portal)
 */

import { Events, type Client, type Message } from 'discord.js';
import { getPool } from './db.js';
import { childLogger } from './core/logger.js';

const log = childLogger('message-tracker');

async function logMessage(msg: Message): Promise<void> {
  if (!msg.guildId) return;   // ignore DMs
  if (msg.author.bot) return; // ignore other bots

  await getPool().query(
    `INSERT INTO stats.message_log
       (message_id, guild_id, channel_id, user_id, username, content, attachment_count, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (message_id) DO NOTHING`,
    [
      msg.id,
      msg.guildId,
      msg.channelId,
      msg.author.id,
      msg.author.username,
      msg.content ?? '',
      msg.attachments.size,
      msg.createdAt,
    ],
  );
}

export function registerMessageTracker(client: Client): void {
  client.on(Events.MessageCreate, async (msg) => {
    try { await logMessage(msg); }
    catch (err) { log.error({ err }, 'MessageCreate error'); }
  });
}
