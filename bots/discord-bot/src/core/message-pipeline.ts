/**
 * One MessageCreate listener for the whole bot. Handlers run concurrently, each isolated:
 * a failing handler is logged and does not affect the others. The message log (stats.message_log)
 * is the first handler; Jev reflexes, LFG parsing etc. are added after it.
 */
import { Events, type Client, type Message } from 'discord.js';
import { childLogger } from './logger.js';
import { isShuttingDown } from './lifecycle.js';

const log = childLogger('messages');

export type MessageHandler = {
  name: string;
  handle: (message: Message) => Promise<void>;
};

export function registerMessagePipeline(client: Client, handlers: readonly MessageHandler[]): void {
  client.on(Events.MessageCreate, async (message) => {
    if (isShuttingDown()) return;
    // Handlers are independent; run them concurrently so a slow one (a Jev call) does not delay the others.
    await Promise.all(
      handlers.map(async (handler) => {
        try {
          await handler.handle(message);
        } catch (err) {
          log.error(
            { err, handler: handler.name, messageId: message.id, guildId: message.guildId, channelId: message.channelId },
            'message handler failed',
          );
        }
      }),
    );
  });
}
