/** Social module: quote book, game nights, reminders, weekly report. */
import type { Client } from 'discord.js';
import type { BotModule } from '../core/module.js';
import { getScheduler } from '../core/scheduler.js';
import { paminn, socialJobs, spelkvall, spelkvallComponents } from './game-nights.js';
import { citat, registerQuoteReactions } from './quotes.js';
import { ensureWeeklyReportJobs, weeklyReportJob } from './weekly-report.js';

let client: Client | null = null;
const getClient = () => {
  if (!client) throw new Error('client not ready');
  return client;
};

export const socialModule: BotModule = {
  name: 'social',
  commands: [citat, spelkvall, paminn],
  components: [spelkvallComponents],
  jobs: { ...socialJobs(getClient), 'weekly-report': weeklyReportJob(getClient) },
  setup(c) {
    client = c;
    registerQuoteReactions(c);
  },
  async onReady(c) {
    await ensureWeeklyReportJobs(c, getScheduler());
  },
};
