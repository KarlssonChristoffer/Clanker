/** Shared Swedish copy for Jev features. */
import { JevDisabledError, JevUnavailableError } from './client.js';

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
