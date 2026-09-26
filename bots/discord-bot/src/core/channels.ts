/** Channel helpers. Reused server channels may be announcement channels, so accept both kinds. */
import { ChannelType, type Channel, type NewsChannel, type TextChannel } from 'discord.js';

export type PostableChannel = TextChannel | NewsChannel;

export function isPostable(ch: Channel | null | undefined): ch is PostableChannel {
  return ch?.type === ChannelType.GuildText || ch?.type === ChannelType.GuildAnnouncement;
}
