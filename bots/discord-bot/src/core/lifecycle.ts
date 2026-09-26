/**
 * Process lifecycle: signal/crash handlers and an ordered, idempotent shutdown.
 *
 * Modules register cleanup with `onShutdown(name, fn, order)`. Lower `order` runs first:
 *   10  stop accepting work (HTTP server, schedulers, pollers)
 *   20  leave voice / stop music
 *   30  destroy the Discord client
 *   90  close the database pool (last: others may still write during their cleanup)
 */
import { childLogger } from './logger.js';

const log = childLogger('lifecycle');

type Hook = { name: string; order: number; fn: () => Promise<void> | void };

const hooks: Hook[] = [];
let shuttingDown: Promise<void> | null = null;

const HOOK_TIMEOUT_MS = 5_000;
const FORCE_EXIT_MS = 15_000;

export function onShutdown(name: string, fn: () => Promise<void> | void, order = 50): void {
  hooks.push({ name, order, fn });
}

export function isShuttingDown(): boolean {
  return shuttingDown !== null;
}

async function runHook(hook: Hook): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      Promise.resolve().then(hook.fn),
      new Promise<void>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`timed out after ${HOOK_TIMEOUT_MS} ms`)), HOOK_TIMEOUT_MS);
      }),
    ]);
    log.debug({ hook: hook.name }, 'shutdown hook done');
  } catch (err) {
    log.warn({ hook: hook.name, err }, 'shutdown hook failed');
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Runs all hooks once (in order) and exits. Safe to call from several places at the same time. */
export function shutdown(reason: string, exitCode = 0): Promise<void> {
  if (shuttingDown) return shuttingDown;
  log.info({ reason, exitCode }, 'shutting down');
  const force = setTimeout(() => {
    log.error({ reason }, `shutdown did not finish within ${FORCE_EXIT_MS} ms; forcing exit`);
    process.exit(exitCode || 1);
  }, FORCE_EXIT_MS);
  force.unref();

  shuttingDown = (async () => {
    const ordered = [...hooks].sort((a, b) => a.order - b.order);
    for (const hook of ordered) {
      await runHook(hook);
    }
    log.info({ reason }, 'shutdown complete');
    // Give pino a tick to flush before exiting.
    await new Promise((r) => setImmediate(r));
    process.exit(exitCode);
  })();
  return shuttingDown;
}

export function installProcessHandlers(): void {
  process.once('SIGINT', () => void shutdown('SIGINT', 0));
  process.once('SIGTERM', () => void shutdown('SIGTERM', 0));

  process.on('unhandledRejection', (reason) => {
    // Log and keep running: one failed promise (e.g. a Discord REST call) must not take the bot down.
    log.error({ err: reason instanceof Error ? reason : new Error(String(reason)) }, 'unhandled promise rejection');
  });

  process.on('uncaughtException', (err, origin) => {
    // State may be corrupt after a synchronous throw escaped; shut down cleanly and let Docker restart us.
    log.fatal({ err, origin }, 'uncaught exception');
    void shutdown('uncaughtException', 1);
  });
}
