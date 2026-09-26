/**
 * Registers slash commands only when their definitions changed (hash stored in bot.command_registrations).
 * Scopes: one per guild in DISCORD_GUILD_ID (guild commands update instantly), or 'global' when none is set.
 * DISCORD_FORCE_COMMAND_SYNC=1 re-registers regardless of the stored hash.
 */
import { createHash } from 'node:crypto';
import { REST, Routes, type RESTPostAPIApplicationCommandsJSONBody } from 'discord.js';
import type pg from 'pg';
import { childLogger } from './logger.js';

const log = childLogger('command-sync');

/** JSON with object keys sorted recursively, so the hash does not depend on property order. */
export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function hashCommandDefinitions(commands: readonly RESTPostAPIApplicationCommandsJSONBody[]): string {
  return createHash('sha256').update(stableStringify(commands)).digest('hex');
}

export async function syncSlashCommands(opts: {
  pool: pg.Pool;
  token: string;
  appId: string;
  guildIds: readonly string[];
  commands: readonly RESTPostAPIApplicationCommandsJSONBody[];
  force: boolean;
}): Promise<void> {
  const { pool, token, appId, guildIds, commands, force } = opts;
  const hash = hashCommandDefinitions(commands);
  const rest = new REST({ version: '10' }).setToken(token);
  const scopes = guildIds.length ? guildIds.map((id) => `guild:${id}`) : ['global'];

  for (const scope of scopes) {
    const existing = await pool.query<{ definitions_hash: string }>(
      'SELECT definitions_hash FROM bot.command_registrations WHERE application_id = $1 AND scope = $2',
      [appId, scope],
    );
    if (!force && existing.rows[0]?.definitions_hash === hash) {
      log.info({ scope, commands: commands.length }, 'slash commands unchanged; skipping registration');
      continue;
    }
    const route = scope === 'global'
      ? Routes.applicationCommands(appId)
      : Routes.applicationGuildCommands(appId, scope.slice('guild:'.length));
    await rest.put(route, { body: commands });
    await pool.query(
      `INSERT INTO bot.command_registrations (application_id, scope, definitions_hash, command_count, registered_at)
       VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (application_id, scope) DO UPDATE
         SET definitions_hash = EXCLUDED.definitions_hash,
             command_count    = EXCLUDED.command_count,
             registered_at    = now()`,
      [appId, scope, hash, commands.length],
    );
    log.info({ scope, commands: commands.length, forced: force }, 'slash commands registered');
  }
}
