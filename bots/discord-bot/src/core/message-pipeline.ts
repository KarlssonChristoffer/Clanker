/**
 * One MessageCreate listener for the whole bot. Handlers run in registration order, each isolated:
 * a failing handler is logged and the next one still runs. The message log (stats.message_log)
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
    for (const handler of handlers) {
      try {
        await handler.handle(message);
      } catch (err) {
        log.error(
          { err, handler: handler.name, messageId: message.id, guildId: message.guildId, channelId: message.channelId },
          'message handler failed',
        );
      }
    }
  });
}
