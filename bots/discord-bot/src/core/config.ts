/**
 * Typed bot configuration from the environment. Loaded once at startup (after dotenv).
 * Every new env var gets an entry here and in `.env.example` / docs/discord-hub.md.
 */
import { createRequire } from 'node:module';

const SNOWFLAKE_RE = /^\d{5,32}$/;

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}

function optionalEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

function snowflakeList(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => SNOWFLAKE_RE.test(s));
}

function intEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = optionalEnv(name);
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max} (got "${raw}")`);
  }
  return n;
}

function readPackageVersion(): string {
  try {
    const require = createRequire(import.meta.url);
    return (require('../../package.json') as { version?: string }).version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

export type WowFlavor = 'retail' | 'classic' | 'forever';

function parseWowFlavor(raw: string | undefined): WowFlavor {
  const v = (raw ?? 'retail').toLowerCase();
  if (v === 'retail' || v === 'classic' || v === 'forever') return v;
  throw new Error(`WOW_FLAVOR must be retail, classic or forever (got "${raw}")`);
}

export function loadConfig() {
  const musicHttpBind = optionalEnv('MUSIC_BOT_HTTP_BIND') ?? '127.0.0.1';
  const version = optionalEnv('BOT_VERSION') ?? readPackageVersion();
  return Object.freeze({
    nodeEnv: process.env.NODE_ENV ?? 'development',
    version,
    token: requireEnv('DISCORD_BOT_TOKEN'),
    appId: requireEnv('DISCORD_APPLICATION_ID'),
    databaseUrl: requireEnv('DATABASE_URL'),
    /** Guild-scoped slash commands (fast iteration). Comma-separated; empty = global registration. */
    commandGuildIds: snowflakeList(process.env.DISCORD_GUILD_ID),
    forceCommandSync: process.env.DISCORD_FORCE_COMMAND_SYNC === '1',
    runMigrations: process.env.DISCORD_BOT_RUN_MIGRATIONS !== '0',
    httpPort: intEnv('MUSIC_BOT_HTTP_PORT', 3012, 1, 65535),
    httpBind: musicHttpBind,
    httpSecret: optionalEnv('BOT_HTTP_SECRET'),
    /** Guilds where destructive setup operations (/setup) are allowed. */
    setupAllowedGuildIds: snowflakeList(process.env.SETUP_ALLOWED_GUILD_IDS),
    jev: {
      apiKey: optionalEnv('TYPESAFE_API_KEY'),
      apiBase: (optionalEnv('TYPESAFE_API_BASE') ?? 'https://api.typesafe.ai').replace(/\/$/, ''),
      model: optionalEnv('JEV_MODEL') ?? 'jev-1.13.0',
      maxConcurrency: intEnv('JEV_MAX_CONCURRENCY', 4, 1, 64),
      timeoutMs: intEnv('JEV_TIMEOUT_MS', 15_000, 1_000, 120_000),
      /** USD per million input tokens (jev-1.13.0 list price, verified 2026-09-26); output is free. */
      usdPerMillionInputTokens: Number(optionalEnv('JEV_USD_PER_MTOK') ?? '0.042'),
    },
    wow: {
      flavor: parseWowFlavor(optionalEnv('WOW_FLAVOR')),
      region: (optionalEnv('WOW_REGION') ?? 'eu').toLowerCase(),
      locale: optionalEnv('WOW_LOCALE') ?? 'en_GB',
      defaultRealm: optionalEnv('WOW_DEFAULT_REALM'),
      blizzardClientId: optionalEnv('BLIZZARD_CLIENT_ID'),
      blizzardClientSecret: optionalEnv('BLIZZARD_CLIENT_SECRET'),
      /** Override the Blizzard profile namespace prefix (e.g. once WoW Forever gets one). */
      profileNamespace: optionalEnv('WOW_PROFILE_NAMESPACE'),
      raiderIoAccessKey: optionalEnv('RAIDERIO_ACCESS_KEY'),
    },
  });
}

export type BotConfig = ReturnType<typeof loadConfig>;

let current: BotConfig | null = null;

export function initConfig(): BotConfig {
  current = loadConfig();
  return current;
}

export function getConfig(): BotConfig {
  if (!current) throw new Error('Config not initialised: call initConfig() at startup');
  return current;
}

export function isLoopbackBind(bind: string): boolean {
  return bind === '127.0.0.1' || bind === '::1' || bind === 'localhost';
}
