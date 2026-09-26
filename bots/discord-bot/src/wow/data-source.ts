/**
 * WoW data behind one interface so flavors can differ:
 *  - retail:  Raider.IO (class/spec/role/ilvl/M+ score) + Blizzard realm index for autocomplete.
 *  - classic: Blizzard Profile API with a classic namespace (profile-classic1x-eu by default).
 *  - forever: WoW Forever has no public API yet (verified 2026-09-26) → manual entry, realms are
 *             rulesets. Setting WOW_PROFILE_NAMESPACE later switches it to the Blizzard lookup.
 * Endpoints verified 2026-09-26: token https://oauth.battle.net/token (client credentials, Basic auth,
 * 24 h), Bearer header only, Battlenet-Namespace header, eu.api.blizzard.com, locale en_GB;
 * Raider.IO GET /api/v1/characters/profile?region&realm&name&fields.
 */
import type { WowFlavor } from '../core/config.js';
import { childLogger } from '../core/logger.js';
import { FOREVER_RULESETS, findClass, type Role } from './game-data.js';

const log = childLogger('wow-data');

export type CharacterProfile = {
  name: string;
  realm: string;
  realmSlug: string;
  className: string | null;
  spec: string | null;
  role: Role | null;
  itemLevel: number | null;
  mplusScore: number | null;
  profileUrl: string | null;
  source: 'blizzard' | 'raiderio' | 'manual';
};

export type RealmOption = { name: string; slug: string };

export interface WowDataSource {
  readonly flavor: WowFlavor;
  /** Can characters be looked up automatically? (false → manual class/spec/role/ilvl) */
  readonly supportsLookup: boolean;
  readonly supportsMythicPlus: boolean;
  realms(query: string): Promise<RealmOption[]>;
  lookup(name: string, realmSlug: string): Promise<CharacterProfile | null>;
}

export function slugifyRealm(realm: string): string {
  return realm
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

type FetchLike = typeof fetch;

// ── Small TTL cache ──────────────────────────────────────────────────────────

class TtlCache<V> {
  private readonly map = new Map<string, { at: number; value: V }>();
  constructor(private readonly ttlMs: number, private readonly max = 500) {}
  get(key: string): V | undefined {
    const hit = this.map.get(key);
    if (!hit) return undefined;
    if (Date.now() - hit.at > this.ttlMs) {
      this.map.delete(key);
      return undefined;
    }
    return hit.value;
  }
  set(key: string, value: V): void {
    if (this.map.size >= this.max) this.map.delete(this.map.keys().next().value!);
    this.map.set(key, { at: Date.now(), value });
  }
}

// ── Blizzard ─────────────────────────────────────────────────────────────────

export class BlizzardClient {
  private token: { value: string; expiresAt: number } | null = null;

  constructor(
    private readonly clientId: string,
    private readonly clientSecret: string,
    private readonly region: string,
    private readonly locale: string,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  private async accessToken(): Promise<string> {
    if (this.token && Date.now() < this.token.expiresAt - 60_000) return this.token.value;
    const res = await this.fetchImpl('https://oauth.battle.net/token', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`Blizzard OAuth failed: HTTP ${res.status}`);
    const json = (await res.json()) as { access_token: string; expires_in: number };
    this.token = { value: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 };
    return this.token.value;
  }

  /** GET with namespace header; returns null on 404. */
  async get<T>(path: string, namespace: string): Promise<T | null> {
    const url = `https://${this.region}.api.blizzard.com${path}${path.includes('?') ? '&' : '?'}locale=${this.locale}`;
    const res = await this.fetchImpl(url, {
      headers: { Authorization: `Bearer ${await this.accessToken()}`, 'Battlenet-Namespace': namespace },
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status === 404) return null;
    if (res.status === 401) this.token = null;
    if (!res.ok) throw new Error(`Blizzard API ${path}: HTTP ${res.status}`);
    return (await res.json()) as T;
  }
}

type BlizzardRealmIndex = { realms: { name: string; slug: string }[] };
type BlizzardCharacter = {
  name: string;
  realm: { name: string; slug: string };
  character_class?: { name: string };
  active_spec?: { name: string };
  equipped_item_level?: number;
  average_item_level?: number;
};

async function blizzardRealms(client: BlizzardClient, namespace: string, cache: TtlCache<RealmOption[]>): Promise<RealmOption[]> {
  const cached = cache.get(namespace);
  if (cached) return cached;
  const index = await client.get<BlizzardRealmIndex>('/data/wow/realm/index', namespace);
  const realms = (index?.realms ?? []).map((r) => ({ name: r.name, slug: r.slug })).sort((a, b) => a.name.localeCompare(b.name));
  cache.set(namespace, realms);
  return realms;
}

function filterRealms(all: RealmOption[], query: string): RealmOption[] {
  const q = query.trim().toLowerCase();
  const hits = q ? all.filter((r) => r.name.toLowerCase().includes(q) || r.slug.includes(slugifyRealm(q))) : all;
  return hits.slice(0, 25);
}

// ── Raider.IO ────────────────────────────────────────────────────────────────

type RaiderIoProfile = {
  name: string;
  realm: string;
  class?: string;
  active_spec_name?: string;
  active_spec_role?: string;
  profile_url?: string;
  gear?: { item_level_equipped?: number };
  mythic_plus_scores_by_season?: { scores?: { all?: number } }[];
};

export class RaiderIoClient {
  private readonly cache = new TtlCache<RaiderIoProfile | null>(15 * 60_000);
  private nextAllowedAt = 0;

  constructor(private readonly region: string, private readonly accessKey?: string, private readonly fetchImpl: FetchLike = fetch) {}

  /** Cached 15 min; at most one request per second (be nice to their rate limits). */
  async profile(name: string, realmSlug: string): Promise<RaiderIoProfile | null> {
    const key = `${realmSlug}/${name.toLowerCase()}`;
    const cached = this.cache.get(key);
    if (cached !== undefined) return cached;
    const wait = this.nextAllowedAt - Date.now();
    this.nextAllowedAt = Math.max(Date.now(), this.nextAllowedAt) + 1_000;
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    const params = new URLSearchParams({
      region: this.region,
      realm: realmSlug,
      name,
      fields: 'gear,mythic_plus_scores_by_season:current',
    });
    if (this.accessKey) params.set('access_key', this.accessKey);
    const res = await this.fetchImpl(`https://raider.io/api/v1/characters/profile?${params}`, { signal: AbortSignal.timeout(10_000) });
    if (res.status === 400 || res.status === 404) {
      this.cache.set(key, null);
      return null;
    }
    if (res.status === 429) {
      const retry = Number(res.headers.get('retry-after') ?? '10');
      this.nextAllowedAt = Date.now() + retry * 1000;
      throw new Error('Raider.IO rate limit, try again shortly');
    }
    if (!res.ok) throw new Error(`Raider.IO HTTP ${res.status}`);
    const json = (await res.json()) as RaiderIoProfile;
    this.cache.set(key, json);
    return json;
  }
}

function roleFromRio(role: string | undefined): Role | null {
  if (role === 'TANK') return 'tank';
  if (role === 'HEALING') return 'healer';
  if (role === 'DPS') return 'dps';
  return null;
}

// ── Sources ──────────────────────────────────────────────────────────────────

export class RetailSource implements WowDataSource {
  readonly flavor = 'retail' as const;
  readonly supportsLookup = true;
  readonly supportsMythicPlus = true;
  private readonly realmCache = new TtlCache<RealmOption[]>(24 * 3600_000);

  constructor(private readonly region: string, private readonly rio: RaiderIoClient, private readonly blizzard: BlizzardClient | null) {}

  async realms(query: string): Promise<RealmOption[]> {
    if (!this.blizzard) return query.trim() ? [{ name: query.trim(), slug: slugifyRealm(query) }] : [];
    try {
      return filterRealms(await blizzardRealms(this.blizzard, `dynamic-${this.region}`, this.realmCache), query);
    } catch (err) {
      log.warn({ err }, 'realm index failed');
      return query.trim() ? [{ name: query.trim(), slug: slugifyRealm(query) }] : [];
    }
  }

  async lookup(name: string, realmSlug: string): Promise<CharacterProfile | null> {
    const p = await this.rio.profile(name, realmSlug);
    if (!p) return null;
    const score = p.mythic_plus_scores_by_season?.[0]?.scores?.all;
    return {
      name: p.name,
      realm: p.realm,
      realmSlug,
      className: p.class ?? null,
      spec: p.active_spec_name ?? null,
      role: roleFromRio(p.active_spec_role),
      itemLevel: p.gear?.item_level_equipped ?? null,
      mplusScore: typeof score === 'number' ? score : null,
      profileUrl: p.profile_url ?? null,
      source: 'raiderio',
    };
  }
}

/** Blizzard Profile API with a configurable namespace (Classic Era, Anniversary, or Forever once it exists). */
export class BlizzardProfileSource implements WowDataSource {
  readonly supportsLookup = true;
  readonly supportsMythicPlus = false;
  private readonly realmCache = new TtlCache<RealmOption[]>(24 * 3600_000);

  constructor(
    readonly flavor: WowFlavor,
    private readonly blizzard: BlizzardClient,
    /** e.g. "classic1x" → profile-classic1x-eu / dynamic-classic1x-eu */
    private readonly namespaceSuffix: string,
    private readonly region: string,
  ) {}

  async realms(query: string): Promise<RealmOption[]> {
    try {
      return filterRealms(await blizzardRealms(this.blizzard, `dynamic-${this.namespaceSuffix}-${this.region}`, this.realmCache), query);
    } catch (err) {
      log.warn({ err }, 'realm index failed');
      return query.trim() ? [{ name: query.trim(), slug: slugifyRealm(query) }] : [];
    }
  }

  async lookup(name: string, realmSlug: string): Promise<CharacterProfile | null> {
    const c = await this.blizzard.get<BlizzardCharacter>(
      `/profile/wow/character/${encodeURIComponent(realmSlug)}/${encodeURIComponent(name.toLowerCase())}`,
      `profile-${this.namespaceSuffix}-${this.region}`,
    );
    if (!c) return null;
    const cls = findClass(this.flavor, c.character_class?.name);
    return {
      name: c.name,
      realm: c.realm.name,
      realmSlug: c.realm.slug,
      className: cls?.name ?? c.character_class?.name ?? null,
      spec: c.active_spec?.name ?? null,
      role: null,
      itemLevel: c.equipped_item_level ?? c.average_item_level ?? null,
      mplusScore: null,
      profileUrl: null,
      source: 'blizzard',
    };
  }
}

/** No API: players enter class/spec/role/ilvl themselves; "realms" are Forever rulesets. */
export class ManualSource implements WowDataSource {
  readonly supportsLookup = false;
  readonly supportsMythicPlus = false;

  constructor(readonly flavor: WowFlavor, private readonly defaultRealm?: string) {}

  async realms(query: string): Promise<RealmOption[]> {
    const base: RealmOption[] = this.flavor === 'forever' ? FOREVER_RULESETS.map((r) => ({ name: r.name, slug: r.slug })) : [];
    if (this.defaultRealm && !base.some((r) => r.slug === slugifyRealm(this.defaultRealm!))) {
      base.unshift({ name: this.defaultRealm, slug: slugifyRealm(this.defaultRealm) });
    }
    const typed = query.trim();
    const hits = filterRealms(base, typed);
    if (typed && !hits.some((r) => r.slug === slugifyRealm(typed))) hits.push({ name: typed, slug: slugifyRealm(typed) });
    return hits.slice(0, 25);
  }

  async lookup(): Promise<CharacterProfile | null> {
    return null;
  }
}

export function createDataSource(cfg: {
  flavor: WowFlavor;
  region: string;
  locale: string;
  blizzardClientId?: string;
  blizzardClientSecret?: string;
  profileNamespace?: string;
  raiderIoAccessKey?: string;
  defaultRealm?: string;
}): WowDataSource {
  const blizzard =
    cfg.blizzardClientId && cfg.blizzardClientSecret
      ? new BlizzardClient(cfg.blizzardClientId, cfg.blizzardClientSecret, cfg.region, cfg.locale)
      : null;
  if (cfg.flavor === 'retail') return new RetailSource(cfg.region, new RaiderIoClient(cfg.region, cfg.raiderIoAccessKey), blizzard);
  const namespace = cfg.profileNamespace ?? (cfg.flavor === 'classic' ? 'classic1x' : undefined);
  if (blizzard && namespace) return new BlizzardProfileSource(cfg.flavor, blizzard, namespace, cfg.region);
  return new ManualSource(cfg.flavor, cfg.defaultRealm);
}
