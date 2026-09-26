/**
 * Global error handling for interactions: log with context, then tell the user something human
 * (ephemeral) whether or not the handler already replied or deferred.
 */
import { DiscordAPIError, MessageFlags, type Interaction } from 'discord.js';
import { childLogger } from './logger.js';

const log = childLogger('interactions');

/** Thrown by handlers for expected problems; the message is shown to the user as-is (Swedish). */
export class UserFacingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UserFacingError';
  }
}

const ERROR_LINES = [
  '💥 Något i maskinrummet small till. Felet är loggat, försök igen om en stund.',
  '🔧 Kugghjulen skar ihop sig. Clanker har skrivit en arg lapp till sig själv.',
  '🫠 Det där gick inte alls som planerat. Prova igen, och om det händer igen: skyll på Clanker.',
  '🐛 En bugg smet in bakvägen. Den är fångad i loggen och ska förhöras.',
  '🤖 *piper sorgset* Något gick snett. Försök igen lite senare.',
];

function pickLine(): string {
  return ERROR_LINES[Math.floor(Math.random() * ERROR_LINES.length)]!;
}

/** Discord codes for interactions that can no longer be answered (expired or already acknowledged). */
const DEAD_INTERACTION_CODES = new Set([10062, 40060]);

export function interactionLogContext(interaction: Interaction): Record<string, unknown> {
  const ctx: Record<string, unknown> = {
    interactionId: interaction.id,
    type: interaction.type,
    guildId: interaction.guildId,
    channelId: interaction.channelId,
    userId: interaction.user.id,
    user: interaction.user.username,
  };
  if (interaction.isChatInputCommand() || interaction.isAutocomplete()) {
    ctx.command = interaction.commandName;
    const sub = interaction.options.getSubcommand(false);
    if (sub) ctx.subcommand = sub;
  } else if (interaction.isMessageComponent() || interaction.isModalSubmit()) {
    ctx.customId = interaction.customId;
  }
  return ctx;
}

export async function handleInteractionError(interaction: Interaction, err: unknown): Promise<void> {
  const userFacing = err instanceof UserFacingError;
  const ctx = interactionLogContext(interaction);
  if (userFacing) {
    log.info({ ...ctx, reason: (err as Error).message }, 'interaction rejected (user-facing)');
  } else {
    log.error({ ...ctx, err }, 'interaction handler failed');
  }

  if (interaction.isAutocomplete()) {
    if (!interaction.responded) await interaction.respond([]).catch(() => undefined);
    return;
  }
  if (!interaction.isRepliable()) return;

  const content = userFacing ? (err as Error).message : pickLine();
  try {
    if (interaction.isMessageComponent() && interaction.deferred) {
      // After deferUpdate(), editReply would overwrite the message the button sits on (a panel, a raid post…).
      await interaction.followUp({ content, flags: MessageFlags.Ephemeral });
    } else if (interaction.deferred && !interaction.replied) {
      await interaction.editReply({ content, embeds: [], components: [] });
    } else if (interaction.replied) {
      await interaction.followUp({ content, flags: MessageFlags.Ephemeral });
    } else {
      await interaction.reply({ content, flags: MessageFlags.Ephemeral });
    }
  } catch (replyErr) {
    if (replyErr instanceof DiscordAPIError && DEAD_INTERACTION_CODES.has(Number(replyErr.code))) {
      log.debug({ ...ctx, code: replyErr.code }, 'could not report error: interaction expired');
      return;
    }
    log.warn({ ...ctx, err: replyErr }, 'could not report error to user');
  }
}
