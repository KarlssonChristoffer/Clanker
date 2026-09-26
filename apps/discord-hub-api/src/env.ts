const REQUIRED_STRINGS = [
  "DISCORD_CLIENT_ID",
  "DISCORD_CLIENT_SECRET",
  "DISCORD_REDIRECT_URI",
  "SESSION_SECRET",
  "FRONTEND_URL",
] as const;

const DEFAULT_USER_PROXY_PREFIXES = "users/@me,oauth2/@me";
const DEFAULT_BOT_PROXY_PREFIXES = "guilds/,channels/";

function missingEnv(names: readonly string[]): string[] {
  return names.filter((n) => !(process.env[n]?.trim()));
}

function parseCommaSeparatedPrefixes(raw: string | undefined, fallback: string): string[] {
  const s = (raw?.trim() || fallback).split(",");
  return s.map((p) => p.trim()).filter((p) => p.length > 0);
}

function parseSnowflakeList(raw: string | undefined): string[] {
  if (!raw?.trim()) {
    return [];
  }
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => /^\d{5,32}$/.test(s));
}

function truthyEnv(name: string): boolean {
  const v = process.env[name]?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

function falsyEnv(name: string): boolean {
  const v = process.env[name]?.trim().toLowerCase();
  return v === "0" || v === "false" || v === "no";
}

/**
 * Session- och OAuth-cookies: `Secure`-flagga. I `NODE_ENV=production` är den
 * true som standard (kräver HTTPS). Sätt `COOKIE_SECURE=0` om du kör prod-läge
 * över HTTP (t.ex. homelab utan TLS) — annars ignoreras state-cookien och
 * inloggning faller tillbaka till `/login?error=oauth`.
 */
function parseCookieSecure(nodeEnv: string): boolean {
  if (truthyEnv("COOKIE_SECURE")) {
    return true;
  }
  if (falsyEnv("COOKIE_SECURE")) {
    return false;
  }
  return nodeEnv === "production";
}

function normalizeOAuthScopes(raw: string | undefined): string {
  const s = raw?.trim() || "identify";
  return s.split(/\s+/).filter(Boolean).join(" ");
}

/** Om satt måste värdet vara en postgres-anslutnings-URL (används av `pg`). */
function parseDatabaseUrl(raw: string | undefined): string | undefined {
  const s = raw?.trim();
  if (!s) {
    return undefined;
  }
  const head = s.slice(0, 14).toLowerCase();
  if (!head.startsWith("postgres://") && !head.startsWith("postgresql://")) {
    throw new Error(
      "DATABASE_URL must start with postgres:// or postgresql:// (see apps/discord-hub-api/.env.example).",
    );
  }
  return s;
}

export type DbConfig =
  | { kind: "url"; url: string }
  | { kind: "params"; host: string; port: number; user: string; password: string; database: string };

function parseDbConfig(): DbConfig | undefined {
  const url = parseDatabaseUrl(process.env.DATABASE_URL);
  if (url) return { kind: "url", url };

  const user = process.env.POSTGRES_USER?.trim();
  const password = process.env.POSTGRES_PASSWORD?.trim();
  const database = process.env.POSTGRES_DB?.trim();
  if (!user || !password || !database) return undefined;

  const host = process.env.POSTGRES_HOST?.trim() || "127.0.0.1";
  const port = Number(process.env.POSTGRES_PORT?.trim() || "5432");
  return { kind: "params", host, port, user, password, database };
}

export type DiscordOAuthPrompt = "consent" | "none";

export function loadEnv() {
  const missing = missingEnv(REQUIRED_STRINGS);
  if (missing.length > 0) {
    throw new Error(
      `Missing environment variable(s): ${missing.join(", ")} — sätt dem i repots .env (se apps/discord-hub-api/.env.example).`,
    );
  }

  const promptRaw = process.env.DISCORD_OAUTH_PROMPT?.trim().toLowerCase();
  let discordOAuthPrompt: DiscordOAuthPrompt | undefined;
  if (promptRaw === "consent" || promptRaw === "none") {
    discordOAuthPrompt = promptRaw;
  } else if (promptRaw !== undefined && promptRaw !== "") {
    throw new Error(
      "DISCORD_OAUTH_PROMPT must be empty, consent, or none (see apps/discord-hub-api/.env.example).",
    );
  }

  const botToken = process.env.DISCORD_BOT_TOKEN?.trim();
  const discordBotToken = botToken || undefined;
  const riotApiKey = process.env.RIOT_API_KEY?.trim() || undefined;

  const nodeEnv = process.env.NODE_ENV ?? "development";
  const cookieSecure = parseCookieSecure(nodeEnv);
  const oauthCallbackVerboseLog =
    nodeEnv !== "production" || truthyEnv("DISCORD_OAUTH_DEBUG");

  const listenHostRaw = process.env.DISCORD_HUB_API_LISTEN_HOST?.trim();
  const listenHost =
    listenHostRaw && listenHostRaw.length > 0
      ? listenHostRaw
      : nodeEnv === "production"
        ? "0.0.0.0"
        : "127.0.0.1";

  const port = Number(process.env.PORT ?? "3001");
  const wheelCollabPort = Number(
    process.env.WHEEL_COLLAB_PORT?.trim() || String(port + 1),
  );
  if (!Number.isFinite(port) || port < 1 || port > 65535) {
    throw new Error("PORT måste vara ett giltigt TCP-portnummer (1–65535).");
  }
  if (!Number.isFinite(wheelCollabPort) || wheelCollabPort < 1 || wheelCollabPort > 65535) {
    throw new Error(
      "WHEEL_COLLAB_PORT måste vara ett giltigt TCP-portnummer (1–65535) — se apps/discord-hub-api/.env.example.",
    );
  }
  if (port === wheelCollabPort) {
    throw new Error(
      "PORT och WHEEL_COLLAB_PORT får inte vara samma: wheel-collab startar före HTTP-servern och skulle då ta porten. Sätt t.ex. WHEEL_COLLAB_PORT till PORT+1.",
    );
  }

  return {
    listenHost,
    port,
    wheelCollabPort,
    discordClientId: process.env.DISCORD_CLIENT_ID!.trim(),
    discordClientSecret: process.env.DISCORD_CLIENT_SECRET!.trim(),
    discordRedirectUri: process.env.DISCORD_REDIRECT_URI!.trim(),
    sessionSecret: process.env.SESSION_SECRET!.trim(),
    frontendUrl: process.env.FRONTEND_URL!.trim().replace(/\/$/, ""),
    nodeEnv,
    cookieSecure,
    oauthCallbackVerboseLog,
    discordOAuthScopes: normalizeOAuthScopes(process.env.DISCORD_OAUTH_SCOPES),
    discordOAuthPrompt,
    discordUserProxyPrefixes: parseCommaSeparatedPrefixes(
      process.env.DISCORD_PROXY_USER_PREFIXES,
      DEFAULT_USER_PROXY_PREFIXES,
    ),
    discordBotProxyPrefixes: parseCommaSeparatedPrefixes(
      process.env.DISCORD_PROXY_BOT_PREFIXES,
      DEFAULT_BOT_PROXY_PREFIXES,
    ),
    discordBotToken,
    riotApiKey,
    /** Periodic League Riot sync; off unless `LEAGUE_AUTO_SYNC_ENABLED=1` (saves rate limit / Pi load). */
    leagueAutoSyncEnabled: truthyEnv("LEAGUE_AUTO_SYNC_ENABLED"),
    musicBotHttpUrl: process.env.MUSIC_BOT_HTTP_URL?.trim() || undefined,
    /** Shared secret sent as `X-Clanker-Secret` to the bot's HTTP server (must match the bot's BOT_HTTP_SECRET). */
    botHttpSecret: process.env.BOT_HTTP_SECRET?.trim() || undefined,
    discordHubAllowedGuildIds: parseSnowflakeList(
      process.env.DISCORD_HUB_ALLOWED_GUILD_IDS,
    ),
    discordHubEnforceGuildMembership: truthyEnv(
      "DISCORD_HUB_ENFORCE_GUILD_MEMBERSHIP",
    ),
    dbConfig: parseDbConfig(),
  };
}

export type AppEnv = ReturnType<typeof loadEnv>;
