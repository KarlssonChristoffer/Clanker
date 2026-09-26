/**
 * /spelkväll <spel> <tid>: RSVP post (Kommer / Kanske / Nej), ping 15 min before, closes at start.
 * /påminn <tid> <text>: personal reminder posted in the same channel (DM if the channel is gone).
 * Both run on the persistent scheduler, so they survive restarts.
 */
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  SlashCommandBuilder,
  type Client,
} from 'discord.js';
import type { SlashCommand } from '../core/commands.js';
import { customId, type ComponentHandler } from '../core/components.js';
import { features } from '../core/features.js';
import { UserFacingError } from '../core/interaction-errors.js';
import { getScheduler, PermanentJobError, type JobHandler } from '../core/scheduler.js';
import { discordTimestamp, formatStockholm, parseWhen } from '../core/time.js';
import { db, type Queryable } from '../db.js';
import { EPHEMERAL, requireGuildId } from '../commands/_shared.js';
import { TIME_HELP } from '../commands/raid.js';

const PING_BEFORE_MS = 15 * 60_000;
const MAX_PENDING_REMINDERS = 25;

type Rsvp = 'yes' | 'maybe' | 'no';
type Night = { id: string; guild_id: string; channel_id: string; message_id: string | null; game: string; starts_at: Date; created_by: string; status: string };

async function loadNight(q: Queryable, id: string): Promise<Night | null> {
  const res = await q.query<Night>(
    'SELECT id::text AS id, guild_id, channel_id, message_id, game, starts_at, created_by, status FROM bot.game_nights WHERE id = $1',
    [id],
  );
  return res.rows[0] ?? null;
}

async function rsvps(q: Queryable, id: string): Promise<{ user_id: string; status: Rsvp }[]> {
  const res = await q.query<{ user_id: string; status: Rsvp }>('SELECT user_id, status FROM bot.game_night_rsvps WHERE night_id = $1 ORDER BY updated_at', [id]);
  return res.rows;
}

function render(night: Night, list: { user_id: string; status: Rsvp }[]) {
  const start = new Date(night.starts_at);
  const col = (s: Rsvp) => {
    const people = list.filter((r) => r.status === s).map((r) => `<@${r.user_id}>`);
    return people.length ? people.join('\n').slice(0, 1000) : '–';
  };
  const closed = night.status !== 'open';
  const embed = new EmbedBuilder()
    .setTitle(`🎮 Spelkväll: ${night.game}`)
    .setDescription(`🗓️ ${discordTimestamp(start, 'F')} (${discordTimestamp(start, 'R')})\n-# Utlyst av <@${night.created_by}>`)
    .addFields(
      { name: `✅ Kommer (${list.filter((r) => r.status === 'yes').length})`, value: col('yes'), inline: true },
      { name: `🤔 Kanske (${list.filter((r) => r.status === 'maybe').length})`, value: col('maybe'), inline: true },
      { name: `❌ Nej (${list.filter((r) => r.status === 'no').length})`, value: col('no'), inline: true },
    )
    .setFooter({ text: closed ? 'Spelkvällen har börjat!' : 'Alla som kommer eller kanske kommer pingas 15 min innan' })
    .setColor(0x1abc9c);
  const btn = (s: Rsvp, label: string, emoji: string, style: ButtonStyle) =>
    new ButtonBuilder().setCustomId(customId('night', 'rsvp', night.id, s)).setLabel(label).setEmoji(emoji).setStyle(style).setDisabled(closed);
  return {
    embeds: [embed],
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        btn('yes', 'Kommer', '✅', ButtonStyle.Success),
        btn('maybe', 'Kanske', '🤔', ButtonStyle.Secondary),
        btn('no', 'Nej', '❌', ButtonStyle.Danger),
      ),
    ],
  };
}

export const spelkvall: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('spelkväll')
    .setDescription('Utlys en spelkväll med Kommer/Kanske/Nej och påminnelse.')
    .addStringOption((o) => o.setName('spel').setDescription('Vad ska vi spela?').setRequired(true).setMaxLength(80))
    .addStringOption((o) => o.setName('tid').setDescription('T.ex. "fredag 20", "ikväll 21:30"').setRequired(true)),
  async execute(interaction) {
    const guildId = requireGuildId(interaction);
    await features().require(guildId, 'spelkvall');
    const game = interaction.options.getString('spel', true).trim();
    const when = interaction.options.getString('tid', true);
    const parsed = parseWhen(when, new Date());
    if (!parsed) throw new UserFacingError(`🕰️ Jag förstod inte tiden "${when}". ${TIME_HELP}`);
    const channel = interaction.channel;
    if (!channel || !('send' in channel)) throw new UserFacingError('Jag kan inte posta i den här kanalen.');
    const res = await db.query<{ id: string }>(
      `INSERT INTO bot.game_nights (guild_id, channel_id, game, starts_at, created_by) VALUES ($1, $2, $3, $4, $5) RETURNING id::text AS id`,
      [guildId, interaction.channelId, game, parsed.at, interaction.user.id],
    );
    const night = (await loadNight(db, res.rows[0]!.id))!;
    await interaction.reply(render(night, []));
    const msg = await interaction.fetchReply();
    await db.query('UPDATE bot.game_nights SET message_id = $2 WHERE id = $1', [night.id, msg.id]);
    const scheduler = getScheduler();
    const pingAt = new Date(parsed.at.getTime() - PING_BEFORE_MS);
    if (pingAt.getTime() > Date.now()) {
      await scheduler.schedule({ guildId, kind: 'spelkvall-ping', runAt: pingAt, payload: { nightId: night.id }, dedupeKey: `spelkvall-ping:${night.id}` });
    }
    await scheduler.schedule({ guildId, kind: 'spelkvall-start', runAt: parsed.at, payload: { nightId: night.id }, dedupeKey: `spelkvall-start:${night.id}` });
  },
};

export const spelkvallComponents: ComponentHandler = {
  prefix: 'night',
  async handle(interaction, parsed) {
    if (!interaction.isButton()) return;
    const [id, status] = parsed.args;
    const night = id ? await loadNight(db, id) : null;
    if (!night) throw new UserFacingError('Den här spelkvällen finns inte längre.');
    if (night.status !== 'open') throw new UserFacingError('Spelkvällen har redan börjat. 🎮');
    if (!['yes', 'maybe', 'no'].includes(status ?? '')) throw new UserFacingError('Okänt svar.');
    await db.query(
      `INSERT INTO bot.game_night_rsvps (night_id, user_id, status, updated_at) VALUES ($1, $2, $3, now())
       ON CONFLICT (night_id, user_id) DO UPDATE SET status = EXCLUDED.status, updated_at = now()`,
      [night.id, interaction.user.id, status],
    );
    await interaction.update(render(night, await rsvps(db, night.id)));
  },
};

export const paminn: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('påminn')
    .setDescription('Få en påminnelse senare.')
    .addStringOption((o) => o.setName('tid').setDescription('T.ex. "om 30 min", "imorgon 18", "fredag 19:30"').setRequired(true))
    .addStringOption((o) => o.setName('text').setDescription('Vad ska jag påminna om?').setRequired(true).setMaxLength(500)),
  async execute(interaction) {
    const guildId = requireGuildId(interaction);
    await features().require(guildId, 'spelkvall');
    const when = interaction.options.getString('tid', true);
    const text = interaction.options.getString('text', true).trim();
    const parsed = parseWhen(when, new Date(), { defaultHour: 9 });
    if (!parsed) throw new UserFacingError(`🕰️ Jag förstod inte tiden "${when}". Prova också \`om 30 min\` eller \`om 2 h\`. ${TIME_HELP}`);
    const pending = await db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM bot.scheduled_jobs WHERE kind = 'reminder' AND status = 'pending' AND payload->>'userId' = $1`,
      [interaction.user.id],
    );
    if (Number(pending.rows[0]?.n ?? 0) >= MAX_PENDING_REMINDERS) {
      throw new UserFacingError(`📚 Du har redan ${MAX_PENDING_REMINDERS} påminnelser på gång. Låt några gå ut först.`);
    }
    await getScheduler().schedule({
      guildId,
      kind: 'reminder',
      runAt: parsed.at,
      payload: { userId: interaction.user.id, channelId: interaction.channelId, text },
    });
    await interaction.reply({ content: `⏰ Okej! Jag påminner dig ${formatStockholm(parsed.at)} (${discordTimestamp(parsed.at, 'R')}).`, flags: EPHEMERAL });
  },
};

export function socialJobs(getClient: () => Client): Record<string, JobHandler> {
  return {
    'spelkvall-ping': async (payload: { nightId: string }) => {
      const night = await loadNight(db, payload.nightId);
      if (!night || night.status !== 'open') return;
      const going = (await rsvps(db, night.id)).filter((r) => r.status !== 'no').map((r) => r.user_id);
      const ch = await getClient().channels.fetch(night.channel_id).catch(() => null);
      if (!ch || !ch.isTextBased() || !('send' in ch)) throw new PermanentJobError('channel gone');
      if (!going.length) {
        await ch.send(`🎮 **${night.game}** börjar ${discordTimestamp(new Date(night.starts_at), 'R')}… men ingen har tackat ja. 🦗`);
        return;
      }
      await ch.send({
        content: `🎮 **${night.game}** börjar ${discordTimestamp(new Date(night.starts_at), 'R')}! Hämta snacks. ${going.map((u) => `<@${u}>`).join(' ')}`,
        allowedMentions: { users: going },
      });
    },
    'spelkvall-start': async (payload: { nightId: string }) => {
      const night = await loadNight(db, payload.nightId);
      if (!night || night.status !== 'open' || !night.message_id) return;
      await db.query(`UPDATE bot.game_nights SET status = 'started' WHERE id = $1`, [night.id]);
      const ch = await getClient().channels.fetch(night.channel_id).catch(() => null);
      if (!ch || !ch.isTextBased() || !('messages' in ch)) return;
      const msg = await ch.messages.fetch(night.message_id).catch(() => null);
      await msg?.edit(render({ ...night, status: 'started' }, await rsvps(db, night.id)));
    },
    reminder: async (payload: { userId: string; channelId: string; text: string }) => {
      const client = getClient();
      const content = `⏰ <@${payload.userId}>, du bad mig påminna dig: **${payload.text}**`;
      const ch = await client.channels.fetch(payload.channelId).catch(() => null);
      if (ch && ch.isTextBased() && 'send' in ch) {
        await ch.send({ content, allowedMentions: { users: [payload.userId] } });
        return;
      }
      const user = await client.users.fetch(payload.userId).catch(() => null);
      if (!user) throw new PermanentJobError('user not found');
      await user.send(content);
    },
  };
}
