/**
 * Deterministic LFG extraction (Jev is weak at numbers and times, so these never go to Jev):
 * keystone level ("+12", "m+ 15", "key 10", "nyckel 8") and clock time ("20:30", "kl 21").
 */

export function extractKeyLevel(text: string): number | null {
  const patterns = [
    /(?:^|[\s(])\+\s?(\d{1,2})(?![\d:.])/,
    /\b(?:m\+?|mplus|mythic\+?|key|keyn|keystone|nyckel|nyckeln|nyckla)\s*\+?\s?(\d{1,2})(?![\d:.])/i,
  ];
  for (const re of patterns) {
    const m = re.exec(text);
    if (m) {
      const n = Number(m[1]);
      if (n >= 2 && n <= 40) return n;
    }
  }
  return null;
}

export function extractClock(text: string): { hour: number; minute: number } | null {
  const hm = /\b(?:kl\.?\s*)?([01]?\d|2[0-3])[:.]([0-5]\d)\b/i.exec(text);
  if (hm) return { hour: Number(hm[1]), minute: Number(hm[2]) };
  const klOnly = /\bkl\.?\s*([01]?\d|2[0-3])\b/i.exec(text);
  if (klOnly) return { hour: Number(klOnly[1]), minute: 0 };
  return null;
}

export type GroupNeeds = { tank: number; healer: number; dps: number };

/** Open slots for a 5-player group given which roles the post says are already covered. */
export function needsFromPresent(present: { tank: boolean; healer: boolean; dps: boolean }): GroupNeeds {
  return {
    tank: present.tank ? 0 : 1,
    healer: present.healer ? 0 : 1,
    // Jev cannot count reliably, so "has DPS" is taken to mean the author's group covers one DPS slot.
    dps: present.dps ? 2 : 3,
  };
}

export function isFull(needs: GroupNeeds): boolean {
  return needs.tank <= 0 && needs.healer <= 0 && needs.dps <= 0;
}
