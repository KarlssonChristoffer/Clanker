/**
 * Per-guild feature flags (bot.guild_features) and per-channel opt-ins (bot.channel_features).
 * A missing row means the default from FEATURES. Reads are cached for 30 s; writes invalidate.
 */
import { childLogger } from './logger.js';
import type { Queryable } from './scheduler.js';
import { UserFacingError } from './interaction-errors.js';

const log = childLogger('features');

export type FeatureDef = {
  label: string;
  description: string;
  default: boolean;
  /** Also needs a per-channel opt-in (`isChannelEnabled`). */
  perChannel?: boolean;
};

export const FEATURES = {
  musik: { label: 'Musik', description: '/play, kön och spellistor', default: true },
  citat: { label: 'Citatboken', description: '💬-reaktion sparar citat, /citat visar dem', default: true },
  jev: { label: 'Jev', description: '/vibe, /orakel, /tankeläsare (kräver TYPESAFE_API_KEY)', default: true },
  jev_reflexer: {
    label: 'Jev-reflexer',
    description: 'Emoji-reaktioner på meddelanden, bara i kanaler som slagits på med /jev reflexer',
    default: false,
    perChannel: true,
  },
  raid: { label: 'Raid- och M+-anmälan', description: '/raid skapa med knappar, event och påminnelse', default: true },
  lfg: { label: 'LFG-tolkning', description: 'Jev läser #lfg och gör om inlägg till gruppkort', default: true },
  wow: { label: 'WoW-karaktärer', description: '/wow koppla, /wow karaktär, /roster', default: true },
  reset_post: { label: 'Reset-inlägg', description: '"Ny vecka" i #annonser vid weekly reset', default: false },
  join_to_create: { label: 'Skapa-grupp-röst', description: 'Egen röstkanal när man går in i ➕ Skapa grupp', default: true },
  spelkvall: { label: 'Spelkväll och påminnelser', description: '/spelkväll och /påminn', default: true },
  veckorapport: { label: 'Veckorapport', description: 'Söndagskvällens sammanfattning i #annonser', default: false },
} as const satisfies Record<string, FeatureDef>;

export type FeatureKey = keyof typeof FEATURES;

export function isFeatureKey(value: string): value is FeatureKey {
  return Object.prototype.hasOwnProperty.call(FEATURES, value);
}

const CACHE_TTL_MS = 30_000;

type GuildCache = { at: number; flags: Map<string, boolean> };
type ChannelCache = { at: number; enabled: boolean };

export class FeatureFlags {
  private readonly guildCache = new Map<string, GuildCache>();
  private readonly channelCache = new Map<string, ChannelCache>();

  constructor(private readonly db: Queryable, private readonly now: () => number = Date.now) {}

  private async guildFlags(guildId: string): Promise<Map<string, boolean>> {
    const cached = this.guildCache.get(guildId);
    if (cached && this.now() - cached.at < CACHE_TTL_MS) return cached.flags;
    const res = await this.db.query<{ feature: string; enabled: boolean }>(
      'SELECT feature, enabled FROM bot.guild_features WHERE guild_id = $1',
      [guildId],
    );
    const flags = new Map(res.rows.map((r) => [r.feature, r.enabled]));
    this.guildCache.set(guildId, { at: this.now(), flags });
    return flags;
  }

  async isEnabled(guildId: string | null | undefined, feature: FeatureKey): Promise<boolean> {
    if (!guildId) return false;
    try {
      const flags = await this.guildFlags(guildId);
      return flags.get(feature) ?? FEATURES[feature].default;
    } catch (err) {
      log.warn({ err, guildId, feature }, 'feature lookup failed; using default');
      return FEATURES[feature].default;
    }
  }

  /** Guild flag AND a per-channel opt-in row. */
  async isChannelEnabled(guildId: string | null | undefined, channelId: string, feature: FeatureKey): Promise<boolean> {
    if (!(await this.isEnabled(guildId, feature))) return false;
    const key = `${channelId}:${feature}`;
    const cached = this.channelCache.get(key);
    if (cached && this.now() - cached.at < CACHE_TTL_MS) return cached.enabled;
    try {
      const res = await this.db.query<{ enabled: boolean }>(
        'SELECT enabled FROM bot.channel_features WHERE channel_id = $1 AND feature = $2',
        [channelId, feature],
      );
      const enabled = res.rows[0]?.enabled ?? false;
      this.channelCache.set(key, { at: this.now(), enabled });
      return enabled;
    } catch (err) {
      log.warn({ err, channelId, feature }, 'channel feature lookup failed');
      return false;
    }
  }

  async setEnabled(guildId: string, feature: FeatureKey, enabled: boolean, userId: string): Promise<void> {
    await this.db.query(
      `INSERT INTO bot.guild_features (guild_id, feature, enabled, updated_by, updated_at)
       VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (guild_id, feature) DO UPDATE
         SET enabled = EXCLUDED.enabled, updated_by = EXCLUDED.updated_by, updated_at = now()`,
      [guildId, feature, enabled, userId],
    );
    this.guildCache.delete(guildId);
    log.info({ guildId, feature, enabled, userId }, 'feature flag changed');
  }

  async setChannelEnabled(guildId: string, channelId: string, feature: FeatureKey, enabled: boolean, userId: string): Promise<void> {
    await this.db.query(
      `INSERT INTO bot.channel_features (guild_id, channel_id, feature, enabled, updated_by, updated_at)
       VALUES ($1, $2, $3, $4, $5, now())
       ON CONFLICT (channel_id, feature) DO UPDATE
         SET enabled = EXCLUDED.enabled, updated_by = EXCLUDED.updated_by, updated_at = now()`,
      [guildId, channelId, feature, enabled, userId],
    );
    this.channelCache.delete(`${channelId}:${feature}`);
  }

  async listForGuild(guildId: string): Promise<{ key: FeatureKey; def: FeatureDef; enabled: boolean; overridden: boolean }[]> {
    const flags = await this.guildFlags(guildId);
    return (Object.keys(FEATURES) as FeatureKey[]).map((key) => ({
      key,
      def: FEATURES[key],
      enabled: flags.get(key) ?? FEATURES[key].default,
      overridden: flags.has(key),
    }));
  }

  /** Throws a friendly UserFacingError when the feature is off in this guild. */
  async require(guildId: string | null | undefined, feature: FeatureKey): Promise<void> {
    if (!guildId) throw new UserFacingError('Det här fungerar bara i en server, inte i DM. 🙃');
    if (!(await this.isEnabled(guildId, feature))) {
      throw new UserFacingError(
        `🔌 **${FEATURES[feature].label}** är avstängt här. En admin kan slå på det med \`/admin funktioner\`.`,
      );
    }
  }
}

let instance: FeatureFlags | null = null;

export function initFeatures(db: Queryable): FeatureFlags {
  instance = new FeatureFlags(db);
  return instance;
}

export function features(): FeatureFlags {
  if (!instance) throw new Error('Feature flags not initialised');
  return instance;
}

/** Shorthand used by modules: `await isEnabled(guildId, 'citat')`. */
export function isEnabled(guildId: string | null | undefined, feature: FeatureKey): Promise<boolean> {
  return features().isEnabled(guildId, feature);
}
