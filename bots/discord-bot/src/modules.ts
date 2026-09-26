/**
 * All feature modules, in the order their message handlers run.
 * The /admin command is built last so other modules can register admin subcommands first.
 */
import type { BotModule } from './core/module.js';
import { adminComponents, createAdminCommand } from './commands/admin.js';
import {
  pauseCommand,
  play,
  previousCommand,
  queue,
  resumeCommand,
  skipCommand,
  stopCommand,
} from './commands/music.js';
import { ping } from './commands/ping.js';
import { playlist } from './commands/playlist.js';
import { messageLogHandler } from './message-tracker.js';
import { jevModule } from './jev/module.js';

const coreModule: BotModule = {
  name: 'core',
  commands: [ping],
  messageHandlers: [messageLogHandler],
};

const musicModule: BotModule = {
  name: 'music',
  commands: [play, skipCommand, previousCommand, pauseCommand, resumeCommand, stopCommand, queue, playlist],
};

export function loadModules(): BotModule[] {
  const modules: BotModule[] = [coreModule, musicModule, jevModule];
  const adminModule: BotModule = {
    name: 'admin',
    commands: [createAdminCommand()],
    components: [adminComponents],
  };
  return [...modules, adminModule];
}
