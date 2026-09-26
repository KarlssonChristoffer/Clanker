import { config as loadDotenv } from "dotenv";
import { createAdaptorServer, type ServerType } from "@hono/node-server";
import { Hono, type Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { fetchGuildSummary } from "./bot-guild-summary.js";
import { assertBotGuildAccess } from "./bot-guild-access.js";
import { discordBotFetchJson, discordBotRequest } from "./discord-bot-fetch.js";
import {
  exchangeAuthorizationCode,
  fetchDiscordOAuth2Me,
  fetchDiscordUsersMe,
} from "./discord-rest.js";
import {
  proxyBotDiscordApi,
  proxyUserDiscordApi,
  resolveUserDiscordTokens,
  setOAuthCookiesAfterLogin,
} from "./discord-proxy.js";
import { DISCORD_OAUTH_TOKENS_COOKIE } from "./discord-tokens.js";
import { getBotGuildLive, getBotLiveHealth } from "./bot-live.js";
import { registerQuoteRoutes } from "./quotes.js";
import type { AppEnv } from "./env.js";
import { loadEnv } from "./env.js";
import { getPublicProfile, upsertProfileFromSession } from "./profile-store.js";
import {
  MATCH_V5_PUUID_IDS_HISTORY_CAP,
  RIOT_TYPICAL_DEV_APP_DELAY_MS,
  RiotApiError,
  fetchMatch,
  fetchMatchIdsForPlayer,
  fetchRankedEntries,
  getLeagueApiHosts,
  leagueRecentMatchForPuuid,
  queueTypeForRankPreference,
  resolvePuuid,
  type LeagueRankPreference,
  type LeagueRecentMatch,
  type LeagueRegion,
} from "./riot-lol.js";
import { runSqlMigrations } from "@clanker/hub-pg-migrate";
import { closeDb, getPool, initDb, verifyDbConnection } from "./db.js";
import {
  createWheelGroup,
  createWheelSession,
  deleteLeagueConnection,
  deleteLeagueSnapshot,
  deleteWheelGroup,
  getHubUserSettings,
  getKnownMatchIds,
  getLeagueConnection,
  getLeagueConnections,
  getLeagueRecentMatchesByMatchIds,
  getLeagueMatchesPage,
  getLeagueMatchStats,
  getAllLeagueSnapshots,
  deleteLeagueConnectionByAccount,
  deleteLeagueSnapshotByPuuid,
  getWheelGroup,
  listRecentWheelSessions,
  listWheelGroups,
  upsertHubUserSettings,
  upsertLeagueConnection,
  upsertLeagueSnapshot,
  saveLeagueMatches,
  saveLeagueRankHistory,
  updateWheelGroup,
} from "./repo.js";
import { COOKIE_NAME, verifySession, type SessionPayload } from "./session.js";
import { startWheelCollabServer } from "./wheel-collab.js";
import { startLeagueSyncScheduler } from "./league-auto-sync.js";

const STATE_COOKIE = "discord_oauth_state";
const STATE_MAX_AGE = 600;
const DISCORD_SNOWFLAKE_RE = /^\d{5,32}$/;

/** Max match-ID listing for POST /api/integrations/league/sync (Riot caps ~1000). */
const LEAGUE_MANUAL_SYNC_MAX_MATCH_IDS = Math.min(
  Math.max(
    1,
    Math.floor(
      Number(
        process.env.LEAGUE_MANUAL_SYNC_MATCH_MAX ??
          String(MATCH_V5_PUUID_IDS_HISTORY_CAP),
      ),
    ),
  ),
  MATCH_V5_PUUID_IDS_HISTORY_CAP,
);

/** How many newest matches to embed in the live snapshot / API response (full history stays in DB). */
const LEAGUE_SNAPSHOT_RECENT_MATCHES = Math.min(
  200,
  Math.max(5, Math.floor(Number(process.env.LEAGUE_SNAPSHOT_RECENT_MATCHES ?? "50"))),
);

/**
 * Pause between Riot calls during POST /api/integrations/league/sync only.
 * Default matches typical **application** limits (100 req / 2 min → ~1200 ms). Approved production
 * apps with higher app quotas can set `LEAGUE_MANUAL_RIOT_DELAY_MS` much lower (e.g. 50).
 */
const LEAGUE_MANUAL_RIOT_DELAY_MS = Math.max(
  0,
  Math.floor(
    Number(
      process.env.LEAGUE_MANUAL_RIOT_DELAY_MS ?? String(RIOT_TYPICAL_DEV_APP_DELAY_MS),
    ),
  ),
);

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type LeagueConnection = {
  riotId: string;
  tagLine: string;
  region: LeagueRegion;
  autoSync: boolean;
  rankPreference: LeagueRankPreference;
  statusMessage: string;
  linkedAt: string;
  lastSyncRequestedAt: string | null;
};

function discordAuthorizeUrl(env: AppEnv, state: string): string {
  const params = new URLSearchParams({
    client_id: env.discordClientId,
    redirect_uri: env.discordRedirectUri,
    response_type: "code",
    scope: env.discordOAuthScopes,
    state,
  });
  if (env.discordOAuthPrompt) {
    params.set("prompt", env.discordOAuthPrompt);
  }
  return `https://discord.com/oauth2/authorize?${params.toString()}`;
}

function extractProxySuffix(fullPath: string, mount: string): string | null {
  if (fullPath === mount || fullPath === `${mount}/`) {
    return "";
  }
  const withSlash = `${mount}/`;
  if (!fullPath.startsWith(withSlash)) {
    return null;
  }
  return fullPath.slice(withSlash.length);
}

function parseLeagueRegion(value: unknown): LeagueRegion | null {
  if (
    value === "EUW" ||
    value === "EUNE" ||
    value === "NA" ||
    value === "KR" ||
    value === "BR"
  ) {
    return value;
  }
  return null;
}

function parseLeaguePayload(raw: unknown): {
  riotId: string;
  tagLine: string;
  region: LeagueRegion;
  autoSync: boolean;
  rankPreference: LeagueRankPreference;
  statusMessage: string;
} | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const payload = raw as Record<string, unknown>;
  const riotId = typeof payload.riotId === "string" ? payload.riotId.trim() : "";
  const tagLine =
    typeof payload.tagLine === "string"
      ? payload.tagLine.trim().replace(/^#/, "")
      : "";
  const region = parseLeagueRegion(payload.region);
  const autoSync = payload.autoSync === true;
  const rankPreference = payload.rankPreference === "flex" ? "flex" : "solo";
  const statusMessage =
    typeof payload.statusMessage === "string" ? payload.statusMessage.trim() : "";

  if (!riotId || !tagLine || !region) {
    return null;
  }

  return {
    riotId,
    tagLine,
    region,
    autoSync,
    rankPreference,
    statusMessage,
  };
}

async function requireSession(
  env: AppEnv,
  token: string | undefined,
): Promise<SessionPayload | null> {
  if (!token) {
    return null;
  }
  return verifySession(env.sessionSecret, token);
}

function respondWithRiotError(c: Context, error: RiotApiError) {
  if (error.retryAfterSeconds !== null) {
    c.header("Retry-After", String(error.retryAfterSeconds));
  }

  if (error.code === "riot_account_not_found") {
    return c.json(
      {
        error:
          "Riot-kontot hittades inte. Kontrollera Riot ID, tagline och vald region.",
        code: error.code,
      },
      404,
    );
  }

  if (error.code === "riot_rate_limited") {
    return c.json(
      {
        error:
          "Riot API rate limit (429). Din **app** har ofta tak som 20/s och 100/2 min — då ska anrop spridas (standard ~1200 ms mellan varje). Vänta och synka igen; redan hämtade matcher sparas. Har du högre app-kvot (production): sänk LEAGUE_MANUAL_RIOT_DELAY_MS.",
        code: error.code,
      },
      429,
    );
  }

  if (error.code === "riot_auth_failed") {
    return c.json(
      {
        error:
          "Riot API-nyckeln är ogiltig eller har gått ut. Uppdatera RIOT_API_KEY.",
        code: error.code,
      },
      502,
    );
  }

  return c.json(
    {
      error: "Riot API svarade med ett oväntat fel under synk.",
      code: error.code,
    },
    502,
  );
}

/** Same ordering logic as discord-bot `reorderMusicQueue` (hub DB fallback when MUSIC_BOT_HTTP_URL unset). */
async function reorderMusicQueueDirect(guildId: string, orderedIds: number[]): Promise<boolean> {
  const pool = getPool();
  if (!pool) return false;
  if (orderedIds.length === 0) return true;
  const cur = await pool.query<{ id: number }>(
    `SELECT id FROM bot.music_queue WHERE guild_id = $1 ORDER BY added_at`,
    [guildId],
  );
  const currentIds = cur.rows.map((r) => r.id);
  if (currentIds.length !== orderedIds.length) return false;
  const setCur = new Set(currentIds);
  if (new Set(orderedIds).size !== orderedIds.length) return false;
  if (!orderedIds.every((id) => setCur.has(id))) return false;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const baseRes = await client.query<{ t: string }>(`SELECT clock_timestamp()::text AS t`);
    const base = baseRes.rows[0]?.t;
    if (!base) throw new Error("clock_timestamp failed");
    for (let i = 0; i < orderedIds.length; i++) {
      await client.query(
        `UPDATE bot.music_queue
         SET added_at = $1::timestamptz + ($2::bigint * interval '1 microsecond')
         WHERE id = $3 AND guild_id = $4`,
        [base, i, orderedIds[i], guildId],
      );
    }
    await client.query("COMMIT");
  } catch {
    await client.query("ROLLBACK");
    return false;
  } finally {
    client.release();
  }
  return true;
}

function createApp(env: AppEnv) {
  const app = new Hono();

  app.get("/api/auth/discord", (c) => {
    const state = randomBytes(32).toString("hex");
    setCookie(c, STATE_COOKIE, state, {
      path: "/",
      httpOnly: true,
      secure: env.cookieSecure,
      sameSite: "Lax",
      maxAge: STATE_MAX_AGE,
    });
    return c.redirect(discordAuthorizeUrl(env, state));
  });

  app.get("/api/auth/discord/callback", async (c) => {
    const code = c.req.query("code");
    const state = c.req.query("state");
    const err = c.req.query("error");
    const redirectFail = `${env.frontendUrl}/login?error=oauth`;

    if (err) {
      if (env.oauthCallbackVerboseLog) {
        console.error(
          "discord-hub-api: OAuth callback — Discord returned error query param:",
          err,
        );
      }
      deleteCookie(c, STATE_COOKIE, { path: "/" });
      return c.redirect(redirectFail);
    }

    const stored = getCookie(c, STATE_COOKIE);
    deleteCookie(c, STATE_COOKIE, { path: "/" });

    if (!code || !state || !stored || !timingSafeEqualString(stored, state)) {
      if (env.oauthCallbackVerboseLog) {
        console.error(
          "discord-hub-api: OAuth callback — state validation failed (CSRF or missing cookie).",
          "hint: DISCORD_REDIRECT_URI must match the portal exactly; over HTTP with NODE_ENV=production set COOKIE_SECURE=0.",
          {
            hasCode: Boolean(code),
            hasState: Boolean(state),
            hasStoredStateCookie: Boolean(stored),
            statesMatch:
              stored && state ? timingSafeEqualString(stored, state) : false,
          },
        );
      }
      return c.redirect(redirectFail);
    }

    try {
      const exchanged = await exchangeAuthorizationCode(env, code);
      const user = await fetchDiscordUsersMe(exchanged.access_token);
      const baseSession = {
        sub: user.id,
        username: user.username,
        avatar: user.avatar,
        global_name: user.global_name,
        banner: user.banner,
        accent_color: user.accent_color,
      };
      await upsertProfileFromSession(baseSession);
      await setOAuthCookiesAfterLogin(c, env, baseSession, exchanged);
      return c.redirect(`${env.frontendUrl}/dashboard`);
    } catch (e) {
      if (env.oauthCallbackVerboseLog) {
        console.error("discord-hub-api: OAuth callback — token or user fetch failed:", e);
      }
      return c.redirect(redirectFail);
    }
  });

  app.get("/api/auth/me", async (c) => {
    const session = await requireSession(env, getCookie(c, COOKIE_NAME));
    if (!session) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    const base = {
      id: session.sub,
      username: session.username,
      avatar: session.avatar,
      global_name: session.global_name,
      banner: session.banner,
      accent_color: session.accent_color,
    };
    await upsertProfileFromSession(session);

    const resolved = await resolveUserDiscordTokens(c, env, session);
    if (!resolved.ok) {
      return c.json({
        ...base,
        discord: {
          application: null,
          scopes: session.discordScopes ?? [],
          expires: session.discordAuthExpires ?? null,
          live: false,
        },
      });
    }

    try {
      const oauth = await fetchDiscordOAuth2Me(resolved.payload.access_token);
      return c.json({
        ...base,
        discord: {
          application: {
            id: oauth.application.id,
            name: oauth.application.name ?? "",
          },
          scopes: oauth.scopes,
          expires: oauth.expires,
          live: true,
        },
      });
    } catch {
      return c.json({
        ...base,
        discord: {
          application: null,
          scopes:
            session.discordScopes ??
            resolved.payload.scope.split(/\s+/).filter(Boolean),
          expires:
            session.discordAuthExpires ??
            new Date(resolved.payload.expires_at_ms).toISOString(),
          live: false,
        },
      });
    }
  });

  app.post("/api/auth/logout", (c) => {
    deleteCookie(c, COOKIE_NAME, { path: "/" });
    deleteCookie(c, DISCORD_OAUTH_TOKENS_COOKIE, { path: "/" });
    return c.body(null, 204);
  });

  const hubWidgetLayoutValueSchema = z.object({
    x: z.number(),
    y: z.number(),
    w: z.number(),
    h: z.number(),
    z: z.number(),
    hidden: z.boolean(),
  });

  const hubSettingsPayloadSchema = z
    .object({
      version: z.literal(1),
      prefs: z.unknown().optional(),
      desktopLayout: z.record(z.string(), hubWidgetLayoutValueSchema).optional(),
      layoutAutosaveEnabled: z.boolean().optional(),
    })
    .strict();

  const MAX_HUB_SETTINGS_BYTES = 400_000;

  app.get("/api/me/hub-settings", async (c) => {
    const session = await requireSession(env, getCookie(c, COOKIE_NAME));
    if (!session) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    if (!getPool()) {
      return c.json({
        available: false,
        settings: null,
        updatedAt: null,
      });
    }

    await upsertProfileFromSession(session);
    const row = await getHubUserSettings(session.sub);
    return c.json({
      available: true,
      settings: row?.payload ?? null,
      updatedAt: row?.updated_at ?? null,
    });
  });

  app.put("/api/me/hub-settings", async (c) => {
    const session = await requireSession(env, getCookie(c, COOKIE_NAME));
    if (!session) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    if (!getPool()) {
      return c.json(
        { error: "Database not configured", code: "db_unavailable" },
        503,
      );
    }

    let rawPayload: unknown;
    try {
      rawPayload = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON" }, 400);
    }

    const rawStr = JSON.stringify(rawPayload);
    if (rawStr.length > MAX_HUB_SETTINGS_BYTES) {
      return c.json({ error: "Payload too large", code: "payload_too_large" }, 413);
    }

    const parsed = hubSettingsPayloadSchema.safeParse(rawPayload);
    if (!parsed.success) {
      return c.json({ error: "Invalid hub settings payload", code: "invalid_payload" }, 400);
    }

    await upsertProfileFromSession(session);

    try {
      const updatedAt = await upsertHubUserSettings(session.sub, parsed.data);
      return c.json({ ok: true, updatedAt });
    } catch (error) {
      if (error instanceof Error && error.message === "database_unavailable") {
        return c.json(
          { error: "Database not configured", code: "db_unavailable" },
          503,
        );
      }
      throw error;
    }
  });

  const WheelParticipant = z.string().trim().min(1).max(48);
  const WheelParticipants = z.array(WheelParticipant).min(1).max(64);

  function normalizeWheelParticipants(list: string[]): string[] {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const raw of list) {
      const name = raw.trim();
      if (!name) continue;
      const key = name.toLocaleLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(name);
      if (out.length >= 64) break;
    }
    return out;
  }

  app.get("/api/wheel/groups", async (c) => {
    const session = await requireSession(env, getCookie(c, COOKIE_NAME));
    if (!session) return c.json({ error: "Unauthorized" }, 401);
    await upsertProfileFromSession(session);

    const groups = await listWheelGroups(session.sub);
    return c.json({
      groups: groups.map((g) => ({
        id: g.id,
        name: g.name,
        participants: Array.isArray(g.participants) ? (g.participants as string[]) : [],
        createdAt: g.created_at,
        updatedAt: g.updated_at,
      })),
    });
  });

  app.get("/api/wheel/groups/:id", async (c) => {
    const session = await requireSession(env, getCookie(c, COOKIE_NAME));
    if (!session) return c.json({ error: "Unauthorized" }, 401);
    await upsertProfileFromSession(session);

    const id = c.req.param("id");
    if (!id || id.length > 64) return c.json({ error: "Invalid id" }, 400);
    const group = await getWheelGroup(session.sub, id);
    if (!group) return c.json({ error: "Not found" }, 404);

    return c.json({
      group: {
        id: group.id,
        name: group.name,
        participants: Array.isArray(group.participants)
          ? (group.participants as string[])
          : [],
        createdAt: group.created_at,
        updatedAt: group.updated_at,
      },
    });
  });

  app.post("/api/wheel/groups", async (c) => {
    const session = await requireSession(env, getCookie(c, COOKIE_NAME));
    if (!session) return c.json({ error: "Unauthorized" }, 401);
    await upsertProfileFromSession(session);

    let rawPayload: unknown;
    try {
      rawPayload = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON" }, 400);
    }

    const schema = z.object({
      name: z.string().trim().min(1).max(64),
      participants: WheelParticipants,
    });

    const parsed = schema.safeParse(rawPayload);
    if (!parsed.success) {
      return c.json({ error: "Invalid payload" }, 400);
    }

    const id = randomUUID();
    const participants = normalizeWheelParticipants(parsed.data.participants);
    if (participants.length === 0) return c.json({ error: "No participants" }, 400);

    await createWheelGroup({
      id,
      ownerUserId: session.sub,
      name: parsed.data.name,
      participants,
    });

    return c.json({ id }, 201);
  });

  app.put("/api/wheel/groups/:id", async (c) => {
    const session = await requireSession(env, getCookie(c, COOKIE_NAME));
    if (!session) return c.json({ error: "Unauthorized" }, 401);
    await upsertProfileFromSession(session);

    const id = c.req.param("id");
    if (!id || id.length > 64) return c.json({ error: "Invalid id" }, 400);

    let rawPayload: unknown;
    try {
      rawPayload = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON" }, 400);
    }

    const schema = z.object({
      name: z.string().trim().min(1).max(64),
      participants: WheelParticipants,
    });
    const parsed = schema.safeParse(rawPayload);
    if (!parsed.success) return c.json({ error: "Invalid payload" }, 400);

    const participants = normalizeWheelParticipants(parsed.data.participants);
    if (participants.length === 0) return c.json({ error: "No participants" }, 400);

    const ok = await updateWheelGroup({
      id,
      ownerUserId: session.sub,
      name: parsed.data.name,
      participants,
    });
    if (!ok) return c.json({ error: "Not found" }, 404);
    return c.body(null, 204);
  });

  app.delete("/api/wheel/groups/:id", async (c) => {
    const session = await requireSession(env, getCookie(c, COOKIE_NAME));
    if (!session) return c.json({ error: "Unauthorized" }, 401);
    await upsertProfileFromSession(session);

    const id = c.req.param("id");
    if (!id || id.length > 64) return c.json({ error: "Invalid id" }, 400);
    const ok = await deleteWheelGroup(session.sub, id);
    if (!ok) return c.json({ error: "Not found" }, 404);
    return c.body(null, 204);
  });

  app.get("/api/wheel/sessions/recent", async (c) => {
    const session = await requireSession(env, getCookie(c, COOKIE_NAME));
    if (!session) return c.json({ error: "Unauthorized" }, 401);
    await upsertProfileFromSession(session);

    const limitRaw = c.req.query("limit");
    const limit = limitRaw ? Number(limitRaw) : 12;
    const sessions = await listRecentWheelSessions(session.sub, Number.isFinite(limit) ? limit : 12);
    return c.json({
      sessions: sessions.map((s) => ({
        id: s.id,
        groupId: s.group_id,
        seed: s.seed,
        teamCount: s.team_count,
        teamMode: s.team_mode,
        participants: Array.isArray(s.participants) ? (s.participants as string[]) : [],
        winner: s.winner,
        teams: Array.isArray(s.teams) ? (s.teams as string[][]) : [],
        createdAt: s.created_at,
      })),
    });
  });

  app.post("/api/wheel/sessions", async (c) => {
    const session = await requireSession(env, getCookie(c, COOKIE_NAME));
    if (!session) return c.json({ error: "Unauthorized" }, 401);
    await upsertProfileFromSession(session);

    let rawPayload: unknown;
    try {
      rawPayload = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON" }, 400);
    }

    const schema = z.object({
      groupId: z.string().trim().min(8).max(64).nullable().optional(),
      seed: z.string().trim().min(1).max(128).nullable().optional(),
      teamCount: z.number().int().min(1).max(16),
      teamMode: z.enum(["balanced", "equal"]),
      participants: WheelParticipants,
      winner: z.string().trim().min(1).max(48).nullable().optional(),
      teams: z.array(z.array(WheelParticipant)).min(1).max(16),
    });

    const parsed = schema.safeParse(rawPayload);
    if (!parsed.success) return c.json({ error: "Invalid payload" }, 400);

    const participants = normalizeWheelParticipants(parsed.data.participants);
    if (participants.length === 0) return c.json({ error: "No participants" }, 400);

    const normalizedTeams = parsed.data.teams
      .map((t) => normalizeWheelParticipants(t))
      .slice(0, parsed.data.teamCount);

    const flattened = normalizedTeams.flat();
    const participantKey = new Set(participants.map((p) => p.toLocaleLowerCase()));
    const uniqueTeamKey = new Set<string>();

    for (const p of flattened) {
      const k = p.toLocaleLowerCase();
      if (!participantKey.has(k)) {
        return c.json({ error: "Teams contain unknown participants" }, 400);
      }
      if (uniqueTeamKey.has(k)) {
        return c.json({ error: "Teams contain duplicates" }, 400);
      }
      uniqueTeamKey.add(k);
    }

    if (uniqueTeamKey.size !== participantKey.size) {
      return c.json({ error: "Teams do not cover all participants" }, 400);
    }

    const winner = parsed.data.winner?.trim() ? parsed.data.winner.trim() : null;
    if (winner) {
      const wk = winner.toLocaleLowerCase();
      if (!participantKey.has(wk)) return c.json({ error: "Winner not in participants" }, 400);
    }

    const id = randomUUID();
    await createWheelSession({
      id,
      ownerUserId: session.sub,
      groupId: parsed.data.groupId ?? null,
      seed: parsed.data.seed ?? null,
      teamCount: parsed.data.teamCount,
      teamMode: parsed.data.teamMode,
      participants,
      winner,
      teams: normalizedTeams,
    });

    return c.json({ id }, 201);
  });

  app.get("/api/integrations/league/status", async (c) => {
    const session = await requireSession(env, getCookie(c, COOKIE_NAME));
    if (!session) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    const dbConns = await getLeagueConnections(session.sub);
    const snapshots = await getAllLeagueSnapshots(session.sub);
    const snapshotByPuuid = new Map(snapshots.map((s) => [s.account.puuid, s]));

    const accounts = dbConns.map((dbConn) => ({
      riotId: dbConn.riot_id,
      tagLine: dbConn.tag_line,
      region: dbConn.region,
      autoSync: dbConn.auto_sync,
      rankPreference: dbConn.rank_preference,
      statusMessage: dbConn.status_message,
      linkedAt: dbConn.linked_at,
      lastSyncRequestedAt: dbConn.last_sync_requested_at,
      puuid: dbConn.puuid,
      sync: dbConn.puuid ? (snapshotByPuuid.get(dbConn.puuid) ?? null) : null,
    }));

    return c.json({ connected: accounts.length > 0, accounts });
  });

  app.post("/api/integrations/league/connect", async (c) => {
    const session = await requireSession(env, getCookie(c, COOKIE_NAME));
    if (!session) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    let rawPayload: unknown;
    try {
      rawPayload = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON" }, 400);
    }

    const parsed = parseLeaguePayload(rawPayload);
    if (!parsed) {
      return c.json(
        {
          error:
            "Ogiltig payload. Kräver riotId, tagLine och region (EUW/EUNE/NA/KR/BR).",
        },
        400,
      );
    }

    const connection: LeagueConnection = {
      ...parsed,
      linkedAt: new Date().toISOString(),
      lastSyncRequestedAt: null,
    };

    await upsertProfileFromSession(session);
    await upsertLeagueConnection(session.sub, {
      riot_id: connection.riotId,
      tag_line: connection.tagLine,
      region: connection.region,
      auto_sync: connection.autoSync,
      rank_preference: connection.rankPreference,
      status_message: connection.statusMessage,
      linked_at: connection.linkedAt,
      last_sync_requested_at: connection.lastSyncRequestedAt,
      puuid: null,
    });
    // Do NOT delete snapshots for other accounts

    return c.json({
      connected: true,
      accounts: [{ ...connection, puuid: null, sync: null }],
      message: "League-koppling sparad. Kontot är redo att synkas via Riot API.",
    });
  });

  app.post("/api/integrations/league/sync", async (c) => {
    const session = await requireSession(env, getCookie(c, COOKIE_NAME));
    if (!session) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    // Optional body: { riotId, tagLine } to sync a specific account.
    // If omitted, sync the first linked account.
    let targetRiotId: string | undefined;
    let targetTagLine: string | undefined;
    try {
      const body = await c.req.json<{ riotId?: string; tagLine?: string }>();
      targetRiotId = body.riotId;
      targetTagLine = body.tagLine;
    } catch {
      // no body — that's fine
    }

    let dbConn;
    if (targetRiotId && targetTagLine) {
      const all = await getLeagueConnections(session.sub);
      dbConn = all.find(
        (c) => c.riot_id === targetRiotId && c.tag_line === targetTagLine,
      ) ?? null;
    } else {
      dbConn = await getLeagueConnection(session.sub);
    }

    if (!dbConn) {
      return c.json({ error: "No linked League account" }, 404);
    }

    if (!env.riotApiKey) {
      return c.json(
        {
          error: "RIOT_API_KEY saknas i backend-miljön. Lägg till den innan du kör synk.",
          code: "riot_api_key_missing",
        },
        503,
      );
    }

    const nowIso = new Date().toISOString();
    await upsertProfileFromSession(session);
    await upsertLeagueConnection(session.sub, {
      riot_id: dbConn.riot_id,
      tag_line: dbConn.tag_line,
      region: dbConn.region,
      auto_sync: dbConn.auto_sync,
      rank_preference: dbConn.rank_preference,
      status_message: dbConn.status_message,
      linked_at: dbConn.linked_at,
      last_sync_requested_at: nowIso,
      puuid: dbConn.puuid,
    });

    try {
      const hosts = getLeagueApiHosts(dbConn.region);
      const rankPreference = dbConn.rank_preference as LeagueRankPreference;
      const participantLabel = `${dbConn.riot_id}#${dbConn.tag_line}`;
      const d = LEAGUE_MANUAL_RIOT_DELAY_MS;

      const account = await resolvePuuid(
        env.riotApiKey,
        hosts.regionalBaseUrl,
        dbConn.riot_id,
        dbConn.tag_line,
      );
      if (d > 0) await sleepMs(d);

      const leagueEntries = await fetchRankedEntries(
        env.riotApiKey,
        hosts.platformBaseUrl,
        account.puuid,
      );
      if (d > 0) await sleepMs(d);

      const matchIds = await fetchMatchIdsForPlayer({
        apiKey: env.riotApiKey,
        regionalBaseUrl: hosts.regionalBaseUrl,
        puuid: account.puuid,
        maxTotal: LEAGUE_MANUAL_SYNC_MAX_MATCH_IDS,
        delayBetweenPagesMs: d,
      });

      const known = await getKnownMatchIds(session.sub, account.puuid, matchIds);
      const newRows: LeagueRecentMatch[] = [];
      for (const matchId of matchIds) {
        if (known.has(matchId)) continue;
        if (d > 0) await sleepMs(d);
        const rawMatch = await fetchMatch(
          env.riotApiKey,
          hosts.regionalBaseUrl,
          matchId,
        );
        const row = leagueRecentMatchForPuuid(rawMatch, account.puuid);
        if (row) newRows.push(row);
      }

      await saveLeagueMatches(session.sub, account.puuid, newRows);

      const preferredRank =
        leagueEntries.find(
          (entry) => entry.queueType === queueTypeForRankPreference(rankPreference),
        ) ?? null;

      const recentIds = matchIds.slice(0, LEAGUE_SNAPSHOT_RECENT_MATCHES);
      const freshById = new Map(newRows.map((m) => [m.matchId, m]));
      const missingForSnapshot = recentIds.filter((id) => !freshById.has(id));
      const fromDb =
        missingForSnapshot.length > 0
          ? await getLeagueRecentMatchesByMatchIds(
              session.sub,
              account.puuid,
              missingForSnapshot,
              participantLabel,
            )
          : new Map<string, LeagueRecentMatch>();

      const recentMatches: LeagueRecentMatch[] = [];
      for (const id of recentIds) {
        const row = freshById.get(id) ?? fromDb.get(id);
        if (row) recentMatches.push(row);
      }

      const sync = {
        fetchedAt: new Date().toISOString(),
        account,
        rankPreference,
        preferredRank,
        leagueEntries,
        recentMatches,
      };

      await upsertLeagueConnection(session.sub, {
        riot_id: dbConn.riot_id,
        tag_line: dbConn.tag_line,
        region: dbConn.region,
        auto_sync: dbConn.auto_sync,
        rank_preference: dbConn.rank_preference,
        status_message: dbConn.status_message,
        linked_at: dbConn.linked_at,
        last_sync_requested_at: nowIso,
        puuid: sync.account.puuid,
      });

      await upsertLeagueSnapshot(session.sub, sync);
      await saveLeagueRankHistory(session.sub, sync.account.puuid, sync.leagueEntries);

      return c.json({
        connected: true,
        sync,
        message: `Synk klar. ${matchIds.length} match-ID:n i Riots historik; ${newRows.length} nya match(er) hämtade (översikten visar de ${recentMatches.length} senaste).`,
      });
    } catch (error) {
      if (error instanceof RiotApiError) {
        return respondWithRiotError(c, error);
      }
      console.error("League sync failed", error);
      return c.json({ error: "Okänt fel vid League-synk.", code: "league_sync_failed" }, 500);
    }
  });

  app.get("/api/stats/league", async (c) => {
    const session = await requireSession(env, getCookie(c, COOKIE_NAME));
    if (!session) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    const puuid = c.req.query("puuid");
    if (!puuid) {
      return c.json({ error: "puuid query param required" }, 400);
    }
    const stats = await getLeagueMatchStats(session.sub, puuid);
    if (!stats || stats.totalGames === 0) {
      return c.json({ available: false });
    }
    return c.json({ available: true, ...stats });
  });

  app.get("/api/stats/league/matches", async (c) => {
    const session = await requireSession(env, getCookie(c, COOKIE_NAME));
    if (!session) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    const puuid = c.req.query("puuid");
    if (!puuid) {
      return c.json({ error: "puuid query param required" }, 400);
    }
    const linked = await getLeagueConnections(session.sub);
    if (!linked.some((row) => row.puuid === puuid)) {
      return c.json({ error: "Forbidden", code: "league_puuid_not_linked" }, 403);
    }

    const limitRaw = Number(c.req.query("limit") ?? "25");
    const offsetRaw = Number(c.req.query("offset") ?? "0");
    const limit = Math.min(100, Math.max(1, Math.floor(Number.isFinite(limitRaw) ? limitRaw : 25)));
    const offset = Math.max(0, Math.floor(Number.isFinite(offsetRaw) ? offsetRaw : 0));

    const page = await getLeagueMatchesPage(session.sub, puuid, offset, limit);
    if (!page) {
      return c.json({ error: "Database unavailable" }, 503);
    }
    return c.json(page);
  });

  app.post("/api/integrations/league/disconnect", async (c) => {
    const session = await requireSession(env, getCookie(c, COOKIE_NAME));
    if (!session) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    // Disconnect a specific account by riotId + tagLine
    let riotId: string | undefined;
    let tagLine: string | undefined;
    try {
      const body = await c.req.json<{ riotId?: string; tagLine?: string }>();
      riotId = body.riotId;
      tagLine = body.tagLine;
    } catch {
      // no body
    }

    await upsertProfileFromSession(session);

    if (riotId && tagLine) {
      // Find the puuid of this account so we can delete its snapshot
      const all = await getLeagueConnections(session.sub);
      const target = all.find((c) => c.riot_id === riotId && c.tag_line === tagLine);
      await deleteLeagueConnectionByAccount(session.sub, riotId, tagLine);
      if (target?.puuid) {
        await deleteLeagueSnapshotByPuuid(session.sub, target.puuid);
      }
    } else {
      // Disconnect all (backward compat)
      await deleteLeagueConnection(session.sub);
      await deleteLeagueSnapshot(session.sub);
    }

    const remaining = await getLeagueConnections(session.sub);
    return c.json({ connected: remaining.length > 0 });
  });

  app.get("/api/public/profile/:userId", async (c) => {
    const userId = c.req.param("userId");
    if (!DISCORD_SNOWFLAKE_RE.test(userId)) {
      return c.json({ error: "Invalid user id", code: "invalid_user_id" }, 400);
    }

    const profile = await getPublicProfile(userId);
    if (!profile) {
      return c.json({ error: "Profile not found", code: "profile_not_found" }, 404);
    }

    return c.json(profile);
  });

  app.all("/api/discord/*", async (c) => {
    const token = getCookie(c, COOKIE_NAME);
    if (!token) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    const session = await verifySession(env.sessionSecret, token);
    if (!session) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    const star = extractProxySuffix(c.req.path, "/api/discord");
    if (star === null || star === "") {
      return c.json({ error: "Missing path" }, 400);
    }
    return proxyUserDiscordApi(c, env, session, star);
  });

  app.all("/api/bot/discord/*", async (c) => {
    const token = getCookie(c, COOKIE_NAME);
    if (!token) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    const session = await verifySession(env.sessionSecret, token);
    if (!session) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    const star = extractProxySuffix(c.req.path, "/api/bot/discord");
    if (star === null || star === "") {
      return c.json({ error: "Missing path" }, 400);
    }
    return proxyBotDiscordApi(c, env, star);
  });

  app.get("/api/bot/guild/:id/summary", async (c) => {
    const token = getCookie(c, COOKIE_NAME);
    if (!token) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    const session = await verifySession(env.sessionSecret, token);
    if (!session) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    const guildId = c.req.param("id");
    if (!DISCORD_SNOWFLAKE_RE.test(guildId)) {
      return c.json({ error: "Invalid guild id", code: "invalid_guild_id" }, 400);
    }
    const access = await assertBotGuildAccess(env, session.sub, guildId);
    if (!access.ok) {
      return c.json(access.body, access.status);
    }
    const r = await fetchGuildSummary(env.discordBotToken!, guildId);
    if (!r.ok) {
      const e = r.error;
      const status =
        e.status === 404 ? 404 : e.status === 403 ? 403 : e.status === 504 ? 504 : 502;
      return c.json({ error: e.message, code: e.code }, status);
    }
    return c.json(r.summary);
  });

  registerQuoteRoutes(app, env);

  app.get("/api/bot/live/health", async (c) => {
    const token = getCookie(c, COOKIE_NAME);
    if (!token) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    const session = await verifySession(env.sessionSecret, token);
    if (!session) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    return c.json(await getBotLiveHealth(getPool()));
  });

  app.get("/api/bot/live/guild/:id", async (c) => {
    const token = getCookie(c, COOKIE_NAME);
    if (!token) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    const session = await verifySession(env.sessionSecret, token);
    if (!session) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    const guildId = c.req.param("id");
    if (!DISCORD_SNOWFLAKE_RE.test(guildId)) {
      return c.json({ error: "Invalid guild id", code: "invalid_guild_id" }, 400);
    }
    const access = await assertBotGuildAccess(env, session.sub, guildId);
    if (!access.ok) {
      return c.json(access.body, access.status);
    }
    return c.json(await getBotGuildLive(getPool(), guildId));
  });

  app.get("/api/bot/guild/:id/voice-states", async (c) => {
    const token = getCookie(c, COOKIE_NAME);
    if (!token) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    const session = await verifySession(env.sessionSecret, token);
    if (!session) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    const guildId = c.req.param("id");
    if (!DISCORD_SNOWFLAKE_RE.test(guildId)) {
      return c.json({ error: "Invalid guild id", code: "invalid_guild_id" }, 400);
    }
    const access = await assertBotGuildAccess(env, session.sub, guildId);
    if (!access.ok) {
      return c.json(access.body, access.status);
    }
    const pool = getPool();
    if (!pool) {
      return c.json({ error: "Database not available" }, 503);
    }
    type VoiceStateRow = {
      user_id: string;
      channel_id: string;
      channel_name: string | null;
      username: string;
      global_name: string | null;
      nick: string | null;
      avatar: string | null;
      is_muted: boolean;
      is_deafened: boolean;
      is_streaming: boolean;
      is_video: boolean;
      joined_at: string;
      updated_at: string;
    };
    const result = await pool.query<VoiceStateRow>(
      `SELECT user_id, channel_id, channel_name, username, global_name, nick,
              avatar, is_muted, is_deafened, is_streaming, is_video,
              joined_at, updated_at
       FROM bot.guild_voice_states
       WHERE guild_id = $1
       ORDER BY channel_id, joined_at`,
      [guildId],
    );
    type Channel = { channel_id: string; channel_name: string | null; members: VoiceStateRow[] };
    const channelMap = new Map<string, Channel>();
    for (const row of result.rows) {
      let ch = channelMap.get(row.channel_id);
      if (!ch) {
        ch = { channel_id: row.channel_id, channel_name: row.channel_name, members: [] };
        channelMap.set(row.channel_id, ch);
      }
      ch.members.push(row);
    }
    return c.json({
      guild_id: guildId,
      channels: [...channelMap.values()],
      total_users: result.rowCount ?? 0,
    });
  });

  // Move a user between voice channels (e.g. for League custom game team sorting)
  app.post("/api/bot/guild/:id/voice-move", async (c) => {
    const token = getCookie(c, COOKIE_NAME);
    if (!token) return c.json({ error: "Unauthorized" }, 401);
    const session = await verifySession(env.sessionSecret, token);
    if (!session) return c.json({ error: "Unauthorized" }, 401);

    const guildId = c.req.param("id");
    if (!DISCORD_SNOWFLAKE_RE.test(guildId)) {
      return c.json({ error: "Invalid guild id" }, 400);
    }
    const access = await assertBotGuildAccess(env, session.sub, guildId);
    if (!access.ok) return c.json(access.body, access.status);

    if (!env.discordBotToken) {
      return c.json({ error: "Bot token not configured" }, 503);
    }

    let body: { userId?: unknown; direction?: unknown };
    try {
      body = await c.req.json<{ userId?: unknown; direction?: unknown }>();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }

    if (typeof body.userId !== "string" || !DISCORD_SNOWFLAKE_RE.test(body.userId)) {
      return c.json({ error: "Invalid userId" }, 400);
    }
    const userId = body.userId;
    const direction = body.direction === "up" ? "up" : "down";

    const pool = getPool();
    if (!pool) return c.json({ error: "Database not available" }, 503);

    type VoiceRow = { channel_id: string };
    const voiceRes = await pool.query<VoiceRow>(
      `SELECT channel_id FROM bot.guild_voice_states WHERE guild_id = $1 AND user_id = $2`,
      [guildId, userId],
    );
    if (!voiceRes.rows.length) {
      return c.json({ error: "User not in a voice channel" }, 404);
    }
    const currentChannelId = voiceRes.rows[0]!.channel_id;

    type DiscordChannel = { id: string; type: number; position: number; name: string };
    const channelsResult = await discordBotFetchJson<DiscordChannel[]>(
      env.discordBotToken,
      `/guilds/${guildId}/channels`,
    );
    if (!channelsResult.ok) {
      return c.json({ error: channelsResult.error.message }, channelsResult.error.status as 400 | 403 | 502 | 503);
    }

    // Type 2 = voice, 13 = stage (both support member moves via channel_id)
    const voiceChannels = channelsResult.data
      .filter((ch) => ch.type === 2 || ch.type === 13)
      .sort((a, b) => a.position - b.position);

    const currentIdx = voiceChannels.findIndex((ch) => ch.id === currentChannelId);
    if (currentIdx === -1) {
      return c.json({ error: "Current channel not found among voice channels" }, 404);
    }

    const targetIdx = direction === "down" ? currentIdx + 1 : currentIdx - 1;
    if (targetIdx < 0 || targetIdx >= voiceChannels.length) {
      return c.json({ error: "No channel in that direction" }, 400);
    }

    const targetChannel = voiceChannels[targetIdx]!;
    const moveResult = await discordBotRequest(
      env.discordBotToken,
      `/guilds/${guildId}/members/${userId}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ channel_id: targetChannel.id }),
      },
    );
    if (!moveResult.ok) {
      return c.json({ error: moveResult.error.message }, moveResult.error.status as 400 | 403 | 404 | 502);
    }

    return c.json({ ok: true, targetChannelId: targetChannel.id, targetChannelName: targetChannel.name });
  });

  // --- Music endpoints ---

  function musicBotBaseUrl(): string {
    return (env.musicBotHttpUrl ?? "").trim().replace(/\/$/, "");
  }

  /** fetch() against the bot's HTTP server with the shared-secret header and a timeout. */
  function botFetch(url: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    if (env.botHttpSecret) {
      headers.set("X-Clanker-Secret", env.botHttpSecret);
    }
    return fetch(url, { ...init, headers, signal: init.signal ?? AbortSignal.timeout(15_000) });
  }

  async function requireMusicBotUrl(c: Context): Promise<string | null> {
    if (!env.musicBotHttpUrl) {
      c.json({ error: "Music bot not configured" }, 503);
      return null;
    }
    return musicBotBaseUrl();
  }

  app.get("/api/bot/guild/:id/music", async (c) => {
    const token = getCookie(c, COOKIE_NAME);
    if (!token) return c.json({ error: "Unauthorized" }, 401);
    const session = await verifySession(env.sessionSecret, token);
    if (!session) return c.json({ error: "Unauthorized" }, 401);
    const guildId = c.req.param("id");
    if (!DISCORD_SNOWFLAKE_RE.test(guildId)) {
      return c.json({ error: "Invalid guild id", code: "invalid_guild_id" }, 400);
    }
    const access = await assertBotGuildAccess(env, session.sub, guildId);
    if (!access.ok) return c.json(access.body, access.status);

    const botBase = musicBotBaseUrl();
    if (botBase) {
      try {
        const res = await botFetch(
          `${botBase}/music/state?guildId=${encodeURIComponent(guildId)}`,
        );
        const json = (await res.json()) as Record<string, unknown>;
        if (!res.ok) {
          return c.json(json, res.status as 400 | 404 | 503);
        }
        return c.json(json);
      } catch {
        return c.json({ error: "Music bot unreachable" }, 503);
      }
    }

    const pool = getPool();
    if (!pool) return c.json({ error: "Database not available" }, 503);

    const [nowRes, queueRes] = await Promise.all([
      pool.query(
        `SELECT guild_id, track_url, title, artist, thumbnail, duration_sec, source,
                requested_by, channel_id, is_paused, started_at, updated_at
         FROM bot.music_now_playing WHERE guild_id = $1`,
        [guildId],
      ),
      pool.query(
        `SELECT id, track_url, title, artist, thumbnail, duration_sec, source,
                requested_by, added_at
         FROM bot.music_queue WHERE guild_id = $1 ORDER BY added_at`,
        [guildId],
      ),
    ]);

    return c.json({
      now_playing: nowRes.rows[0] ?? null,
      queue: queueRes.rows,
      total_in_queue: queueRes.rowCount ?? 0,
    });
  });

  async function proxyMusicCommand(
    c: Context,
    botUrl: string,
    path: string,
    body: Record<string, unknown>,
  ) {
    try {
      const res = await botFetch(`${botUrl}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      return c.json(json, res.ok ? 200 : (res.status as 400 | 422 | 503));
    } catch {
      return c.json({ error: "Music bot unreachable" }, 503);
    }
  }

  app.post("/api/bot/guild/:id/music/play", async (c) => {
    const token = getCookie(c, COOKIE_NAME);
    if (!token) return c.json({ error: "Unauthorized" }, 401);
    const session = await verifySession(env.sessionSecret, token);
    if (!session) return c.json({ error: "Unauthorized" }, 401);
    const guildId = c.req.param("id");
    if (!DISCORD_SNOWFLAKE_RE.test(guildId)) {
      return c.json({ error: "Invalid guild id", code: "invalid_guild_id" }, 400);
    }
    const access = await assertBotGuildAccess(env, session.sub, guildId);
    if (!access.ok) return c.json(access.body, access.status);
    const botUrl = await requireMusicBotUrl(c);
    if (!botUrl) return;
    const body = await c.req.json<{ query: string; channelId?: string }>();
    return proxyMusicCommand(c, botUrl, "/play", {
      guildId,
      channelId: body.channelId ?? "",
      userId: session.sub,
      query: body.query,
    });
  });

  for (const action of ["skip", "previous", "shuffle", "pause", "resume", "stop"] as const) {
    app.post(`/api/bot/guild/:id/music/${action}`, async (c) => {
      const token = getCookie(c, COOKIE_NAME);
      if (!token) return c.json({ error: "Unauthorized" }, 401);
      const session = await verifySession(env.sessionSecret, token);
      if (!session) return c.json({ error: "Unauthorized" }, 401);
      const guildId = c.req.param("id");
      if (!DISCORD_SNOWFLAKE_RE.test(guildId)) {
        return c.json({ error: "Invalid guild id", code: "invalid_guild_id" }, 400);
      }
      const access = await assertBotGuildAccess(env, session.sub, guildId);
      if (!access.ok) return c.json(access.body, access.status);
      const botUrl = await requireMusicBotUrl(c);
      if (!botUrl) return;
      return proxyMusicCommand(c, botUrl, `/${action}`, { guildId });
    });
  }

  app.post("/api/bot/guild/:id/music/seek", async (c) => {
    const token = getCookie(c, COOKIE_NAME);
    if (!token) return c.json({ error: "Unauthorized" }, 401);
    const session = await verifySession(env.sessionSecret, token);
    if (!session) return c.json({ error: "Unauthorized" }, 401);
    const guildId = c.req.param("id");
    if (!DISCORD_SNOWFLAKE_RE.test(guildId)) {
      return c.json({ error: "Invalid guild id", code: "invalid_guild_id" }, 400);
    }
    const access = await assertBotGuildAccess(env, session.sub, guildId);
    if (!access.ok) return c.json(access.body, access.status);
    const botUrl = await requireMusicBotUrl(c);
    if (!botUrl) return;
    const body = await c.req.json<{ seekSec: number }>();
    return proxyMusicCommand(c, botUrl, "/seek", { guildId, seekSec: body.seekSec });
  });

  // --- Playlist endpoints ---

  app.get("/api/bot/guild/:id/playlists", async (c) => {
    const token = getCookie(c, COOKIE_NAME);
    if (!token) return c.json({ error: "Unauthorized" }, 401);
    const session = await verifySession(env.sessionSecret, token);
    if (!session) return c.json({ error: "Unauthorized" }, 401);
    const guildId = c.req.param("id");
    if (!DISCORD_SNOWFLAKE_RE.test(guildId)) return c.json({ error: "Invalid guild id" }, 400);
    const access = await assertBotGuildAccess(env, session.sub, guildId);
    if (!access.ok) return c.json(access.body, access.status);
    const pool = getPool();
    if (!pool) return c.json({ error: "Database not available" }, 503);
    const res = await pool.query(
      `SELECT p.id, p.name, p.created_by, COUNT(t.id)::int AS track_count
       FROM bot.playlists p
       LEFT JOIN bot.playlist_tracks t ON t.playlist_id = p.id
       WHERE p.guild_id = $1
       GROUP BY p.id ORDER BY p.name`,
      [guildId],
    );
    return c.json({ playlists: res.rows });
  });

  app.post("/api/bot/guild/:id/playlists", async (c) => {
    const token = getCookie(c, COOKIE_NAME);
    if (!token) return c.json({ error: "Unauthorized" }, 401);
    const session = await verifySession(env.sessionSecret, token);
    if (!session) return c.json({ error: "Unauthorized" }, 401);
    const guildId = c.req.param("id");
    if (!DISCORD_SNOWFLAKE_RE.test(guildId)) return c.json({ error: "Invalid guild id" }, 400);
    const access = await assertBotGuildAccess(env, session.sub, guildId);
    if (!access.ok) return c.json(access.body, access.status);
    const pool = getPool();
    if (!pool) return c.json({ error: "Database not available" }, 503);
    const { name } = await c.req.json<{ name: string }>();
    if (!name?.trim()) return c.json({ error: "Name required" }, 400);
    try {
      const res = await pool.query(
        `INSERT INTO bot.playlists (guild_id, name, created_by) VALUES ($1, $2, $3) RETURNING id, name`,
        [guildId, name.trim(), session.sub],
      );
      return c.json({ ok: true, playlist: res.rows[0] });
    } catch (err: unknown) {
      if ((err as { code?: string }).code === "23505") return c.json({ error: "Name already exists" }, 409);
      throw err;
    }
  });

  app.delete("/api/bot/guild/:id/playlists/:name", async (c) => {
    const token = getCookie(c, COOKIE_NAME);
    if (!token) return c.json({ error: "Unauthorized" }, 401);
    const session = await verifySession(env.sessionSecret, token);
    if (!session) return c.json({ error: "Unauthorized" }, 401);
    const guildId = c.req.param("id");
    if (!DISCORD_SNOWFLAKE_RE.test(guildId)) return c.json({ error: "Invalid guild id" }, 400);
    const access = await assertBotGuildAccess(env, session.sub, guildId);
    if (!access.ok) return c.json(access.body, access.status);
    const pool = getPool();
    if (!pool) return c.json({ error: "Database not available" }, 503);
    const playlistName = decodeURIComponent(c.req.param("name"));
    const res = await pool.query(
      `DELETE FROM bot.playlists WHERE guild_id = $1 AND name = $2`,
      [guildId, playlistName],
    );
    if ((res.rowCount ?? 0) === 0) return c.json({ error: "Not found" }, 404);
    return c.json({ ok: true });
  });

  app.get("/api/bot/guild/:id/playlists/:name/tracks", async (c) => {
    const token = getCookie(c, COOKIE_NAME);
    if (!token) return c.json({ error: "Unauthorized" }, 401);
    const session = await verifySession(env.sessionSecret, token);
    if (!session) return c.json({ error: "Unauthorized" }, 401);
    const guildId = c.req.param("id");
    if (!DISCORD_SNOWFLAKE_RE.test(guildId)) return c.json({ error: "Invalid guild id" }, 400);
    const access = await assertBotGuildAccess(env, session.sub, guildId);
    if (!access.ok) return c.json(access.body, access.status);
    const pool = getPool();
    if (!pool) return c.json({ error: "Database not available" }, 503);
    const playlistName = decodeURIComponent(c.req.param("name"));
    const pl = await pool.query(
      `SELECT id FROM bot.playlists WHERE guild_id = $1 AND name = $2`,
      [guildId, playlistName],
    );
    if (!pl.rows.length) return c.json({ error: "Not found" }, 404);
    const tracks = await pool.query(
      `SELECT position, title, artist, duration_sec, source FROM bot.playlist_tracks
       WHERE playlist_id = $1 ORDER BY position`,
      [pl.rows[0].id],
    );
    return c.json({ tracks: tracks.rows });
  });

  app.post("/api/bot/guild/:id/playlists/:name/tracks", async (c) => {
    const token = getCookie(c, COOKIE_NAME);
    if (!token) return c.json({ error: "Unauthorized" }, 401);
    const session = await verifySession(env.sessionSecret, token);
    if (!session) return c.json({ error: "Unauthorized" }, 401);
    const guildId = c.req.param("id");
    if (!DISCORD_SNOWFLAKE_RE.test(guildId)) return c.json({ error: "Invalid guild id" }, 400);
    const access = await assertBotGuildAccess(env, session.sub, guildId);
    if (!access.ok) return c.json(access.body, access.status);
    const botUrl = await requireMusicBotUrl(c);
    if (!botUrl) return;
    const { query } = await c.req.json<{ query: string }>();
    if (!query?.trim()) return c.json({ error: "Query required" }, 400);
    return proxyMusicCommand(c, botUrl, "/playlist/add-track", {
      guildId,
      playlistName: decodeURIComponent(c.req.param("name")),
      query: query.trim(),
      userId: session.sub,
    });
  });

  app.delete("/api/bot/guild/:id/playlists/:name/tracks/:position", async (c) => {
    const token = getCookie(c, COOKIE_NAME);
    if (!token) return c.json({ error: "Unauthorized" }, 401);
    const session = await verifySession(env.sessionSecret, token);
    if (!session) return c.json({ error: "Unauthorized" }, 401);
    const guildId = c.req.param("id");
    if (!DISCORD_SNOWFLAKE_RE.test(guildId)) return c.json({ error: "Invalid guild id" }, 400);
    const access = await assertBotGuildAccess(env, session.sub, guildId);
    if (!access.ok) return c.json(access.body, access.status);
    const pool = getPool();
    if (!pool) return c.json({ error: "Database not available" }, 503);
    const playlistName = decodeURIComponent(c.req.param("name"));
    const position = Number(c.req.param("position"));
    if (!Number.isInteger(position) || position < 1) return c.json({ error: "Invalid position" }, 400);
    const pl = await pool.query(
      `SELECT id FROM bot.playlists WHERE guild_id = $1 AND name = $2`,
      [guildId, playlistName],
    );
    if (!pl.rows.length) return c.json({ error: "Playlist not found" }, 404);
    const del = await pool.query(
      `DELETE FROM bot.playlist_tracks WHERE playlist_id = $1 AND position = $2`,
      [pl.rows[0].id, position],
    );
    if ((del.rowCount ?? 0) === 0) return c.json({ error: "Track not found" }, 404);
    await pool.query(
      `UPDATE bot.playlist_tracks SET position = position - 1 WHERE playlist_id = $1 AND position > $2`,
      [pl.rows[0].id, position],
    );
    return c.json({ ok: true });
  });

  app.post("/api/bot/guild/:id/playlists/:name/play", async (c) => {
    const token = getCookie(c, COOKIE_NAME);
    if (!token) return c.json({ error: "Unauthorized" }, 401);
    const session = await verifySession(env.sessionSecret, token);
    if (!session) return c.json({ error: "Unauthorized" }, 401);
    const guildId = c.req.param("id");
    if (!DISCORD_SNOWFLAKE_RE.test(guildId)) return c.json({ error: "Invalid guild id" }, 400);
    const access = await assertBotGuildAccess(env, session.sub, guildId);
    if (!access.ok) return c.json(access.body, access.status);
    const botUrl = await requireMusicBotUrl(c);
    if (!botUrl) return;
    const { channelId } = await c.req.json<{ channelId: string }>();
    return proxyMusicCommand(c, botUrl, "/playlist/play", {
      guildId,
      playlistName: decodeURIComponent(c.req.param("name")),
      channelId: channelId ?? "",
      userId: session.sub,
    });
  });

  app.delete("/api/bot/guild/:id/music/queue/:itemId", async (c) => {
    const token = getCookie(c, COOKIE_NAME);
    if (!token) return c.json({ error: "Unauthorized" }, 401);
    const session = await verifySession(env.sessionSecret, token);
    if (!session) return c.json({ error: "Unauthorized" }, 401);
    const guildId = c.req.param("id");
    if (!DISCORD_SNOWFLAKE_RE.test(guildId)) {
      return c.json({ error: "Invalid guild id", code: "invalid_guild_id" }, 400);
    }
    const access = await assertBotGuildAccess(env, session.sub, guildId);
    if (!access.ok) return c.json(access.body, access.status);
    const itemId = Number(c.req.param("itemId"));
    if (!Number.isInteger(itemId) || itemId <= 0) {
      return c.json({ error: "Invalid item id" }, 400);
    }

    const botBase = musicBotBaseUrl();
    if (botBase) {
      try {
        const res = await botFetch(
          `${botBase}/music/queue/${itemId}?guildId=${encodeURIComponent(guildId)}`,
          { method: "DELETE" },
        );
        const json = (await res.json()) as Record<string, unknown>;
        if (!res.ok) {
          return c.json(json, res.status as 400 | 404 | 503);
        }
        return c.json(json);
      } catch {
        return c.json({ error: "Music bot unreachable" }, 503);
      }
    }

    const pool = getPool();
    if (!pool) return c.json({ error: "Database not available" }, 503);
    const result = await pool.query(
      `DELETE FROM bot.music_queue WHERE id = $1 AND guild_id = $2`,
      [itemId, guildId],
    );
    if ((result.rowCount ?? 0) === 0) {
      return c.json({ error: "Item not found" }, 404);
    }
    return c.json({ ok: true });
  });

  app.post("/api/bot/guild/:id/music/queue/reorder", async (c) => {
    const token = getCookie(c, COOKIE_NAME);
    if (!token) return c.json({ error: "Unauthorized" }, 401);
    const session = await verifySession(env.sessionSecret, token);
    if (!session) return c.json({ error: "Unauthorized" }, 401);
    const guildId = c.req.param("id");
    if (!DISCORD_SNOWFLAKE_RE.test(guildId)) {
      return c.json({ error: "Invalid guild id", code: "invalid_guild_id" }, 400);
    }
    const access = await assertBotGuildAccess(env, session.sub, guildId);
    if (!access.ok) return c.json(access.body, access.status);

    let body: { orderedIds?: unknown };
    try {
      body = await c.req.json<{ orderedIds?: unknown }>();
    } catch {
      return c.json({ error: "Invalid JSON" }, 400);
    }
    const raw = body.orderedIds;
    if (!Array.isArray(raw) || raw.length === 0) {
      return c.json({ error: "orderedIds must be a non-empty array" }, 400);
    }
    const orderedIds = raw.map((x) => (typeof x === "number" ? x : Number(x)));
    if (!orderedIds.every((n) => Number.isInteger(n) && n > 0)) {
      return c.json({ error: "orderedIds must be positive integers" }, 400);
    }

    const botBase = musicBotBaseUrl();
    if (botBase) {
      try {
        const res = await botFetch(`${botBase}/music/queue/reorder`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ guildId, orderedIds }),
        });
        const json = (await res.json()) as Record<string, unknown>;
        if (!res.ok) {
          return c.json(json, res.status as 400 | 409 | 503);
        }
        return c.json(json);
      } catch {
        return c.json({ error: "Music bot unreachable" }, 503);
      }
    }

    const ok = await reorderMusicQueueDirect(guildId, orderedIds);
    if (!ok) {
      return c.json(
        { error: "Queue mismatch — refresh and try again", code: "music_queue_reorder_conflict" },
        409,
      );
    }
    return c.json({ ok: true });
  });

  return app;
}

function timingSafeEqualString(a: string, b: string): boolean {
  const ba = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ba.length !== bb.length) {
    return false;
  }
  return timingSafeEqual(ba, bb);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");
loadDotenv({ path: path.join(repoRoot, ".env") });
loadDotenv({
  path: path.join(repoRoot, "apps/discord-hub-api/.env"),
  override: true,
});

let stopWheelCollabServer: (() => Promise<void>) | null = null;
let httpServer: ServerType | null = null;

async function shutdownAndExit(code: number): Promise<void> {
  if (httpServer) {
    await new Promise<void>((resolve) => {
      httpServer!.close(() => resolve());
    });
    httpServer = null;
  }
  if (stopWheelCollabServer) {
    await stopWheelCollabServer();
    stopWheelCollabServer = null;
  }
  await closeDb();
  process.exit(code);
}

async function main(): Promise<void> {
  const env = loadEnv();
  initDb(env);
  const pool = getPool();
  if (env.dbConfig && pool) {
    try {
      await verifyDbConnection();
      console.log("discord-hub-api: Postgres connection OK");
    } catch (e) {
      console.error(
        "discord-hub-api: DB config is set but Postgres is not reachable. Check network, firewall, and credentials.",
      );
      throw e;
    }
    try {
      const migrationsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "migrations");
      await runSqlMigrations(pool, migrationsDir, (line) =>
        console.log(`discord-hub-api: ${line}`),
      );
    } catch (e) {
      console.error("discord-hub-api: migrations failed:", e);
      throw e;
    }
  }

  const app = createApp(env);
  stopWheelCollabServer = startWheelCollabServer(env);
  if (env.riotApiKey && env.leagueAutoSyncEnabled) {
    startLeagueSyncScheduler(env.riotApiKey);
  } else if (env.riotApiKey && !env.leagueAutoSyncEnabled) {
    console.log(
      "[league-sync] Auto-sync av — sätt LEAGUE_AUTO_SYNC_ENABLED=1 för att aktivera periodisk synk.",
    );
  } else {
    console.log("[league-sync] RIOT_API_KEY not set — auto-sync disabled");
  }

  process.once("SIGINT", () => {
    void shutdownAndExit(0);
  });
  process.once("SIGTERM", () => {
    void shutdownAndExit(0);
  });

  const server = createAdaptorServer({
    fetch: app.fetch,
    hostname: env.listenHost,
  });
  httpServer = server;
  server.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      console.error(
        `discord-hub-api: cannot bind ${env.listenHost}:${env.port} (${err.code}). From repo root run: node scripts/kill-dev-ports.mjs`,
      );
    } else {
      console.error("discord-hub-api: HTTP server error:", err);
    }
    process.exit(1);
  });
  server.listen(env.port, env.listenHost, () => {
    const addr = server.address();
    const p =
      typeof addr === "object" && addr !== null && "port" in addr
        ? (addr as { port: number }).port
        : env.port;
    console.log(`discord-hub-api listening on http://${env.listenHost}:${p}`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
