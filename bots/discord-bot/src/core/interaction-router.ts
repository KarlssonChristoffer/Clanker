/**
 * Single InteractionCreate listener: slash commands and autocomplete via the CommandRegistry,
 * buttons / select menus / modals via the ComponentRegistry. Every path is wrapped in the global
 * error handler.
 */
import { Events, type Client, type Interaction } from 'discord.js';
import type { CommandRegistry } from './commands.js';
import type { ComponentRegistry } from './components.js';
import { handleInteractionError, interactionLogContext, UserFacingError } from './interaction-errors.js';
import { isShuttingDown } from './lifecycle.js';
import { childLogger } from './logger.js';

const log = childLogger('interactions');

export async function routeInteraction(
  interaction: Interaction,
  commands: CommandRegistry,
  components: ComponentRegistry,
): Promise<void> {
  if (interaction.isChatInputCommand()) {
    const command = commands.get(interaction.commandName);
    if (!command) throw new UserFacingError('🤷 Det kommandot känner jag inte igen längre. Prova igen om en minut.');
    const started = Date.now();
    await command.execute(interaction);
    log.debug({ ...interactionLogContext(interaction), ms: Date.now() - started }, 'command handled');
    return;
  }
  if (interaction.isAutocomplete()) {
    const command = commands.get(interaction.commandName);
    if (command?.autocomplete) await command.autocomplete(interaction);
    else await interaction.respond([]);
    return;
  }
  if (interaction.isMessageComponent() || interaction.isModalSubmit()) {
    const route = components.resolve(interaction.customId);
    if (!route) {
      throw new UserFacingError('⌛ Den här knappen hör till något som inte finns kvar. Kör kommandot igen.');
    }
    await route.handler.handle(interaction, route.parsed);
  }
}

export function registerInteractionRouter(
  client: Client,
  commands: CommandRegistry,
  components: ComponentRegistry,
): void {
  client.on(Events.InteractionCreate, async (interaction) => {
    if (isShuttingDown()) return;
    try {
      await routeInteraction(interaction, commands, components);
    } catch (err) {
      await handleInteractionError(interaction, err);
    }
  });
}
