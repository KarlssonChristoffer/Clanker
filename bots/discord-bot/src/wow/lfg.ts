/**
 * LFG hunting in #lfg. For each new forum post (or message, if #lfg is a text channel):
 *  1. Regex extracts key level and clock time (deterministic).
 *  2. Jev reads the post: content type (Choice), which roles the group already has (one Noul per
 *     role) and when (Choice: nu / ikväll / imorgon / helg / oklart).
 *  3. Confident → Clanker posts an LFG card with buttons for the missing roles.
 *     Unsure → Clanker asks the author with buttons ("Menade du M+?") instead of guessing.
 *  4. When the group is full a temporary voice channel is created and everyone is pinged.
 * Without Jev (no key, breaker open, author opted out) only posts with a key level are handled.
 */
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  MessageFlags,
  type ForumChannel,
  type Message,
  type TextBasedChannel,
} from 'discord.js';
import type { ComponentHandler } from '../core/components.js';
import { customId } from '../core/components.js';
import { getConfig, type WowFlavor } from '../core/config.js';
import { features } from '../core/features.js';
import { UserFacingError } from '../core/interaction-errors.js';
import { childLogger } from '../core/logger.js';
import type { MessageHandler } from '../core/message-pipeline.js';
import { db } from '../db.js';
import { isJevUnavailable, jev } from '../jev/client.js';
import { jevOptOut } from '../jev/store.js';
import { choice, noul } from '../jev/types.js';
import { loadBindings } from '../setup/executor.js';
import { createTempVoice } from '../voice/temp-channels.js';
import { ROLE_EMOJI, ROLE_LABEL, type Role } from './game-data.js';
import { extractClock, extractKeyLevel, isFull, needsFromPresent, type GroupNeeds } from './lfg-parse.js';

const log = childLogger('lfg');
export const LFG_CONFIDENT = 0.75;

type ContentType = 'mplus' | 'dungeon' | 'raid' | 'delve' | 'pvp' | 'annat' | 'inte_lfg';

const CONTENT_LABEL: Record<ContentType, string> = {
  mplus: 'M+',
  dungeon: 'Dungeon',
  raid: 'Raid',
  delve: 'Delve',
  pvp: 'PvP',
  annat: 'Övrigt',
  inte_lfg: 'Inte LFG',
};

function contentOptions(flavor: WowFlavor): Partial<Record<ContentType, string>> {
  const common = {
    raid: 'A raid',
    pvp: 'PvP: arena, battlegrounds or world PvP',
    annat: 'Some other group activity: questing, leveling, farming, achievements, transmog',
    inte_lfg: 'Not looking for players at all: chatting, a question, selling or a guide',
  };
  return flavor === 'retail'
    ? { mplus: 'A Mythic+ keystone dungeon run', delve: 'A delve', ...common }
    : { dungeon: 'A 5-player dungeon run', ...common };
}

const WHEN = {
  nu: 'Right now or within the hour',
  ikvall: 'Later today / this evening',
  imorgon: 'Tomorrow',
  helg: 'This weekend',
  oklart: 'No time mentioned or unclear',
} as const;
const WHEN_LABEL: Record<keyof typeof WHEN, string> = { nu: 'nu', ikvall: 'ikväll', imorgon: 'imorgon', helg: 'i helgen', oklart: 'tid oklar' };

type LfgRow = {
  id: string;
  guild_id: string;
  channel_id: string;
  author_id: string;
  content_type: ContentType | null;
  key_level: number | null;
  when_label: string | null;
  needs: GroupNeeds;
  status: 'pending' | 'open' | 'full' | 'ignored';
  message_id: string | null;
  voice_channel_id: string | null;
};

async function loadPost(id: string): Promise<LfgRow | null> {
  const res = await db.query<LfgRow>(
    `SELECT id::text AS id, guild_id, channel_id, author_id, content_type, key_level, when_label, needs, status, message_id, voice_channel_id
     FROM bot.lfg_posts WHERE id = $1`,
    [id],
  );
  return res.rows[0] ?? null;
}

async function members(postId: string): Promise<{ user_id: string; role: Role }[]> {
  const res = await db.query<{ user_id: string; role: Role }>('SELECT user_id, role FROM bot.lfg_members WHERE post_id = $1 ORDER BY joined_at', [postId]);
  return res.rows;
}

function title(post: Pick<LfgRow, 'content_type' | 'key_level'>): string {
  const label = CONTENT_LABEL[post.content_type ?? 'annat'];
  return post.key_level ? `🔑 +${post.key_level} ${label === 'M+' ? '' : label}`.trim() : `🧭 ${label}`;
}

async function renderCard(post: LfgRow) {
  const list = await members(post.id);
  const open = (Object.keys(post.needs) as Role[]).filter((r) => post.needs[r] > 0);
  const embed = new EmbedBuilder()
    .setTitle(`${title(post)} · söker ${open.length ? open.map((r) => `${ROLE_EMOJI[r]} ${post.needs[r]} ${ROLE_LABEL[r]}`).join(', ') : 'ingen, gruppen är full!'}`)
    .setDescription(
      [
        `Av <@${post.author_id}>${post.when_label ? ` · ${post.when_label}` : ''}`,
        list.length ? `\n**Med i gruppen:**\n${list.map((m) => `${ROLE_EMOJI[m.role]} <@${m.user_id}>`).join('\n')}` : '',
        post.voice_channel_id ? `\n🔊 <#${post.voice_channel_id}>` : '',
      ].join('\n'),
    )
    .setColor(post.status === 'full' ? 0x57f287 : 0xf1c40f)
    .setFooter({ text: 'Tryck på din roll för att hoppa på · Clanker läste inlägget åt er' });
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    ...(['tank', 'healer', 'dps'] as Role[]).map((r) =>
      new ButtonBuilder()
        .setCustomId(customId('lfg', 'join', post.id, r))
        .setLabel(ROLE_LABEL[r])
        .setEmoji(ROLE_EMOJI[r])
        .setStyle(ButtonStyle.Primary)
        .setDisabled(post.status !== 'open' || post.needs[r] <= 0),
    ),
    new ButtonBuilder().setCustomId(customId('lfg', 'leave', post.id)).setLabel('Hoppa av').setStyle(ButtonStyle.Secondary).setDisabled(post.status !== 'open'),
  );
  return { embeds: [embed], components: [row], allowedMentions: { parse: [] as never[] } };
}

async function lfgChannelId(guildId: string): Promise<string | null> {
  const bindings = await loadBindings(db, guildId);
  return bindings['ch.lfg'] ?? null;
}

/** Is this message a new LFG post? Forum: the starter message of a thread in #lfg. Text: any message in #lfg. */
async function isLfgPost(message: Message): Promise<boolean> {
  if (!message.guildId || message.author.bot) return false;
  const lfgId = await lfgChannelId(message.guildId);
  const ch = message.channel;
  if (ch.isThread()) {
    const parent = ch.parent;
    const matches = lfgId ? ch.parentId === lfgId : parent?.name === 'lfg';
    return matches && parent?.type === ChannelType.GuildForum && message.id === ch.id;
  }
  return lfgId ? ch.id === lfgId : 'name' in ch && ch.name === 'lfg';
}

type Interpretation = {
  type: ContentType;
  confidence: number;
  present: { tank: boolean; healer: boolean; dps: boolean };
  when: keyof typeof WHEN | null;
};

async function interpret(text: string, guildId: string, flavor: WowFlavor, useJev: boolean): Promise<Interpretation | null> {
  const key = extractKeyLevel(text);
  if (useJev) {
    try {
      const res = await jev().ask(
        { post: text.slice(0, 1500) },
        {
          content: choice('What kind of group activity is `post` looking for players for?', contentOptions(flavor) as Record<string, string>),
          has_tank: noul('Does `post` say the group already has a tank?'),
          has_healer: noul('Does `post` say the group already has a healer?'),
          has_dps: noul('Does `post` say the group already has at least one damage dealer (DPS)?'),
          when: choice('When does `post` want to play?', WHEN),
        },
        { feature: 'lfg', guildId },
      );
      const a = res.answers;
      return {
        type: a.content.choice as ContentType,
        confidence: a.content.confidence,
        present: { tank: a.has_tank.noul >= 0.6, healer: a.has_healer.noul >= 0.6, dps: a.has_dps.noul >= 0.6 },
        when: a.when.confidence >= 0.5 ? (a.when.choice as keyof typeof WHEN) : null,
      };
    } catch (err) {
      if (!isJevUnavailable(err)) throw err;
    }
  }
  // Regex-only fallback: a key level is a strong enough signal on its own.
  if (key !== null) {
    return { type: flavor === 'retail' ? 'mplus' : 'dungeon', confidence: 1, present: { tank: false, healer: false, dps: false }, when: null };
  }
  return null;
}

function whenLabel(text: string, when: keyof typeof WHEN | null): string | null {
  const clock = extractClock(text);
  const day = when && when !== 'oklart' ? WHEN_LABEL[when] : null;
  const time = clock ? `${String(clock.hour).padStart(2, '0')}:${String(clock.minute).padStart(2, '0')}` : null;
  return [day, time].filter(Boolean).join(' ') || null;
}

async function applyForumTag(message: Message, type: ContentType): Promise<void> {
  const ch = message.channel;
  if (!ch.isThread() || ch.parent?.type !== ChannelType.GuildForum) return;
  const wanted = CONTENT_LABEL[type].toLowerCase();
  const alias: Record<string, string> = { delve: 'delves', annat: 'övrigt', övrigt: 'övrigt' };
  const tag = (ch.parent as ForumChannel).availableTags.find((t) => [wanted, alias[type] ?? ''].includes(t.name.toLowerCase()));
  if (tag && !ch.appliedTags.includes(tag.id)) await ch.setAppliedTags([...ch.appliedTags, tag.id].slice(0, 5)).catch(() => undefined);
}

async function handle(message: Message): Promise<void> {
  if (!(await isLfgPost(message))) return;
  const guildId = message.guildId!;
  if (!(await features().isEnabled(guildId, 'lfg'))) return;
  const text = message.content.trim();
  if (text.length < 4) return;
  const flavor = getConfig().wow.flavor;
  const useJev = jev().enabled && !jevOptOut().isOptedOut(message.author.id) && (await features().isEnabled(guildId, 'jev'));
  const result = await interpret(text, guildId, flavor, useJev);
  if (!result) return;
  if (result.type === 'inte_lfg' && result.confidence >= LFG_CONFIDENT) return;

  const needs = needsFromPresent(result.present);
  const res = await db.query<{ id: string }>(
    `INSERT INTO bot.lfg_posts (guild_id, channel_id, source_message_id, author_id, content_type, key_level, when_label, confidence, needs, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10)
     ON CONFLICT (source_message_id) DO NOTHING RETURNING id::text AS id`,
    [
      guildId, message.channelId, message.id, message.author.id, result.type, extractKeyLevel(text), whenLabel(text, result.when),
      result.confidence, JSON.stringify(needs), result.confidence >= LFG_CONFIDENT ? 'open' : 'pending',
    ],
  );
  const id = res.rows[0]?.id;
  if (!id) return;
  const post = (await loadPost(id))!;

  if (post.status === 'open') {
    await applyForumTag(message, result.type);
    const card = await message.reply(await renderCard(post));
    await db.query('UPDATE bot.lfg_posts SET message_id = $2 WHERE id = $1', [id, card.id]);
    return;
  }
  // Unsure: ask the author instead of guessing.
  const guess = result.type === 'inte_lfg' ? (flavor === 'retail' ? 'mplus' : 'dungeon') : result.type;
  // Max 5 buttons per row: the four most likely activity types plus "Inte LFG".
  const options = [...(Object.keys(contentOptions(flavor)) as ContentType[]).filter((t) => t !== 'inte_lfg').slice(0, 4), 'inte_lfg' as const];
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    ...options
      .map((t) =>
        new ButtonBuilder()
          .setCustomId(customId('lfg', 'type', id, t))
          .setLabel(CONTENT_LABEL[t])
          .setStyle(t === guess ? ButtonStyle.Primary : t === 'inte_lfg' ? ButtonStyle.Secondary : ButtonStyle.Secondary),
      ),
  );
  await message.reply({
    content: `🤔 <@${message.author.id}>, menade du **${CONTENT_LABEL[guess]}**? Tryck på rätt så gör jag ett gruppkort.`,
    components: [row],
    allowedMentions: { users: [message.author.id] },
  });
}

export const lfgHandler: MessageHandler = { name: 'lfg', handle };

async function onFull(post: LfgRow, channel: TextBasedChannel | null): Promise<string | null> {
  const guild = (channel && 'guild' in channel ? channel.guild : null) ?? null;
  if (!guild || !channel) return null;
  const parentId = channel.isThread() ? (channel.parent?.parentId ?? null) : 'parentId' in channel ? (channel.parentId ?? null) : null;
  const vc = await createTempVoice(db, guild, { name: title(post), parentId, ownerId: post.author_id, kind: 'lfg', userLimit: 5 });
  const everyone = [post.author_id, ...(await members(post.id)).map((m) => m.user_id)];
  const unique = [...new Set(everyone)];
  if ('send' in channel) {
    await channel.send({
      content: `🎉 Gruppen är full! Hoppa in i ${vc}: ${unique.map((u) => `<@${u}>`).join(' ')}`,
      allowedMentions: { users: unique },
    });
  }
  return vc.id;
}

export const lfgComponents: ComponentHandler = {
  prefix: 'lfg',
  async handle(interaction, parsed) {
    if (!interaction.isButton()) return;
    const [postId, arg] = parsed.args;
    const post = postId ? await loadPost(postId) : null;
    if (!post) throw new UserFacingError('Det här LFG-inlägget finns inte längre.');

    if (parsed.action === 'type') {
      if (interaction.user.id !== post.author_id) throw new UserFacingError('Bara den som skrev inlägget kan svara. 🙂');
      if (arg === 'inte_lfg') {
        await db.query(`UPDATE bot.lfg_posts SET status = 'ignored' WHERE id = $1`, [post.id]);
        await interaction.update({ content: '👍 Okej, jag håller mig undan.', components: [] });
        return;
      }
      await db.query(`UPDATE bot.lfg_posts SET content_type = $2, status = 'open' WHERE id = $1`, [post.id, arg]);
      const updated = (await loadPost(post.id))!;
      await interaction.update({ content: '', ...(await renderCard(updated)) });
      await db.query('UPDATE bot.lfg_posts SET message_id = $2 WHERE id = $1', [post.id, interaction.message.id]);
      return;
    }

    if (post.status !== 'open') throw new UserFacingError('Gruppen är redan full eller stängd.');
    if (parsed.action === 'leave') {
      const left = await db.query<{ role: Role }>('DELETE FROM bot.lfg_members WHERE post_id = $1 AND user_id = $2 RETURNING role', [post.id, interaction.user.id]);
      const role = left.rows[0]?.role;
      if (role) post.needs[role] += 1;
    } else {
      const role = arg as Role;
      if (!['tank', 'healer', 'dps'].includes(role)) throw new UserFacingError('Okänd roll.');
      const prev = await db.query<{ role: Role }>('SELECT role FROM bot.lfg_members WHERE post_id = $1 AND user_id = $2', [post.id, interaction.user.id]);
      const prevRole = prev.rows[0]?.role;
      if (prevRole === role) {
        await interaction.reply({ content: 'Du är redan med som den rollen. 😄', flags: MessageFlags.Ephemeral });
        return;
      }
      if (post.needs[role] <= 0) throw new UserFacingError(`Det finns ingen plats för ${ROLE_LABEL[role]} kvar.`);
      if (prevRole) post.needs[prevRole] += 1;
      post.needs[role] -= 1;
      await db.query(
        `INSERT INTO bot.lfg_members (post_id, user_id, role) VALUES ($1, $2, $3)
         ON CONFLICT (post_id, user_id) DO UPDATE SET role = EXCLUDED.role`,
        [post.id, interaction.user.id, role],
      );
    }
    const full = isFull(post.needs);
    post.status = full ? 'full' : 'open';
    await db.query('UPDATE bot.lfg_posts SET needs = $2::jsonb, status = $3 WHERE id = $1', [post.id, JSON.stringify(post.needs), post.status]);
    if (full) {
      try {
        post.voice_channel_id = await onFull(post, interaction.channel);
        if (post.voice_channel_id) await db.query('UPDATE bot.lfg_posts SET voice_channel_id = $2 WHERE id = $1', [post.id, post.voice_channel_id]);
      } catch (err) {
        log.warn({ err, postId: post.id }, 'could not create LFG voice channel');
      }
    }
    await interaction.update(await renderCard(post));
  },
};
