import { describe, expect, it, vi } from 'vitest';

// Keep module loading cheap and side-effect free.
vi.mock('../src/music-player.js', () => ({
  enqueue: vi.fn(), skip: vi.fn(), previous: vi.fn(), pause: vi.fn(), resume: vi.fn(), stop: vi.fn(), seek: vi.fn(),
  shuffleQueue: vi.fn(), reorderMusicQueue: vi.fn(), addTrackToPlaylist: vi.fn(), playPlaylist: vi.fn(),
  createPlaylist: vi.fn(), deletePlaylist: vi.fn(), listPlaylists: vi.fn(), getPlaylistTracks: vi.fn(),
  removeTrackFromPlaylist: vi.fn(), getLastChannelId: vi.fn(), initPlayDl: vi.fn(), shutdownMusic: vi.fn(),
}));

process.env.DISCORD_BOT_TOKEN ??= 'test';
process.env.DISCORD_APPLICATION_ID ??= '123456789012345678';
process.env.DATABASE_URL ??= 'postgres://test@localhost/test';

const { initConfig } = await import('../src/core/config.js');
initConfig();
const { loadModules } = await import('../src/modules.js');
const { CommandRegistry } = await import('../src/core/commands.js');
const { ComponentRegistry } = await import('../src/core/components.js');

// Discord: https://discord.com/developers/docs/interactions/application-commands#application-command-object
const NAME_RE = /^[-_'\p{L}\p{N}\p{sc=Deva}\p{sc=Thai}]{1,32}$/u;

type Opt = { name: string; description: string; type: number; required?: boolean; choices?: { name: string; value: unknown }[]; options?: Opt[] };

function checkOptions(path: string, options: Opt[] | undefined, problems: string[]) {
  if (!options) return;
  if (options.length > 25) problems.push(`${path}: more than 25 options`);
  let seenOptional = false;
  for (const o of options) {
    const p = `${path} ${o.name}`;
    if (!NAME_RE.test(o.name) || o.name !== o.name.toLowerCase()) problems.push(`${p}: invalid name`);
    if (!o.description || o.description.length > 100) problems.push(`${p}: description length ${o.description?.length}`);
    if ((o.choices?.length ?? 0) > 25) problems.push(`${p}: more than 25 choices`);
    const isSub = o.type === 1 || o.type === 2;
    if (!isSub) {
      if (o.required && seenOptional) problems.push(`${p}: required option after optional`);
      if (!o.required) seenOptional = true;
    }
    checkOptions(p, o.options, problems);
  }
}

describe('slash command definitions', () => {
  const modules = loadModules();
  const registry = new CommandRegistry(modules.flatMap((m) => m.commands ?? []));
  const defs = registry.definitions() as unknown as (Opt & { name: string })[];

  it('builds every command and satisfies Discord limits', () => {
    const problems: string[] = [];
    expect(defs.length).toBeGreaterThanOrEqual(15);
    expect(defs.length).toBeLessThanOrEqual(100);
    for (const d of defs) {
      if (!NAME_RE.test(d.name) || d.name !== d.name.toLowerCase()) problems.push(`/${d.name}: invalid name`);
      if (!d.description || d.description.length > 100) problems.push(`/${d.name}: description length`);
      checkOptions(`/${d.name}`, d.options, problems);
    }
    // Discord: name + description + all option names/descriptions/choices ≤ 4000 characters per command.
    const textLength = (o: Opt): number =>
      o.name.length +
      (o.description?.length ?? 0) +
      (o.choices ?? []).reduce((n, c) => n + c.name.length + String(c.value).length, 0) +
      (o.options ?? []).reduce((n, c) => n + textLength(c), 0);
    for (const d of defs) {
      if (textLength(d) > 4000) problems.push(`/${d.name}: ${textLength(d)} characters (max 4000)`);
    }
    expect(problems).toEqual([]);
  });

  it('has the expected commands', () => {
    const names = defs.map((d) => d.name);
    for (const n of ['ping', 'play', 'playlist', 'admin', 'jev', 'jevstats', 'vibe', 'orakel', 'tankeläsare', 'setup', 'raid', 'wow', 'roster']) {
      expect(names).toContain(n);
    }
  });

  it('has unique component prefixes', () => {
    expect(() => new ComponentRegistry(modules.flatMap((m) => m.components ?? []))).not.toThrow();
  });
});
