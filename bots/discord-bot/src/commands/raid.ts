/**
 * /raid skapa <titel> <tid> [typ] [storlek]   sign-up post in #raid-anmälan + Discord event + ping
 * /raid avbryt <id>                            cancel (creator or Manage Events)
 */
import { ChannelType, PermissionFlagsBits, SlashCommandBuilder, type TextChannel } from 'discord.js';
import type { SlashCommand } from '../core/commands.js';
import type { ComponentHandler } from '../core/components.js';
import { getConfig } from '../core/config.js';
import { features } from '../core/features.js';
import { UserFacingError } from '../core/interaction-errors.js';
import { getScheduler } from '../core/scheduler.js';
import { discordTimestamp, formatStockholm, parseWhen } from '../core/time.js';
import { db } from '../db.js';
import { boundChannelId } from '../setup/executor.js';
import { defaultRaidSize } from '../wow/game-data.js';
import {
  createScheduledEvent,
  loadEvent,
  loadSignups,
  renderEvent,
  setSignup,
  SIGNUP_STATUSES,
  type RaidEvent,
  type SignupStatus,
} from '../wow/raid.js';
import { EPHEMERAL, requireGuildId } from './_shared.js';

const PING_BEFORE_MS = 30 * 60_000;
export const TIME_HELP = 'Exempel: `20:00`, `ikväll 21`, `imorgon 19:30`, `fredag 20`, `3/10 20:00`, `2026-10-03 20:00`.';

async function createRaid(interaction: Parameters<SlashCommand['execute']>[0]): Promise<void> {
  const guildId = requireGuildId(interaction);
  await features().require(guildId, 'raid');
  const guild = interaction.guild!;
  const flavor = getConfig().wow.flavor;
  const title = interaction.options.getString('titel', true).trim();
  const when = interaction.options.getString('tid', true);
  const kind = (interaction.options.getString('typ') ?? 'raid') as 'raid' | 'dungeon';
  const size = interaction.options.getInteger('storlek') ?? (kind === 'dungeon' ? 5 : defaultRaidSize(flavor));
  const parsed = parseWhen(when, new Date());
  if (!parsed) throw new UserFacingError(`🕰️ Jag förstod inte tiden "${when}" (eller så har den redan varit). ${TIME_HELP}`);

  const channelId = (await boundChannelId(db, guild, 'ch.raid', 'raid-anmälan')) ?? interaction.channelId;
  const channel = await guild.channels.fetch(channelId).catch(() => null);
  if (!channel || channel.type !== ChannelType.GuildText) throw new UserFacingError('Hittar ingen textkanal att posta anmälan i.');
  await interaction.deferReply({ flags: EPHEMERAL });

  const res = await db.query<{ id: string }>(
    `INSERT INTO bot.raid_events (guild_id, channel_id, kind, title, starts_at, size, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id::text AS id`,
    [guildId, channel.id, kind, title, parsed.at, size, interaction.user.id],
  );
  const event = (await loadEvent(db, res.rows[0]!.id))!;
  const msg = await (channel as TextChannel).send(renderEvent(event, []));
  await db.query('UPDATE bot.raid_events SET message_id = $2 WHERE id = $1', [event.id, msg.id]);

  const voiceId = kind === 'raid' ? await boundChannelId(db, guild, 'vc.raid', 'Raid') : null;
  const voiceOk = voiceId && guild.channels.cache.get(voiceId)?.type === ChannelType.GuildVoice ? voiceId : null;
  const scheduled = await createScheduledEvent(guild, event, {
    voiceChannelId: voiceOk,
    location: `#${channel.name}`,
    description: `Anmäl dig i #${channel.name}: ${msg.url}`,
  });
  if (scheduled.id) await db.query('UPDATE bot.raid_events SET discord_event_id = $2 WHERE id = $1', [event.id, scheduled.id]);

  const scheduler = getScheduler();
  const pingAt = new Date(parsed.at.getTime() - PING_BEFORE_MS);
  if (pingAt.getTime() > Date.now()) {
    await scheduler.schedule({ guildId, kind: 'raid-ping', runAt: pingAt, payload: { eventId: event.id }, dedupeKey: `raid-ping:${event.id}` });
  }
  await scheduler.schedule({ guildId, kind: 'raid-start', runAt: parsed.at, payload: { eventId: event.id }, dedupeKey: `raid-start:${event.id}` });

  await interaction.editReply(
    [
      `✅ **${title}** är upplagd i <#${channel.id}>: ${formatStockholm(parsed.at)} (${discordTimestamp(parsed.at, 'R')}).`,
      parsed.hasTime ? '' : '-# Ingen klocktid angiven, så jag tog 20:00.',
      scheduled.id ? '📅 Discord-event skapat.' : `⚠️ Kunde inte skapa Discord-event (${scheduled.error ?? 'okänt fel'}). Saknar jag behörigheten Skapa evenemang?`,
      pingAt.getTime() > Date.now() ? '⏰ Alla anmälda pingas 30 minuter innan.' : '',
    ]
      .filter(Boolean)
      .join('\n'),
  );
}

async function cancelRaid(interaction: Parameters<SlashCommand['execute']>[0]): Promise<void> {
  const guildId = requireGuildId(interaction);
  const id = String(interaction.options.getInteger('id', true));
  const event = await loadEvent(db, id);
  if (!event || event.guild_id !== guildId) throw new UserFacingError('Hittar ingen raid med det id:t här.');
  const canManage = interaction.memberPermissions?.has(PermissionFlagsBits.ManageEvents);
  if (event.created_by !== interaction.user.id && !canManage) throw new UserFacingError('🔒 Bara den som skapade raiden (eller någon med Hantera evenemang) kan ställa in den.');
  await db.query(`UPDATE bot.raid_events SET status = 'cancelled' WHERE id = $1`, [id]);
  const scheduler = getScheduler();
  await scheduler.cancel(`raid-ping:${id}`);
  await scheduler.cancel(`raid-start:${id}`);
  if (event.discord_event_id) await interaction.guild!.scheduledEvents.delete(event.discord_event_id).catch(() => undefined);
  const updated: RaidEvent = { ...event, status: 'cancelled' };
  const ch = await interaction.guild!.channels.fetch(event.channel_id).catch(() => null);
  if (ch?.type === ChannelType.GuildText && event.message_id) {
    const msg = await (ch as TextChannel).messages.fetch(event.message_id).catch(() => null);
    await msg?.edit(renderEvent(updated, await loadSignups(db, updated, getConfig().wow.flavor)));
  }
  await interaction.reply({ content: `❌ **${event.title}** är inställd.`, flags: EPHEMERAL });
}

export const raid: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('raid')
    .setDescription('Raid- och dungeonanmälan.')
    .addSubcommand((s) =>
      s
        .setName('skapa')
        .setDescription('Lägg upp en anmälan med knappar, Discord-event och påminnelse.')
        .addStringOption((o) => o.setName('titel').setDescription('T.ex. "Molten Core" eller "+12 Ara-Kara"').setRequired(true).setMaxLength(100))
        .addStringOption((o) => o.setName('tid').setDescription('T.ex. "fredag 20", "ikväll 21:30", "3/10 19:00"').setRequired(true))
        .addStringOption((o) =>
          o.setName('typ').setDescription('Raid (standard) eller dungeon/nyckel').addChoices({ name: 'raid', value: 'raid' }, { name: 'dungeon', value: 'dungeon' }),
        )
        .addIntegerOption((o) => o.setName('storlek').setDescription('Antal platser (standard: 20 retail / 40 Forever, dungeon 5)').setMinValue(2).setMaxValue(40)),
    )
    .addSubcommand((s) =>
      s
        .setName('avbryt')
        .setDescription('Ställ in en raid.')
        .addIntegerOption((o) => o.setName('id').setDescription('Raidens nummer (står i foten på anmälan)').setRequired(true).setMinValue(1)),
    ),
  async execute(interaction) {
    const sub = interaction.options.getSubcommand(true);
    if (sub === 'skapa') return createRaid(interaction);
    return cancelRaid(interaction);
  },
};

export const raidComponents: ComponentHandler = {
  prefix: 'raid',
  async handle(interaction, parsed) {
    if (!interaction.isButton()) return;
    const [eventId, statusArg] = parsed.args;
    const event = eventId ? await loadEvent(db, eventId) : null;
    if (!event) throw new UserFacingError('Den här anmälan finns inte längre.');
    if (event.status !== 'open') throw new UserFacingError('Anmälan är stängd. 🔒');
    let status: SignupStatus | null = null;
    if (parsed.action === 'join') {
      if (!SIGNUP_STATUSES.includes(statusArg as SignupStatus)) throw new UserFacingError('Okänd roll.');
      status = statusArg as SignupStatus;
    }
    await setSignup(db, event.id, interaction.user.id, status);
    await interaction.update(renderEvent(event, await loadSignups(db, event, getConfig().wow.flavor)));
  },
};
