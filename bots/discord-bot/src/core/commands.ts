/**
 * Slash-command registry. Each command lives in `src/commands/<name>.ts` and exports a `SlashCommand`;
 * `src/commands/index.ts` lists them. The registry builds the definitions sent to Discord and
 * dispatches chat-input and autocomplete interactions by command name.
 */
import type {
  AutocompleteInteraction,
  ChatInputCommandInteraction,
  RESTPostAPIChatInputApplicationCommandsJSONBody,
} from 'discord.js';

export type SlashCommand = {
  /** A SlashCommandBuilder (any variant: plain, with options or with subcommands). */
  data: { name: string; toJSON(): RESTPostAPIChatInputApplicationCommandsJSONBody };
  execute: (interaction: ChatInputCommandInteraction) => Promise<void>;
  autocomplete?: (interaction: AutocompleteInteraction) => Promise<void>;
};

export class CommandRegistry {
  private readonly byName = new Map<string, SlashCommand>();

  constructor(commands: readonly SlashCommand[]) {
    for (const command of commands) {
      const name = command.data.name;
      if (this.byName.has(name)) throw new Error(`Duplicate slash command name: ${name}`);
      this.byName.set(name, command);
    }
  }

  get(name: string): SlashCommand | undefined {
    return this.byName.get(name);
  }

  get size(): number {
    return this.byName.size;
  }

  /** Sorted by name so the registration hash does not depend on list order. */
  definitions(): RESTPostAPIChatInputApplicationCommandsJSONBody[] {
    return [...this.byName.values()]
      .map((c) => c.data.toJSON())
      .sort((a, b) => a.name.localeCompare(b.name));
  }
}
