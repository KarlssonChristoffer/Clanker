import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SlashCommandBuilder } from 'discord.js';
import { CommandRegistry, type SlashCommand } from '../src/core/commands.js';
import { ComponentRegistry, customId, parseCustomId } from '../src/core/components.js';
import { FeatureFlags } from '../src/core/features.js';
import { createTestDb, type TestDb } from './helpers/test-db.js';

const noop = async () => undefined;

function cmd(name: string): SlashCommand {
  return { data: new SlashCommandBuilder().setName(name).setDescription(`${name} desc`), execute: noop };
}

describe('CommandRegistry', () => {
  it('rejects duplicate names and returns sorted definitions', () => {
    expect(() => new CommandRegistry([cmd('a'), cmd('a')])).toThrow(/Duplicate/);
    const reg = new CommandRegistry([cmd('zeta'), cmd('alfa')]);
    expect(reg.definitions().map((d) => d.name)).toEqual(['alfa', 'zeta']);
    expect(reg.get('zeta')).toBeDefined();
    expect(reg.get('missing')).toBeUndefined();
  });
});

describe('customId routing', () => {
  it('builds and parses prefix:action:args', () => {
    const id = customId('raid', 'join', 42, 'tank');
    expect(id).toBe('raid:join:42:tank');
    expect(parseCustomId(id)).toEqual({ prefix: 'raid', action: 'join', args: ['42', 'tank'] });
  });

  it('rejects separators inside parts and ids over 100 chars', () => {
    expect(() => customId('raid', 'jo:in')).toThrow();
    expect(() => customId('x', 'y', 'z'.repeat(100))).toThrow(/too long/);
  });

  it('resolves handlers by prefix', () => {
    const reg = new ComponentRegistry([{ prefix: 'raid', handle: noop }, { prefix: 'mind', handle: noop }]);
    expect(reg.resolve('raid:join:1:dps')?.handler.prefix).toBe('raid');
    expect(reg.resolve('nope:x')).toBeUndefined();
    expect(() => new ComponentRegistry([{ prefix: 'a', handle: noop }, { prefix: 'a', handle: noop }])).toThrow();
  });
});

describe('FeatureFlags', () => {
  let t: TestDb;
  let now = 0;
  beforeEach(async () => {
    t = await createTestDb();
    now = 1_000_000;
  }, 60_000);
  afterEach(async () => {
    await t.close();
  });

  it('uses defaults, then overrides, per guild', async () => {
    const f = new FeatureFlags(t.db, () => now);
    expect(await f.isEnabled('g1', 'musik')).toBe(true);
    expect(await f.isEnabled('g1', 'veckorapport')).toBe(false);
    await f.setEnabled('g1', 'musik', false, 'u1');
    expect(await f.isEnabled('g1', 'musik')).toBe(false);
    expect(await f.isEnabled('g2', 'musik')).toBe(true);
    const list = await f.listForGuild('g1');
    expect(list.find((x) => x.key === 'musik')).toMatchObject({ enabled: false, overridden: true });
  });

  it('caches reads for 30 s', async () => {
    const f = new FeatureFlags(t.db, () => now);
    expect(await f.isEnabled('g1', 'citat')).toBe(true);
    await t.db.query(`INSERT INTO bot.guild_features (guild_id, feature, enabled) VALUES ('g1', 'citat', false)`);
    expect(await f.isEnabled('g1', 'citat')).toBe(true); // cached
    now += 31_000;
    expect(await f.isEnabled('g1', 'citat')).toBe(false);
  });

  it('per-channel features need both the guild flag and a channel opt-in', async () => {
    const f = new FeatureFlags(t.db, () => now);
    expect(await f.isChannelEnabled('g1', 'c1', 'jev_reflexer')).toBe(false); // guild default off
    await f.setEnabled('g1', 'jev_reflexer', true, 'u1');
    expect(await f.isChannelEnabled('g1', 'c1', 'jev_reflexer')).toBe(false); // no channel opt-in
    await f.setChannelEnabled('g1', 'c1', 'jev_reflexer', true, 'u1');
    expect(await f.isChannelEnabled('g1', 'c1', 'jev_reflexer')).toBe(true);
    expect(await f.isChannelEnabled('g1', 'c2', 'jev_reflexer')).toBe(false);
  });

  it('require() throws a Swedish user-facing error when disabled', async () => {
    const f = new FeatureFlags(t.db, () => now);
    await f.setEnabled('g1', 'raid', false, 'u1');
    await expect(f.require('g1', 'raid')).rejects.toThrow(/avstängt/);
    await expect(f.require(null, 'raid')).rejects.toThrow(/DM/);
  });
});
