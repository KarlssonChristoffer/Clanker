/** Small helpers shared by command modules. */
import { MessageFlags, PermissionFlagsBits, type ChatInputCommandInteraction, type Interaction } from 'discord.js';
import { UserFacingError } from '../core/interaction-errors.js';
import { getLastChannelId } from '../music-player.js';

export const EPHEMERAL = MessageFlags.Ephemeral;

/** Guild id of the interaction, or a friendly error when used in DMs. */
export function requireGuildId(interaction: Interaction): string {
  if (!interaction.guildId) throw new UserFacingError('Det här fungerar bara i en server, inte i DM. 🙃');
  return interaction.guildId;
}

/** The caller's voice channel, falling back to the channel the bot is already playing in. */
export function resolveVoiceChannelId(interaction: ChatInputCommandInteraction): string {
  const guildId = requireGuildId(interaction);
  const member = interaction.guild?.members.cache.get(interaction.user.id);
  const channelId = member?.voice.channelId ?? getLastChannelId(guildId);
  if (!channelId) throw new UserFacingError('🎧 Hoppa in i en röstkanal först, så kommer jag efter.');
  return channelId;
}

/** Runtime check on top of setDefaultMemberPermissions (server admins can override the default). */
export function requireManageGuild(interaction: Interaction): void {
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    throw new UserFacingError('🔒 Det här kräver behörigheten **Hantera server**.');
  }
}

export function fmtDuration(sec: number | null): string {
  if (sec == null) return '';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return ` [${m}:${s.toString().padStart(2, '0')}]`;
}

/** Count with the right Swedish noun form: plural(1, 'låt', 'låtar') → "1 låt", plural(3, …) → "3 låtar". */
export function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** Seconds as m:ss (or h:mm:ss). */
export function clock(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const pad = (n: number) => n.toString().padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`;
}

/** Unicode bar: 0–1 → e.g. ▰▰▰▱▱▱▱▱▱▱ */
export function bar(fraction: number, width = 10): string {
  const f = Math.max(0, Math.min(1, Number.isFinite(fraction) ? fraction : 0));
  const filled = Math.round(f * width);
  return '▰'.repeat(filled) + '▱'.repeat(width - filled);
}

export function pick<T>(items: readonly T[], random: () => number = Math.random): T {
  return items[Math.floor(random() * items.length)]!;
}
