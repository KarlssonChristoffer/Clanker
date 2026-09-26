import { describe, expect, it, vi } from 'vitest';
import { MessageFlags, type Interaction } from 'discord.js';
import { handleInteractionError, UserFacingError } from '../src/core/interaction-errors.js';

function fakeCommand(state: { deferred?: boolean; replied?: boolean }) {
  return {
    id: '1',
    type: 2,
    guildId: '10000000000000000',
    channelId: '20000000000000000',
    user: { id: '30000000000000000', username: 'tester' },
    commandName: 'ping',
    deferred: state.deferred ?? false,
    replied: state.replied ?? false,
    options: { getSubcommand: () => null },
    isChatInputCommand: () => true,
    isAutocomplete: () => false,
    isMessageComponent: () => false,
    isModalSubmit: () => false,
    isRepliable: () => true,
    reply: vi.fn(async () => undefined),
    editReply: vi.fn(async () => undefined),
    followUp: vi.fn(async () => undefined),
  };
}

describe('handleInteractionError', () => {
  it('replies ephemerally when nothing was sent yet', async () => {
    const i = fakeCommand({});
    await handleInteractionError(i as unknown as Interaction, new Error('boom'));
    expect(i.reply).toHaveBeenCalledOnce();
    const arg = (i.reply.mock.calls[0] as unknown[])[0] as { flags: number; content: string };
    expect(arg.flags).toBe(MessageFlags.Ephemeral);
    expect(arg.content).not.toContain('boom');
  });

  it('edits the deferred reply', async () => {
    const i = fakeCommand({ deferred: true });
    await handleInteractionError(i as unknown as Interaction, new Error('boom'));
    expect(i.editReply).toHaveBeenCalledOnce();
    expect(i.reply).not.toHaveBeenCalled();
  });

  it('never overwrites the message behind a deferred button (panel, raid post)', async () => {
    const i = {
      ...fakeCommand({ deferred: true }),
      type: 3,
      customId: 'music:skip',
      isChatInputCommand: () => false,
      isMessageComponent: () => true,
    };
    await handleInteractionError(i as unknown as Interaction, new Error('boom'));
    expect(i.editReply).not.toHaveBeenCalled();
    expect(i.followUp).toHaveBeenCalledOnce();
    expect(((i.followUp.mock.calls[0] as unknown[])[0] as { flags: number }).flags).toBe(MessageFlags.Ephemeral);
  });

  it('follows up when a reply was already sent', async () => {
    const i = fakeCommand({ replied: true });
    await handleInteractionError(i as unknown as Interaction, new Error('boom'));
    expect(i.followUp).toHaveBeenCalledOnce();
  });

  it('shows UserFacingError messages verbatim', async () => {
    const i = fakeCommand({});
    await handleInteractionError(i as unknown as Interaction, new UserFacingError('Du måste vara i röst.'));
    const arg = (i.reply.mock.calls[0] as unknown[])[0] as { content: string };
    expect(arg.content).toBe('Du måste vara i röst.');
  });

  it('never throws when the reply itself fails', async () => {
    const i = fakeCommand({});
    i.reply.mockRejectedValueOnce(new Error('Unknown interaction'));
    await expect(handleInteractionError(i as unknown as Interaction, new Error('boom'))).resolves.toBeUndefined();
  });
});
