/**
 * A feature module contributes commands, component handlers, message handlers, scheduled-job
 * handlers and lifecycle hooks. `src/modules.ts` lists the modules; index.ts wires them up.
 */
import type { Client } from 'discord.js';
import type { SlashCommand } from './commands.js';
import type { ComponentHandler } from './components.js';
import type { MessageHandler } from './message-pipeline.js';
import type { JobHandler } from './scheduler.js';

export type BotModule = {
  name: string;
  commands?: SlashCommand[];
  components?: ComponentHandler[];
  /** Appended to the MessageCreate pipeline in module order. */
  messageHandlers?: MessageHandler[];
  /** Scheduled-job handlers by kind. */
  jobs?: Record<string, JobHandler>;
  /** Before login: attach extra client listeners (reactions, voice, threads …). */
  setup?: (client: Client) => void | Promise<void>;
  /** After the client is ready: warm caches, ensure recurring jobs, etc. Errors are logged, not fatal. */
  onReady?: (client: Client<true>) => void | Promise<void>;
  /** On graceful shutdown (before the Discord client is destroyed). */
  onShutdown?: () => void | Promise<void>;
};
