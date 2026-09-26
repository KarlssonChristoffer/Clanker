/**
 * Quote book for the hub (read-only). The Discord bot writes bot.quotes when someone reacts with 💬.
 *   GET /api/bot/guild/:id/quotes?limit=20&random=1
 * Returns { available: false } when the table is missing (bot migrations not applied) or no DB.
 */
import type { Hono } from "hono";
import { getCookie } from "hono/cookie";
import type pg from "pg";
import { assertBotGuildAccess } from "./bot-guild-access.js";
import { getPool } from "./db.js";
import type { AppEnv } from "./env.js";
import { COOKIE_NAME, verifySession } from "./session.js";

const SNOWFLAKE_RE = /^\d{5,32}$/;

export type HubQuote = { id: string; content: string; author_name: string; said_at: string };

export async function fetchQuotes(
  pool: pg.Pool | null,
  guildId: string,
  opts: { limit: number; random: boolean },
): Promise<{ available: boolean; quotes: HubQuote[] }> {
  if (!pool) return { available: false, quotes: [] };
  try {
    const res = await pool.query<{ id: string; content: string; author_name: string; said_at: Date }>(
      `SELECT id::text AS id, content, author_name, said_at FROM bot.quotes
       WHERE guild_id = $1
       ORDER BY ${opts.random ? "random()" : "saved_at DESC"}
       LIMIT $2`,
      [guildId, opts.limit],
    );
    return {
      available: true,
      quotes: res.rows.map((r) => ({ id: r.id, content: r.content, author_name: r.author_name, said_at: new Date(r.said_at).toISOString() })),
    };
  } catch (err) {
    if ((err as { code?: string }).code === "42P01") return { available: false, quotes: [] };
    throw err;
  }
}

export function registerQuoteRoutes(app: Hono, env: AppEnv): void {
  app.get("/api/bot/guild/:id/quotes", async (c) => {
    const token = getCookie(c, COOKIE_NAME);
    if (!token) return c.json({ error: "Unauthorized" }, 401);
    const session = await verifySession(env.sessionSecret, token);
    if (!session) return c.json({ error: "Unauthorized" }, 401);
    const guildId = c.req.param("id");
    if (!SNOWFLAKE_RE.test(guildId)) return c.json({ error: "Invalid guild id", code: "invalid_guild_id" }, 400);
    const access = await assertBotGuildAccess(env, session.sub, guildId);
    if (!access.ok) return c.json(access.body, access.status);
    const limit = Math.min(50, Math.max(1, Number(c.req.query("limit") ?? "20") || 20));
    const random = c.req.query("random") === "1";
    return c.json(await fetchQuotes(getPool(), guildId, { limit, random }));
  });
}
