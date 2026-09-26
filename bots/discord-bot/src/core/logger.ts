/**
 * Structured logging (pino). JSON lines in production; pretty-printed in dev.
 * `LOG_LEVEL` (trace|debug|info|warn|error|fatal) overrides the default (`info`).
 * Use `childLogger('module')` so every line carries a `mod` field.
 */
import pino, { type Logger } from 'pino';

const isProduction = process.env.NODE_ENV === 'production';
const level = process.env.LOG_LEVEL?.trim().toLowerCase() || 'info';

function createRootLogger(): Logger {
  const base = { app: 'discord-bot' };
  if (isProduction || process.env.LOG_PRETTY === '0') {
    return pino({ level, base, timestamp: pino.stdTimeFunctions.isoTime });
  }
  try {
    return pino({
      level,
      base,
      transport: {
        target: 'pino-pretty',
        options: { colorize: true, translateTime: 'SYS:HH:MM:ss.l', ignore: 'pid,hostname,app' },
      },
    });
  } catch {
    // pino-pretty is a dev dependency; fall back to JSON if it is missing.
    return pino({ level, base });
  }
}

export const logger: Logger = createRootLogger();

export function childLogger(mod: string, bindings: Record<string, unknown> = {}): Logger {
  return logger.child({ mod, ...bindings });
}

export type { Logger };
