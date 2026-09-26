/**
 * Message-component and modal routing by customId prefix.
 *
 * customId format: `<prefix>:<action>[:<arg>...]`, e.g. `raid:join:42:tank`. Discord limits customId
 * to 100 characters, so keep args short (ids, enum values). Use `customId()` to build them.
 */
import type {
  ButtonInteraction,
  ModalSubmitInteraction,
  StringSelectMenuInteraction,
  UserSelectMenuInteraction,
  RoleSelectMenuInteraction,
  ChannelSelectMenuInteraction,
  MentionableSelectMenuInteraction,
} from 'discord.js';

export type ComponentInteraction =
  | ButtonInteraction
  | StringSelectMenuInteraction
  | UserSelectMenuInteraction
  | RoleSelectMenuInteraction
  | ChannelSelectMenuInteraction
  | MentionableSelectMenuInteraction
  | ModalSubmitInteraction;

export type ParsedCustomId = { prefix: string; action: string; args: string[] };

export type ComponentHandler = {
  prefix: string;
  handle: (interaction: ComponentInteraction, parsed: ParsedCustomId) => Promise<void>;
};

const SEPARATOR = ':';
const MAX_CUSTOM_ID = 100;

export function customId(prefix: string, action: string, ...args: (string | number)[]): string {
  const parts = [prefix, action, ...args.map(String)];
  for (const p of parts) {
    if (p.includes(SEPARATOR)) throw new Error(`customId part must not contain "${SEPARATOR}": ${p}`);
  }
  const id = parts.join(SEPARATOR);
  if (id.length > MAX_CUSTOM_ID) throw new Error(`customId too long (${id.length} > ${MAX_CUSTOM_ID}): ${id}`);
  return id;
}

export function parseCustomId(id: string): ParsedCustomId {
  const [prefix = '', action = '', ...args] = id.split(SEPARATOR);
  return { prefix, action, args };
}

export class ComponentRegistry {
  private readonly byPrefix = new Map<string, ComponentHandler>();

  constructor(handlers: readonly ComponentHandler[]) {
    for (const h of handlers) {
      if (this.byPrefix.has(h.prefix)) throw new Error(`Duplicate component prefix: ${h.prefix}`);
      this.byPrefix.set(h.prefix, h);
    }
  }

  resolve(id: string): { handler: ComponentHandler; parsed: ParsedCustomId } | undefined {
    const parsed = parseCustomId(id);
    const handler = this.byPrefix.get(parsed.prefix);
    return handler ? { handler, parsed } : undefined;
  }
}
