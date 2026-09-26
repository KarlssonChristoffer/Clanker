/**
 * discord-bot bootstrap: config → DB + migrations → feature modules → scheduler → slash sync → login.
 * Feature code lives in src/commands, src/components and the modules listed in src/modules.ts.
 */
import 'dotenv/config';
import { runSqlMigrations } from '@clanker/hub-pg-migrate';
import { setDefaultResultOrder } from 'node:dns';
import { existsSync } from 'node:fs';

// Broken IPv6 on some Windows setups prevents Discord voice UDP from finishing; prefer A records first.
if (process.platform === 'win32' && process.env.DISCORD_VOICE_IPV4_FIRST !== '0') {
  setDefaultResultOrder('ipv4first');
}
import { Client, Events, GatewayIntentBits, Partials } from 'discord.js';
import { closeDb, db, initDb } from './db.js';
import { prepareDiscordVoiceCrypto } from './voice-setup.js';
import { registerVoiceTracker } from './voice-tracker.js';
import { registerGuildTracker } from './guild-tracker.js';
import { initPlayDl, shutdownMusic } from './music-player.js';
import { startMusicHttpServer } from './music-http.js';
import { resolveHubMigrationsDir } from './resolve-hub-migrations-dir.js';
import { checkYtDlpAtStartup } from './media-env.js';
import { initConfig } from './core/config.js';
import { childLogger, logger } from './core/logger.js';
import { installProcessHandlers, onShutdown } from './core/lifecycle.js';
import { syncSlashCommands } from './core/command-sync.js';
import { CommandRegistry } from './core/commands.js';
import { ComponentRegistry } from './core/components.js';
import { registerInteractionRouter } from './core/interaction-router.js';
import { registerMessagePipeline } from './core/message-pipeline.js';
import { initFeatures } from './core/features.js';
import { initScheduler } from './core/scheduler.js';
import { startHeartbeat } from './core/heartbeat.js';
import { loadModules } from './modules.js';

const config = initConfig();
const log = childLogger('bot');

/** In default Docker bridge, Discord voice UDP rarely works; warn once at boot (Linux: discord-bot-host; PC: npm run bot:dev). */
function warnDockerBridgeVoice(): void {
  if (!existsSync('/.dockerenv')) return;
  if (process.env.DISCORD_BOT_VOICE_ALLOW_BRIDGE === '1') return;
  if (process.env.DISCORD_BOT_NETWORK_MODE === 'host') return;
  log.warn(
    'Running in a container: if this is the bridge network, Discord voice/music usually fails. Linux: compose profile discord-host (discord-bot-host). Windows/macOS Docker Desktop: run `npm run bot:dev` on the host. Set DISCORD_BOT_VOICE_ALLOW_BRIDGE=1 to hide this warning.',
  );
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates, // voice channel tracking + @discordjs/voice
    GatewayIntentBits.GuildMembers, // privileged: member join/leave/update, full member list
    GatewayIntentBits.GuildPresences, // privileged: online status + activities (games, Spotify, …)
    GatewayIntentBits.GuildMessages, // message events (MessageCreate, etc.)
    GatewayIntentBits.GuildMessageReactions, // 💬 quote reactions
    GatewayIntentBits.MessageContent, // privileged: read message content
    GatewayIntentBits.GuildScheduledEvents, // raid events
  ],
  // Reactions on messages sent before the bot started arrive as partials.
  partials: [Partials.Message, Partials.Channel, Partials.Reaction, Partials.User],
});

client.once(Events.ClientReady, (c) => {
  log.info({ user: c.user.tag, guilds: c.guilds.cache.size }, 'Discord client ready');
});
client.on(Events.Error, (err) => log.error({ err }, 'Discord client error'));
client.on(Events.Warn, (message) => log.warn({ message }, 'Discord client warning'));
client.on(Events.ShardDisconnect, (event, shardId) => log.warn({ code: event.code, shardId }, 'Discord gateway disconnected'));
client.on(Events.ShardResume, (shardId, replayed) => log.info({ shardId, replayed }, 'Discord gateway resumed'));

async function main(): Promise<void> {
  installProcessHandlers();
  log.info({ version: config.version, nodeEnv: config.nodeEnv, node: process.version }, 'starting discord-bot');

  await prepareDiscordVoiceCrypto();
  const pool = initDb(config.databaseUrl);
  onShutdown('database', () => closeDb(), 90);

  if (config.runMigrations) {
    const migrationsLog = childLogger('migrations');
    await runSqlMigrations(pool, resolveHubMigrationsDir(), (line) => migrationsLog.info(line));
  } else {
    log.info('migrations skipped (DISCORD_BOT_RUN_MIGRATIONS=0)');
  }

  await initPlayDl();
  await checkYtDlpAtStartup(childLogger('yt-dlp'));

  initFeatures(db);
  const scheduler = initScheduler(db);
  const modules = loadModules();
  const commands = new CommandRegistry(modules.flatMap((m) => m.commands ?? []));
  const components = new ComponentRegistry(modules.flatMap((m) => m.components ?? []));
  for (const m of modules) {
    for (const [kind, handler] of Object.entries(m.jobs ?? {})) scheduler.register(kind, handler);
    await m.setup?.(client);
    if (m.onShutdown) onShutdown(`module:${m.name}`, m.onShutdown, 15);
  }

  registerVoiceTracker(client);
  registerGuildTracker(client);
  registerMessagePipeline(client, modules.flatMap((m) => m.messageHandlers ?? []));
  registerInteractionRouter(client, commands, components);

  client.once(Events.ClientReady, (ready) => {
    scheduler.start();
    for (const m of modules) {
      Promise.resolve()
        .then(() => m.onReady?.(ready))
        .catch((err) => log.error({ err, module: m.name }, 'module onReady failed'));
    }
  });

  const http = startMusicHttpServer({
    client,
    port: config.httpPort,
    bind: config.httpBind,
    secret: config.httpSecret,
    version: config.version,
  });
  const stopHeartbeat = startHeartbeat(client, db, config.version);
  onShutdown('http-server', () => http.close(), 10);
  onShutdown('scheduler', () => scheduler.stop(), 10);
  onShutdown('music', () => shutdownMusic(), 20);
  onShutdown('heartbeat', () => stopHeartbeat(), 25);
  onShutdown('discord-client', () => client.destroy(), 30);

  warnDockerBridgeVoice();

  await syncSlashCommands({
    pool,
    token: config.token,
    appId: config.appId,
    guildIds: config.commandGuildIds,
    commands: commands.definitions(),
    force: config.forceCommandSync,
  });
  log.info({ commands: commands.size, modules: modules.map((m) => m.name) }, 'modules loaded');
  await client.login(config.token);
}

main().catch((err) => {
  logger.fatal({ err }, 'startup failed');
  // Let pino flush before exiting.
  setImmediate(() => process.exit(1));
});
