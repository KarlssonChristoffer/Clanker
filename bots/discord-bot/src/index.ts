import 'dotenv/config';
import { runSqlMigrations } from '@clanker/hub-pg-migrate';
import { setDefaultResultOrder } from 'node:dns';
import { existsSync } from 'node:fs';

// Broken IPv6 on some Windows setups prevents Discord voice UDP from finishing; prefer A records first.
if (process.platform === 'win32' && process.env.DISCORD_VOICE_IPV4_FIRST !== '0') {
  setDefaultResultOrder('ipv4first');
}
import {
  Client,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type Interaction,
} from 'discord.js';
import { initDb, closeDb } from './db.js';
import { prepareDiscordVoiceCrypto } from './voice-setup.js';
import { registerVoiceTracker } from './voice-tracker.js';
import { registerGuildTracker } from './guild-tracker.js';
import { registerMessageTracker } from './message-tracker.js';
import {
  enqueue, skip, previous, pause, resume, stop, initPlayDl, getLastChannelId,
  createPlaylist, deletePlaylist, listPlaylists, getPlaylistTracks,
  addTrackToPlaylist, removeTrackFromPlaylist, playPlaylist, shutdownMusic,
} from './music-player.js';
import { startMusicHttpServer } from './music-http.js';
import { getPool } from './db.js';
import { resolveHubMigrationsDir } from './resolve-hub-migrations-dir.js';
import { checkYtDlpAtStartup } from './media-env.js';
import { initConfig } from './core/config.js';
import { childLogger, logger } from './core/logger.js';
import { installProcessHandlers, onShutdown, isShuttingDown } from './core/lifecycle.js';
import { handleInteractionError } from './core/interaction-errors.js';
import { syncSlashCommands } from './core/command-sync.js';

const config = initConfig();
const log = childLogger('bot');
const musicLog = childLogger('music');

/** In default Docker bridge, Discord voice UDP rarely works; warn once at boot (Linux: discord-bot-host; PC: npm run bot:dev). */
function warnDockerBridgeVoice(): void {
  if (!existsSync('/.dockerenv')) return;
  if (process.env.DISCORD_BOT_VOICE_ALLOW_BRIDGE === '1') return;
  if (process.env.DISCORD_BOT_NETWORK_MODE === 'host') return;
  log.warn(
    'Running in a container: if this is the bridge network, Discord voice/music usually fails. Linux: compose profile discord-host (discord-bot-host). Windows/macOS Docker Desktop: run `npm run bot:dev` on the host. Set DISCORD_BOT_VOICE_ALLOW_BRIDGE=1 to hide this warning.',
  );
}

const commands = [
  new SlashCommandBuilder()
    .setName('ping')
    .setDescription('Svarar med Pong (Clanker bot).')
    .toJSON(),

  new SlashCommandBuilder()
    .setName('play')
    .setDescription('Spela en låt eller lägg till i kön.')
    .addStringOption((o) =>
      o.setName('query').setDescription('YouTube/Spotify/SoundCloud URL eller sökterm').setRequired(true),
    )
    .toJSON(),

  new SlashCommandBuilder().setName('skip').setDescription('Hoppa till nästa låt i kön.').toJSON(),
  new SlashCommandBuilder()
    .setName('previous')
    .setDescription('Spela föregående låt (senast spelade i denna session).')
    .toJSON(),
  new SlashCommandBuilder().setName('pause').setDescription('Pausa uppspelningen.').toJSON(),
  new SlashCommandBuilder().setName('resume').setDescription('Återuppta uppspelningen.').toJSON(),
  new SlashCommandBuilder().setName('stop').setDescription('Stoppa musiken och töm kön.').toJSON(),

  new SlashCommandBuilder().setName('queue').setDescription('Visa nuvarande kö.').toJSON(),

  new SlashCommandBuilder()
    .setName('playlist')
    .setDescription('Hantera sparade spellistor.')
    .addSubcommand((sub) =>
      sub.setName('skapa').setDescription('Skapa en ny spellista.')
        .addStringOption((o) => o.setName('namn').setDescription('Spellistas namn').setRequired(true)),
    )
    .addSubcommand((sub) =>
      sub.setName('radera').setDescription('Radera en spellista.')
        .addStringOption((o) => o.setName('namn').setDescription('Spellistas namn').setRequired(true)),
    )
    .addSubcommand((sub) =>
      sub.setName('lista').setDescription('Lista alla spellistor i servern.'),
    )
    .addSubcommand((sub) =>
      sub.setName('visa').setDescription('Visa spår i en spellista.')
        .addStringOption((o) => o.setName('namn').setDescription('Spellistas namn').setRequired(true)),
    )
    .addSubcommand((sub) =>
      sub.setName('lagg-till').setDescription('Lägg till en låt i en spellista.')
        .addStringOption((o) => o.setName('namn').setDescription('Spellistas namn').setRequired(true))
        .addStringOption((o) => o.setName('lat').setDescription('URL eller sökterm').setRequired(true)),
    )
    .addSubcommand((sub) =>
      sub.setName('ta-bort').setDescription('Ta bort ett spår från en spellista.')
        .addStringOption((o) => o.setName('namn').setDescription('Spellistas namn').setRequired(true))
        .addIntegerOption((o) => o.setName('position').setDescription('Spårets position (1-baserat)').setRequired(true).setMinValue(1)),
    )
    .addSubcommand((sub) =>
      sub.setName('spela').setDescription('Ladda och spela en spellista.')
        .addStringOption((o) => o.setName('namn').setDescription('Spellistas namn').setRequired(true)),
    )
    .toJSON(),
];

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,    // voice channel tracking + @discordjs/voice
    GatewayIntentBits.GuildMembers,        // privileged: member join/leave/update, full member list
    GatewayIntentBits.GuildPresences,      // privileged: online status + activities (games, Spotify, …)
    GatewayIntentBits.GuildMessages,       // message events (MessageCreate, etc.)
    GatewayIntentBits.MessageContent,      // privileged: read message content
  ],
});

client.once(Events.ClientReady, (c) => {
  log.info({ user: c.user.tag, guilds: c.guilds.cache.size }, 'Discord client ready');
});

client.on(Events.Error, (err) => {
  log.error({ err }, 'Discord client error');
});
client.on(Events.Warn, (message) => {
  log.warn({ message }, 'Discord client warning');
});
client.on(Events.ShardDisconnect, (event, shardId) => {
  log.warn({ code: event.code, shardId }, 'Discord gateway disconnected');
});
client.on(Events.ShardResume, (shardId, replayed) => {
  log.info({ shardId, replayed }, 'Discord gateway resumed');
});

async function handlePlay(interaction: ChatInputCommandInteraction): Promise<void> {
  const member = interaction.guild?.members.cache.get(interaction.user.id);
  const channelId = member?.voice.channelId ?? getLastChannelId(interaction.guildId!);
  if (!channelId) {
    await interaction.reply({ content: '❌ Du måste vara i en röstkanal.', flags: 64 });
    return;
  }
  await interaction.deferReply({ flags: 64 });
  const query = interaction.options.getString('query', true);
  try {
    const result = await enqueue(client, interaction.guildId!, query, interaction.user.id, channelId);
    if (!result) {
      await interaction.editReply('❌ Kunde inte hitta låten eller spellistan. Prova med en annan sökning eller URL.');
      return;
    }
    if (result.kind === 'playlist') {
      await interaction.editReply(`▶️ **${result.title}** — ${result.queued} låtar lades till i kön.`);
    } else {
      const t = result.track;
      await interaction.editReply(`▶️ **${t.title}**${t.artist ? ` — ${t.artist}` : ''} lades till i kön.`);
    }
  } catch (err) {
    musicLog.error({ err, guildId: interaction.guildId, query }, 'enqueue failed');
    await interaction.editReply(`❌ Fel: ${(err as Error).message}`);
  }
}

function fmtDuration(sec: number | null): string {
  if (sec == null) return '';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return ` [${m}:${s.toString().padStart(2, '0')}]`;
}

async function handlePlaylist(interaction: ChatInputCommandInteraction): Promise<void> {
  const sub = interaction.options.getSubcommand(true);
  const guildId = interaction.guildId!;
  const userId = interaction.user.id;

  if (sub === 'skapa') {
    const name = interaction.options.getString('namn', true);
    const pl = await createPlaylist(guildId, name, userId);
    if (!pl) {
      await interaction.reply({ content: `❌ En spellista med namnet **${name}** finns redan.`, flags: 64 });
      return;
    }
    await interaction.reply({ content: `✅ Spellistan **${pl.name}** skapades.`, flags: 64 });
    return;
  }

  if (sub === 'radera') {
    const name = interaction.options.getString('namn', true);
    const ok = await deletePlaylist(guildId, name);
    await interaction.reply({ content: ok ? `🗑️ **${name}** raderades.` : `❌ Hittade ingen spellista med det namnet.`, flags: 64 });
    return;
  }

  if (sub === 'lista') {
    const lists = await listPlaylists(guildId);
    if (!lists.length) {
      await interaction.reply({ content: '📭 Inga spellistor skapade ännu. Använd `/playlist skapa`.', flags: 64 });
      return;
    }
    const embed = new EmbedBuilder()
      .setTitle('🎶 Spellistor')
      .setDescription(lists.map((p) => `**${p.name}** — ${p.trackCount} spår`).join('\n'));
    await interaction.reply({ embeds: [embed], flags: 64 });
    return;
  }

  if (sub === 'visa') {
    const name = interaction.options.getString('namn', true);
    const tracks = await getPlaylistTracks(guildId, name);
    if (!tracks) {
      await interaction.reply({ content: `❌ Hittade ingen spellista med namnet **${name}**.`, flags: 64 });
      return;
    }
    if (!tracks.length) {
      await interaction.reply({ content: `📭 **${name}** är tom. Lägg till låtar med \`/playlist lagg-till\`.`, flags: 64 });
      return;
    }
    const embed = new EmbedBuilder()
      .setTitle(`🎶 ${name}`)
      .setDescription(
        tracks.map((t) => `${t.position}. **${t.title}**${t.artist ? ` — ${t.artist}` : ''}${fmtDuration(t.durationSec)}`).join('\n').slice(0, 4000),
      );
    await interaction.reply({ embeds: [embed], flags: 64 });
    return;
  }

  if (sub === 'lagg-till') {
    const name = interaction.options.getString('namn', true);
    const query = interaction.options.getString('lat', true);
    await interaction.deferReply({ flags: 64 });
    const result = await addTrackToPlaylist(guildId, name, query, userId);
    if (!result) {
      await interaction.editReply(`❌ Hittade ingen spellista **${name}** eller kunde inte lösa låten.`);
      return;
    }
    const { track, position } = result;
    await interaction.editReply(`✅ **${track.title}**${track.artist ? ` — ${track.artist}` : ''} lades till på plats ${position} i **${name}**.`);
    return;
  }

  if (sub === 'ta-bort') {
    const name = interaction.options.getString('namn', true);
    const position = interaction.options.getInteger('position', true);
    const ok = await removeTrackFromPlaylist(guildId, name, position);
    await interaction.reply({ content: ok ? `✅ Spår ${position} togs bort från **${name}**.` : `❌ Hittade inget spår på position ${position} i **${name}**.`, flags: 64 });
    return;
  }

  if (sub === 'spela') {
    const name = interaction.options.getString('namn', true);
    const member = interaction.guild?.members.cache.get(userId);
    const channelId = member?.voice.channelId ?? getLastChannelId(guildId);
    if (!channelId) {
      await interaction.reply({ content: '❌ Du måste vara i en röstkanal.', flags: 64 });
      return;
    }
    await interaction.deferReply({ flags: 64 });
    const result = await playPlaylist(client, guildId, name, userId, channelId);
    if (!result) {
      await interaction.editReply(`❌ Hittade ingen spellista med namnet **${name}**.`);
      return;
    }
    if (result.queued === 0) {
      await interaction.editReply(`📭 **${result.name}** är tom.`);
      return;
    }
    await interaction.editReply(`▶️ **${result.name}** — ${result.queued} spår lades till i kön.`);
  }
}

async function handleQueue(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ flags: 64 });
  const pool = getPool();
  const [nowRes, queueRes] = await Promise.all([
    pool.query<{ title: string; artist: string | null; is_paused: boolean }>(
      'SELECT title, artist, is_paused FROM bot.music_now_playing WHERE guild_id = $1',
      [interaction.guildId],
    ),
    pool.query<{ title: string; artist: string | null }>(
      'SELECT title, artist FROM bot.music_queue WHERE guild_id = $1 ORDER BY added_at LIMIT 10',
      [interaction.guildId],
    ),
  ]);

  if (!nowRes.rows.length) {
    await interaction.editReply('📭 Inget spelas just nu.');
    return;
  }

  const now = nowRes.rows[0];
  const embed = new EmbedBuilder()
    .setTitle('🎵 Musikköen')
    .addFields({
      name: now.is_paused ? '⏸ Pausad' : '▶️ Spelar nu',
      value: `**${now.title}**${now.artist ? ` — ${now.artist}` : ''}`,
    });

  if (queueRes.rows.length) {
    embed.addFields({
      name: 'Kö',
      value: queueRes.rows.map((r, i) => `${i + 1}. **${r.title}**${r.artist ? ` — ${r.artist}` : ''}`).join('\n'),
    });
  }

  await interaction.editReply({ embeds: [embed] });
}

async function handleChatInput(interaction: ChatInputCommandInteraction): Promise<void> {
  switch (interaction.commandName) {
    case 'ping':
      await interaction.reply({ content: 'Pong!', flags: 64 });
      break;
    case 'play':
      await handlePlay(interaction);
      break;
    case 'skip':
      await skip(interaction.guildId!);
      await interaction.reply({ content: '⏭ Hoppade till nästa låt.', flags: 64 });
      break;
    case 'previous': {
      const wentBack = await previous(interaction.guildId!);
      await interaction.reply({
        content: wentBack
          ? '⏮️ Spelar föregående låt.'
          : 'ℹ️ Ingen tidigare låt i den här sessionen.',
        flags: 64,
      });
      break;
    }
    case 'pause':
      await pause(interaction.guildId!);
      await interaction.reply({ content: '⏸ Pausad.', flags: 64 });
      break;
    case 'resume':
      await resume(interaction.guildId!);
      await interaction.reply({ content: '▶️ Återupptog uppspelningen.', flags: 64 });
      break;
    case 'stop':
      await stop(interaction.guildId!);
      await interaction.reply({ content: '⏹ Stoppad och kön tömd.', flags: 64 });
      break;
    case 'queue':
      await handleQueue(interaction);
      break;
    case 'playlist':
      await handlePlaylist(interaction);
      break;
  }
}

client.on(Events.InteractionCreate, async (interaction: Interaction) => {
  if (isShuttingDown()) return;
  try {
    if (interaction.isChatInputCommand()) {
      await handleChatInput(interaction);
    }
  } catch (err) {
    await handleInteractionError(interaction, err);
  }
});

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

  registerVoiceTracker(client);
  registerGuildTracker(client);
  registerMessageTracker(client);

  const http = startMusicHttpServer({
    client,
    port: config.httpPort,
    bind: config.httpBind,
    secret: config.httpSecret,
    version: config.version,
  });
  onShutdown('http-server', () => http.close(), 10);
  onShutdown('music', () => shutdownMusic(), 20);
  onShutdown('discord-client', () => client.destroy(), 30);

  warnDockerBridgeVoice();

  await syncSlashCommands({
    pool,
    token: config.token,
    appId: config.appId,
    guildIds: config.commandGuildIds,
    commands,
    force: config.forceCommandSync,
  });
  await client.login(config.token);
}

main().catch((err) => {
  logger.fatal({ err }, 'startup failed');
  // Let pino flush before exiting.
  setImmediate(() => process.exit(1));
});
