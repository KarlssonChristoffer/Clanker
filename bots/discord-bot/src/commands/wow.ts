/**
 * /wow koppla <namn> <realm> [klass] [roll] [spec] [ilvl]   link a character (realm autocomplete)
 * /wow karaktär [användare]                                 show someone's character(s)
 * /roster [sortering]                                       everyone's mains: class, spec, ilvl, M+ score
 * With an API (retail: Raider.IO) data is fetched and refreshed (15 min cache); for WoW Forever the
 * player enters class/role/spec/ilvl and the "realm" is the ruleset.
 */
import { EmbedBuilder, SlashCommandBuilder, type User } from 'discord.js';
import type { SlashCommand } from '../core/commands.js';
import { getConfig } from '../core/config.js';
import { features } from '../core/features.js';
import { UserFacingError } from '../core/interaction-errors.js';
import { childLogger } from '../core/logger.js';
import { db } from '../db.js';
import { classesFor, findClass, ROLE_EMOJI, ROLE_LABEL, type Role } from '../wow/game-data.js';
import { createDataSource, slugifyRealm, type CharacterProfile, type WowDataSource } from '../wow/data-source.js';
import { EPHEMERAL, requireGuildId } from './_shared.js';

const log = childLogger('wow');
const REFRESH_AFTER_MS = 15 * 60_000;

let source: WowDataSource | null = null;
export function wowSource(): WowDataSource {
  if (!source) source = createDataSource(getConfig().wow);
  return source;
}

type CharacterRow = {
  id: string;
  user_id: string;
  name: string;
  realm: string;
  realm_slug: string;
  class: string | null;
  spec: string | null;
  role: Role | null;
  item_level: number | null;
  mplus_score: number | null;
  source: string;
  profile_url: string | null;
  is_main: boolean;
  fetched_at: Date | null;
};

async function saveCharacter(guildId: string, userId: string, p: CharacterProfile): Promise<void> {
  const { flavor, region } = getConfig().wow;
  await db.query('UPDATE bot.wow_characters SET is_main = false WHERE guild_id = $1 AND user_id = $2 AND flavor = $3', [guildId, userId, flavor]);
  await db.query(
    `INSERT INTO bot.wow_characters
       (guild_id, user_id, flavor, region, name, realm, realm_slug, class, spec, role, item_level, mplus_score, source, profile_url, is_main, fetched_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14, true, $15, now())
     ON CONFLICT (guild_id, user_id, flavor, realm_slug, lower(name)) DO UPDATE SET
       name = EXCLUDED.name, realm = EXCLUDED.realm, class = EXCLUDED.class, spec = EXCLUDED.spec, role = EXCLUDED.role,
       item_level = EXCLUDED.item_level, mplus_score = EXCLUDED.mplus_score, source = EXCLUDED.source,
       profile_url = EXCLUDED.profile_url, is_main = true, fetched_at = EXCLUDED.fetched_at, updated_at = now()`,
    [
      guildId, userId, flavor, region, p.name, p.realm, p.realmSlug, p.className, p.spec, p.role,
      p.itemLevel, p.mplusScore, p.source, p.profileUrl, p.source === 'manual' ? null : new Date(),
    ],
  );
}

function fmtNumber(n: number | null, digits = 0): string {
  return n === null || n === undefined ? '–' : Number(n).toLocaleString('sv-SE', { maximumFractionDigits: digits });
}

function characterEmbed(c: Pick<CharacterRow, 'name' | 'realm' | 'class' | 'spec' | 'role' | 'item_level' | 'mplus_score' | 'profile_url' | 'source'>, owner?: User) {
  const flavor = getConfig().wow.flavor;
  const cls = findClass(flavor, c.class);
  const embed = new EmbedBuilder()
    .setTitle(`${c.name} · ${c.realm}`)
    .setColor(cls?.color ?? 0x95a5a6)
    .addFields(
      { name: 'Klass', value: [c.class ?? '–', c.spec].filter(Boolean).join(' · '), inline: true },
      { name: 'Roll', value: c.role ? `${ROLE_EMOJI[c.role]} ${ROLE_LABEL[c.role]}` : '–', inline: true },
      { name: 'Item level', value: fmtNumber(c.item_level, 1), inline: true },
    );
  if (wowSource().supportsMythicPlus) embed.addFields({ name: 'M+ score', value: fmtNumber(c.mplus_score), inline: true });
  if (owner) embed.setAuthor({ name: owner.displayName, iconURL: owner.displayAvatarURL() });
  if (c.profile_url) embed.setURL(c.profile_url);
  embed.setFooter({ text: c.source === 'raiderio' ? 'Data: Raider.IO' : c.source === 'blizzard' ? 'Data: Blizzard' : 'Manuellt inlagd' });
  return embed;
}

async function koppla(interaction: Parameters<SlashCommand['execute']>[0]): Promise<void> {
  const guildId = requireGuildId(interaction);
  const flavor = getConfig().wow.flavor;
  const name = interaction.options.getString('namn', true).trim();
  const realmInput = interaction.options.getString('realm') ?? getConfig().wow.defaultRealm;
  if (!realmInput) throw new UserFacingError(flavor === 'forever' ? 'Välj ruleset (Normal, PvP, Roleplaying eller Hardcore).' : 'Ange realm.');
  const realmSlug = slugifyRealm(realmInput);
  const klass = interaction.options.getString('klass');
  const role = interaction.options.getString('roll') as Role | null;
  const spec = interaction.options.getString('spec');
  const ilvl = interaction.options.getNumber('ilvl');
  const src = wowSource();
  await interaction.deferReply({ flags: EPHEMERAL });

  let profile: CharacterProfile | null = null;
  if (src.supportsLookup) {
    try {
      profile = await src.lookup(name, realmSlug);
    } catch (err) {
      log.warn({ err, name, realmSlug }, 'character lookup failed');
    }
  }
  if (!profile) {
    const cls = findClass(flavor, klass);
    if (!cls) {
      throw new UserFacingError(
        src.supportsLookup
          ? `🔍 Hittade ingen **${name}** på **${realmInput}**. Stavat rätt? Du kan också lägga in den manuellt med alternativen \`klass\` och \`roll\`.`
          : `✍️ ${flavor === 'forever' ? 'WoW Forever' : 'Den här spelvarianten'} har inget publikt API ännu, så ange \`klass\` (och gärna \`roll\`, \`spec\`, \`ilvl\`).`,
      );
    }
    const chosenRole: Role | null = role && cls.roles.includes(role) ? role : cls.roles.length === 1 ? cls.roles[0]! : role ?? null;
    profile = {
      name: name.charAt(0).toUpperCase() + name.slice(1),
      realm: realmInput,
      realmSlug,
      className: cls.name,
      spec: spec ?? null,
      role: chosenRole,
      itemLevel: ilvl ?? null,
      mplusScore: null,
      profileUrl: null,
      source: 'manual',
    };
  } else {
    if (role) profile.role = role;
    if (spec && !profile.spec) profile.spec = spec;
  }
  await saveCharacter(guildId, interaction.user.id, profile);
  await interaction.editReply({
    content: '🔗 Kopplad! Den här är nu din main.',
    embeds: [
      characterEmbed(
        {
          name: profile.name,
          realm: profile.realm,
          class: profile.className,
          spec: profile.spec,
          role: profile.role,
          item_level: profile.itemLevel,
          mplus_score: profile.mplusScore,
          profile_url: profile.profileUrl,
          source: profile.source,
        },
        interaction.user,
      ),
    ],
  });
}

async function refreshIfStale(guildId: string, row: CharacterRow): Promise<CharacterRow> {
  const src = wowSource();
  if (!src.supportsLookup || row.source === 'manual') return row;
  if (row.fetched_at && Date.now() - new Date(row.fetched_at).getTime() < REFRESH_AFTER_MS) return row;
  try {
    const fresh = await src.lookup(row.name, row.realm_slug);
    if (!fresh) return row;
    await saveCharacter(guildId, row.user_id, { ...fresh, role: row.role ?? fresh.role });
    return { ...row, class: fresh.className, spec: fresh.spec, item_level: fresh.itemLevel, mplus_score: fresh.mplusScore, profile_url: fresh.profileUrl, fetched_at: new Date() };
  } catch (err) {
    log.warn({ err, character: row.name }, 'refresh failed; showing cached data');
    return row;
  }
}

async function karaktar(interaction: Parameters<SlashCommand['execute']>[0]): Promise<void> {
  const guildId = requireGuildId(interaction);
  const user = interaction.options.getUser('användare') ?? interaction.user;
  const res = await db.query<CharacterRow>(
    `SELECT id::text AS id, user_id, name, realm, realm_slug, class, spec, role, item_level, mplus_score, source, profile_url, is_main, fetched_at
     FROM bot.wow_characters WHERE guild_id = $1 AND user_id = $2 AND flavor = $3 ORDER BY is_main DESC, updated_at DESC LIMIT 6`,
    [guildId, user.id, getConfig().wow.flavor],
  );
  if (!res.rows.length) {
    throw new UserFacingError(user.id === interaction.user.id ? 'Du har inte kopplat någon karaktär än. Kör `/wow koppla`!' : `${user.displayName} har inte kopplat någon karaktär än.`);
  }
  await interaction.deferReply();
  const main = await refreshIfStale(guildId, res.rows[0]!);
  const embed = characterEmbed(main, user);
  const alts = res.rows.slice(1);
  if (alts.length) embed.addFields({ name: 'Alts', value: alts.map((a) => `${a.name} · ${a.class ?? '?'}${a.item_level ? ` · ${fmtNumber(a.item_level)}` : ''}`).join('\n') });
  await interaction.editReply({ embeds: [embed] });
}

export const wowCommand: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('wow')
    .setDescription('WoW-karaktärer.')
    .addSubcommand((s) =>
      s
        .setName('koppla')
        .setDescription('Koppla din karaktär (blir din main).')
        .addStringOption((o) => o.setName('namn').setDescription('Karaktärens namn').setRequired(true).setMaxLength(24))
        .addStringOption((o) => o.setName('realm').setDescription('Realm (WoW Forever: ruleset)').setAutocomplete(true))
        .addStringOption((o) => o.setName('klass').setDescription('Klass (krävs när data inte kan hämtas automatiskt)').setAutocomplete(true))
        .addStringOption((o) =>
          o.setName('roll').setDescription('Din huvudroll').addChoices({ name: 'Tank', value: 'tank' }, { name: 'Healer', value: 'healer' }, { name: 'DPS', value: 'dps' }),
        )
        .addStringOption((o) => o.setName('spec').setDescription('Spec, t.ex. Frost').setMaxLength(30))
        .addNumberOption((o) => o.setName('ilvl').setDescription('Item level').setMinValue(1).setMaxValue(1000)),
    )
    .addSubcommand((s) =>
      s
        .setName('karaktär')
        .setDescription('Visa någons karaktär.')
        .addUserOption((o) => o.setName('användare').setDescription('Vem? (standard: du)')),
    ),
  async execute(interaction) {
    await features().require(interaction.guildId, 'wow');
    const sub = interaction.options.getSubcommand(true);
    if (sub === 'koppla') return koppla(interaction);
    return karaktar(interaction);
  },
  async autocomplete(interaction) {
    const focused = interaction.options.getFocused(true);
    if (focused.name === 'realm') {
      const realms = await wowSource().realms(String(focused.value));
      await interaction.respond(realms.slice(0, 25).map((r) => ({ name: r.name.slice(0, 100), value: r.name.slice(0, 100) })));
      return;
    }
    if (focused.name === 'klass') {
      const q = String(focused.value).toLowerCase();
      const classes = classesFor(getConfig().wow.flavor).filter((c) => c.name.toLowerCase().includes(q));
      await interaction.respond(classes.slice(0, 25).map((c) => ({ name: c.name, value: c.name })));
      return;
    }
    await interaction.respond([]);
  },
};

export const roster: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('roster')
    .setDescription('Allas mains: klass, spec, item level och M+ score.')
    .addStringOption((o) =>
      o
        .setName('sortering')
        .setDescription('Standard: item level')
        .addChoices({ name: 'item level', value: 'ilvl' }, { name: 'M+ score', value: 'score' }, { name: 'klass', value: 'class' }),
    ),
  async execute(interaction) {
    const guildId = requireGuildId(interaction);
    await features().require(guildId, 'wow');
    const sort = interaction.options.getString('sortering') ?? 'ilvl';
    const orderBy =
      sort === 'score' ? 'mplus_score DESC NULLS LAST, item_level DESC NULLS LAST' : sort === 'class' ? 'class NULLS LAST, item_level DESC NULLS LAST' : 'item_level DESC NULLS LAST, mplus_score DESC NULLS LAST';
    const res = await db.query<CharacterRow>(
      `SELECT id::text AS id, user_id, name, realm, realm_slug, class, spec, role, item_level, mplus_score, source, profile_url, is_main, fetched_at
       FROM bot.wow_characters WHERE guild_id = $1 AND flavor = $2 AND is_main ORDER BY ${orderBy}`,
      [guildId, getConfig().wow.flavor],
    );
    if (!res.rows.length) throw new UserFacingError('📋 Rostern är tom. Koppla era karaktärer med `/wow koppla`!');
    const showScore = wowSource().supportsMythicPlus;
    const line = (c: CharacterRow) =>
      `**${c.name}** · ${c.class ?? '?'}${c.spec ? ` ${c.spec}` : ''} · ${fmtNumber(c.item_level)} ilvl${showScore && c.mplus_score ? ` · ${fmtNumber(c.mplus_score)} M+` : ''} · <@${c.user_id}>`;
    const embeds: EmbedBuilder[] = [];
    for (const role of ['tank', 'healer', 'dps', null] as (Role | null)[]) {
      const rows = res.rows.filter((r) => r.role === role);
      if (!rows.length) continue;
      const title = role ? `${ROLE_EMOJI[role]} ${ROLE_LABEL[role]} (${rows.length})` : `❔ Ingen roll angiven (${rows.length})`;
      let text = rows.map(line).join('\n');
      if (text.length > 4000) text = `${text.slice(0, 3990)}\n…`;
      embeds.push(new EmbedBuilder().setTitle(title).setDescription(text).setColor(role === 'tank' ? 0x3498db : role === 'healer' ? 0x2ecc71 : 0xe74c3c));
    }
    embeds[0]!.setAuthor({ name: `Roster · ${res.rows.length} karaktärer` });
    await interaction.reply({ embeds: embeds.slice(0, 10), allowedMentions: { parse: [] } });
  },
};
