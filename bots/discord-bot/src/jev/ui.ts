/** Shared Swedish copy for Jev features. */
import { UserFacingError } from '../core/interaction-errors.js';
import { JevDisabledError, JevUnavailableError, jev } from './client.js';

/** Stop a Jev command up front (ephemeral, before any public defer) when no API key is configured. */
export function requireJev(): void {
  if (!jev().enabled) throw new UserFacingError(jevUnavailableText(new JevDisabledError()));
}

export function jevUnavailableText(err: unknown): string {
  if (err instanceof JevDisabledError) {
    return '😴 Jev sover (ingen API-nyckel konfigurerad). Be en admin sätta `TYPESAFE_API_KEY`.';
  }
  if (err instanceof JevUnavailableError) {
    const secs = Math.ceil(err.retryInMs / 1000);
    return `🧊 Jev tar en paus efter för många fel i rad.${secs > 0 ? ` Försök igen om ~${secs} s.` : ''}`;
  }
  return '📡 Jev svarar inte just nu. Försök igen om en stund.';
}
