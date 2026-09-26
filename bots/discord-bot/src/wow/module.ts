/** WoW + server-setup module: /setup, /raid, /wow, /roster, LFG parsing, reset post, temp voice. */
import type { Client } from 'discord.js';
import type { BotModule } from '../core/module.js';
import { getConfig } from '../core/config.js';
import { childLogger } from '../core/logger.js';
import { getScheduler } from '../core/scheduler.js';
import { db } from '../db.js';
import { raid, raidComponents } from '../commands/raid.js';
import { rolePickerComponents, setup, setupComponents } from '../commands/setup.js';
import { roster, wowCommand } from '../commands/wow.js';
import { registerTempVoice, sweepTempVoice } from '../voice/temp-channels.js';
import { lfgComponents, lfgHandler } from './lfg.js';
import { raidJobs } from './raid.js';
import { ensureResetJobs, resetJob } from './reset.js';

const log = childLogger('wow');
let client: Client | null = null;
const getClient = () => {
  if (!client) throw new Error('client not ready');
  return client;
};

export const wowModule: BotModule = {
  name: 'wow',
  commands: [setup, raid, wowCommand, roster],
  components: [setupComponents, rolePickerComponents, raidComponents, lfgComponents],
  messageHandlers: [lfgHandler],
  jobs: {
    ...raidJobs(getClient, db, () => getConfig().wow.flavor),
    'wow-reset': resetJob(getClient, db),
  },
  setup(c) {
    client = c;
    registerTempVoice(c, db);
    log.info({ flavor: getConfig().wow.flavor, region: getConfig().wow.region }, 'WoW module ready');
  },
  async onReady(c) {
    await sweepTempVoice(c, db);
    await ensureResetJobs(c, getScheduler());
  },
};
