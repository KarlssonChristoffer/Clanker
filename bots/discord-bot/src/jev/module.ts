/** Jev feature module: client + opt-outs + health, commands, reflexes, mind-reader warm-up. */
import type { BotModule } from '../core/module.js';
import { getConfig } from '../core/config.js';
import { setJevHealthProvider } from '../core/health.js';
import { childLogger } from '../core/logger.js';
import { db } from '../db.js';
import { jevCommand, jevstats } from '../commands/jev.js';
import { orakel } from '../commands/orakel.js';
import { tankelasare, tankelasareComponents } from '../commands/tankelasare.js';
import { vibe } from '../commands/vibe.js';
import { initJev, jev } from './client.js';
import { warmupMatrix } from './mindreader/matrix.js';
import { reflexHandler } from './reflexes.js';
import { initJevOptOut, persistJevCall } from './store.js';

const log = childLogger('jev');
const WARMUP_RETRY_MS = 15 * 60_000;

let warmupTimer: NodeJS.Timeout | null = null;

async function runWarmup(): Promise<void> {
  const client = jev();
  if (!client.enabled) return;
  try {
    const { remaining } = await warmupMatrix(db, client, log);
    if (remaining > 0) {
      warmupTimer = setTimeout(() => void runWarmup(), WARMUP_RETRY_MS);
      warmupTimer.unref();
    }
  } catch (err) {
    log.warn({ err }, 'mind-reader warm-up failed; retrying later');
    warmupTimer = setTimeout(() => void runWarmup(), WARMUP_RETRY_MS);
    warmupTimer.unref();
  }
}

export const jevModule: BotModule = {
  name: 'jev',
  commands: [jevCommand, jevstats, vibe, orakel, tankelasare],
  components: [tankelasareComponents],
  messageHandlers: [reflexHandler],
  async setup() {
    const cfg = getConfig().jev;
    const client = initJev({
      apiKey: cfg.apiKey,
      apiBase: cfg.apiBase,
      model: cfg.model,
      timeoutMs: cfg.timeoutMs,
      maxConcurrency: cfg.maxConcurrency,
      onCall: (r) => persistJevCall(db, r),
    });
    setJevHealthProvider(() => (client.enabled ? client.breakerState : 'disabled'));
    await initJevOptOut(db).load();
    log.info({ enabled: client.enabled, model: client.model, base: cfg.apiBase }, client.enabled ? 'Jev enabled' : 'Jev disabled (no TYPESAFE_API_KEY)');
  },
  onReady() {
    void runWarmup();
  },
  onShutdown() {
    if (warmupTimer) clearTimeout(warmupTimer);
  },
};
