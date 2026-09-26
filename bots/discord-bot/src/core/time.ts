/**
 * Deterministic Swedish time parsing in Europe/Stockholm (no LLM involved).
 *
 * Understood (case-insensitive, "kl"/"kl."/"klockan"/"på"/"den" ignored):
 *   20:00 · 20.30 · kl 20 · 20                     next occurrence of that clock time
 *   idag 19 · ikväll [21:30] · imorgon 18 · i övermorgon 19
 *   fredag 20 · fre 20:30 · lör · sön kl 19        next occurrence of that weekday (today counts if still ahead)
 *   2026-10-03 20:00 · 3/10 20:00 · 3/10/2026 20 · 3 okt 20 · 3 oktober kl 20:15
 *   om 30 min · om 2 h · om 1 timme · om 3 dagar · om 1 vecka
 * A day without a clock time defaults to `defaultHour` (20:00); "ikväll 9" means 21:00. Wall-clock
 * times that do not exist (spring-forward gap) move forward one hour; ambiguous fall-back times
 * resolve to the later (CET) instant. Anything not understood returns null (never a guess).
 */

export const STOCKHOLM = 'Europe/Stockholm';

type Parts = { year: number; month: number; day: number; hour: number; minute: number; second: number; weekday: number };

const dtfCache = new Map<string, Intl.DateTimeFormat>();

function formatter(tz: string): Intl.DateTimeFormat {
  let f = dtfCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      weekday: 'short',
    });
    dtfCache.set(tz, f);
  }
  return f;
}

const WEEKDAY_INDEX: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

/** Wall-clock parts of an instant in `tz`. weekday: 1 = Monday … 7 = Sunday. */
export function zonedParts(instant: Date, tz = STOCKHOLM): Parts {
  const parts: Record<string, string> = {};
  for (const p of formatter(tz).formatToParts(instant)) parts[p.type] = p.value;
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
    weekday: WEEKDAY_INDEX[parts.weekday!] ?? 1,
  };
}

/** Offset of `tz` at `instant` in ms (local wall clock − UTC). */
export function tzOffsetMs(instant: Date, tz = STOCKHOLM): number {
  const p = zonedParts(instant, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/** Wall-clock time in `tz` → UTC instant. */
export function zonedToUtc(year: number, month: number, day: number, hour: number, minute: number, tz = STOCKHOLM): Date {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  const off1 = tzOffsetMs(new Date(guess), tz);
  let t = guess - off1;
  const off2 = tzOffsetMs(new Date(t), tz);
  if (off2 !== off1) t = guess - off2;
  return new Date(t);
}

type YMD = { y: number; m: number; d: number };

/** Adds whole calendar days to a y/m/d (handles month/year rollover). */
function addDays(ymd: YMD, days: number): YMD {
  const dt = new Date(Date.UTC(ymd.y, ymd.m - 1, ymd.d + days));
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
}

function validDate(ymd: YMD): boolean {
  if (ymd.m < 1 || ymd.m > 12 || ymd.d < 1) return false;
  const dt = new Date(Date.UTC(ymd.y, ymd.m - 1, ymd.d));
  return dt.getUTCMonth() === ymd.m - 1 && dt.getUTCDate() === ymd.d;
}

/** Token → ISO weekday. Accepts short and long forms ("fre", "fredag", "fredagen"). */
const WEEKDAY_WORDS: [string[], number][] = [
  [['mån', 'måndag', 'måndagen'], 1],
  [['tis', 'tisdag', 'tisdagen'], 2],
  [['ons', 'onsdag', 'onsdagen'], 3],
  [['tor', 'tors', 'torsdag', 'torsdagen'], 4],
  [['fre', 'fredag', 'fredagen'], 5],
  [['lör', 'lördag', 'lördagen'], 6],
  [['sön', 'söndag', 'söndagen'], 7],
];

const MONTH_PREFIXES: [string, number][] = [
  ['jan', 1], ['feb', 2], ['mar', 3], ['apr', 4], ['maj', 5], ['jun', 6],
  ['jul', 7], ['aug', 8], ['sep', 9], ['okt', 10], ['nov', 11], ['dec', 12],
];

function monthOf(token: string): number | null {
  if (token.length < 3) return null;
  for (const [prefix, n] of MONTH_PREFIXES) if (token.startsWith(prefix)) return n;
  return null;
}

function weekdayOf(token: string): number | null {
  for (const [words, n] of WEEKDAY_WORDS) if (words.includes(token)) return n;
  return null;
}

const FILLER = new Set(['kl', 'kl.', 'klockan', 'på', 'den', 'vid', 'at', 'the']);

export type ParseOptions = {
  /** Hour used when only a day is given (default 20). */
  defaultHour?: number;
  defaultMinute?: number;
  tz?: string;
};

export type ParsedWhen = { at: Date; hasTime: boolean; label: string };

function tokenize(input: string): string[] {
  const raw = input
    .toLowerCase()
    .replace(/(\d),(\d)/g, '$1.$2')
    .replace(/[,!?]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  const out: string[] = [];
  for (let i = 0; i < raw.length; i++) {
    const t = raw[i]!;
    const next = raw[i + 1];
    // "i kväll" → "ikväll", "i morgon" → "imorgon" …
    if (t === 'i' && next && ['kväll', 'morgon', 'dag', 'övermorgon'].includes(next)) {
      out.push(`i${next}`);
      i += 1;
      continue;
    }
    // "kl20" / "kl.20"
    const kl = /^kl\.?(\d.*)$/.exec(t);
    if (kl) {
      out.push(kl[1]!);
      continue;
    }
    if (!FILLER.has(t)) out.push(t);
  }
  return out;
}

const TIME_RE = /^([01]?\d|2[0-3])(?:[:.]([0-5]\d))?$/;
const REL_UNITS: [RegExp, number][] = [
  [/^(min|minut|minuter|m)$/, 60_000],
  [/^(h|t|tim|timme|timmar)$/, 3_600_000],
  [/^(d|dag|dagar)$/, 86_400_000],
  [/^(v|vecka|veckor)$/, 7 * 86_400_000],
];

/** Returns null when the input is not fully understood or the result is not in the future. */
export function parseWhen(input: string, now: Date, opts: ParseOptions = {}): ParsedWhen | null {
  const tz = opts.tz ?? STOCKHOLM;
  const defaultHour = opts.defaultHour ?? 20;
  const defaultMinute = opts.defaultMinute ?? 0;
  const tokens = tokenize(input);
  if (!tokens.length) return null;
  const label = input.trim();

  // Relative: "om 30 min", "om 2 h", "om 1,5 timmar", "om 30min"
  if (tokens[0] === 'om' && tokens.length >= 2) {
    const joined = tokens.slice(1).join(' ');
    const m = /^(\d+(?:[.,]\d+)?) ?([a-zåäö]+)$/.exec(joined);
    if (!m) return null;
    const n = Number(m[1]!.replace(',', '.'));
    const unit = REL_UNITS.find(([re]) => re.test(m[2]!));
    if (!unit || !(n > 0)) return null;
    return { at: new Date(now.getTime() + n * unit[1]), hasTime: true, label };
  }

  const today = zonedParts(now, tz);
  const todayYmd: YMD = { y: today.year, m: today.month, d: today.day };
  let date: YMD | null = null;
  let yearGiven = false;
  let weekday: number | null = null;
  let evening = false;
  let hour: number | null = null;
  let minute = 0;

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    const next = tokens[i + 1];
    let m: RegExpExecArray | null;

    if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t)) && !date) {
      date = { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
      yearGiven = true;
    } else if ((m = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/.exec(t)) && !date) {
      const y = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : today.year;
      date = { y, m: Number(m[2]), d: Number(m[1]) };
      yearGiven = Boolean(m[3]);
    } else if (/^\d{1,2}$/.test(t) && next && monthOf(next) !== null && !date) {
      date = { y: today.year, m: monthOf(next)!, d: Number(t) };
      i += 1;
    } else if (t === 'idag' && !date) {
      date = todayYmd;
    } else if (t === 'ikväll' && !date) {
      date = todayYmd;
      evening = true;
    } else if (t === 'imorgon' && !date) {
      date = addDays(todayYmd, 1);
    } else if ((t === 'iövermorgon' || t === 'övermorgon') && !date) {
      date = addDays(todayYmd, 2);
    } else if (weekdayOf(t) !== null && weekday === null && !date) {
      weekday = weekdayOf(t);
    } else if ((m = TIME_RE.exec(t)) && hour === null) {
      hour = Number(m[1]);
      minute = m[2] ? Number(m[2]) : 0;
    } else {
      return null; // unknown word → do not guess
    }
  }

  if (!date && weekday === null && hour === null) return null;
  if (date && !validDate(date)) return null;
  if (date && !yearGiven && zonedToUtc(date.y, date.m, date.d, 23, 59, tz).getTime() < now.getTime()) {
    // "3/10" when 3 October has passed → next year.
    date = { ...date, y: date.y + 1 };
  }
  if (evening && hour !== null && hour < 12) hour += 12;

  const hasTime = hour !== null;
  const h = hour ?? defaultHour;
  const min = hour !== null ? minute : defaultMinute;

  let at: Date;
  if (date) {
    at = zonedToUtc(date.y, date.m, date.d, h, min, tz);
  } else if (weekday !== null) {
    let delta = (weekday - today.weekday + 7) % 7;
    at = zonedToUtc(...ymdArgs(addDays(todayYmd, delta)), h, min, tz);
    if (at.getTime() <= now.getTime()) {
      delta += 7;
      at = zonedToUtc(...ymdArgs(addDays(todayYmd, delta)), h, min, tz);
    }
  } else {
    // Clock time only: today if still ahead, otherwise tomorrow.
    at = zonedToUtc(today.year, today.month, today.day, h, min, tz);
    if (at.getTime() <= now.getTime()) at = zonedToUtc(...ymdArgs(addDays(todayYmd, 1)), h, min, tz);
  }
  if (at.getTime() <= now.getTime()) return null;
  return { at, hasTime, label };
}

function ymdArgs(ymd: YMD): [number, number, number] {
  return [ymd.y, ymd.m, ymd.d];
}

/** "fredag 3 oktober 20:00" in Swedish, Stockholm time. */
export function formatStockholm(at: Date): string {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: STOCKHOLM,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  }).format(at);
}

/** Discord timestamp markup, e.g. <t:1790000000:F>. */
export function discordTimestamp(at: Date, style: 't' | 'T' | 'd' | 'D' | 'f' | 'F' | 'R' = 'F'): string {
  return `<t:${Math.floor(at.getTime() / 1000)}:${style}>`;
}

/**
 * Next occurrence of a weekly UTC slot strictly after `after` (weekday 1 = Monday … 7 = Sunday).
 * Used for the weekly reset post (EU reset: Wednesday 04:00 UTC, fixed in UTC all year).
 */
export function nextWeeklyUtc(after: Date, weekday: number, hour: number, minute: number): Date {
  const base = Date.UTC(after.getUTCFullYear(), after.getUTCMonth(), after.getUTCDate(), hour, minute);
  const currentWeekday = ((after.getUTCDay() + 6) % 7) + 1;
  let delta = (weekday - currentWeekday + 7) % 7;
  let candidate = base + delta * 86_400_000;
  if (candidate <= after.getTime()) {
    delta += 7;
    candidate = base + delta * 86_400_000;
  }
  return new Date(candidate);
}

/** Next occurrence of a weekly Stockholm wall-clock slot strictly after `after` (DST-safe). */
export function nextWeeklyStockholm(after: Date, weekday: number, hour: number, minute: number): Date {
  const today = zonedParts(after);
  const todayYmd: YMD = { y: today.year, m: today.month, d: today.day };
  for (let i = 0; i <= 7; i++) {
    const at = zonedToUtc(...ymdArgs(addDays(todayYmd, i)), hour, minute);
    if (zonedParts(at).weekday === weekday && at.getTime() > after.getTime()) return at;
  }
  return zonedToUtc(...ymdArgs(addDays(todayYmd, 14)), hour, minute);
}
