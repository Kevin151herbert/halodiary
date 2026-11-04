// Time zone helpers. The server may run in UTC while users live anywhere, so every
// schedule and every displayed time is computed in the user's own time zone.

export const DEFAULT_TZ = "Europe/Madrid";

export type ZParts = { y: number; m: number; d: number; h: number; mi: number; s: number; wd: number };

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function partsFormatter(tz: string) {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
      weekday: "short",
    });
    fmtCache.set(tz, f);
  }
  return f;
}

const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function zParts(date: Date, tz: string): ZParts {
  const out: Record<string, string> = {};
  for (const p of partsFormatter(tz).formatToParts(date)) out[p.type] = p.value;
  return {
    y: Number(out.year),
    m: Number(out.month),
    d: Number(out.day),
    h: Number(out.hour) % 24,
    mi: Number(out.minute),
    s: Number(out.second),
    wd: WD.indexOf(out.weekday),
  };
}

function offsetMs(date: Date, tz: string) {
  const p = zParts(date, tz);
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - Math.floor(date.getTime() / 1000) * 1000;
}

/** The instant when the wall clock in `tz` reads y-m-d h:mi. */
export function zonedTime(y: number, m: number, d: number, h: number, mi: number, tz: string) {
  const guess = Date.UTC(y, m - 1, d, h, mi);
  let t = guess - offsetMs(new Date(guess), tz);
  t = guess - offsetMs(new Date(t), tz);
  return new Date(t);
}

/** Calendar arithmetic on a date with no time zone. */
export function addDays(y: number, m: number, d: number, n: number) {
  const x = new Date(Date.UTC(y, m - 1, d + n));
  return { y: x.getUTCFullYear(), m: x.getUTCMonth() + 1, d: x.getUTCDate(), wd: x.getUTCDay() };
}

const pad = (n: number) => String(n).padStart(2, "0");

export function dayKey(date: Date, tz: string) {
  const p = zParts(date, tz);
  return `${p.y}-${pad(p.m)}-${pad(p.d)}`;
}

/** First day of the month, as the 'YYYY-MM-01' key budgets use. */
export function monthKey(date: Date, tz: string, add = 0) {
  const p = zParts(date, tz);
  const x = new Date(Date.UTC(p.y, p.m - 1 + add, 1));
  return `${x.getUTCFullYear()}-${pad(x.getUTCMonth() + 1)}-01`;
}

/** [start, end) instants of a 'YYYY-MM-01' month in `tz`. */
export function monthRange(key: string, tz: string) {
  const [y, m] = key.split("-").map(Number);
  const next = new Date(Date.UTC(y, m, 1));
  return {
    start: zonedTime(y, m, 1, 0, 0, tz),
    end: zonedTime(next.getUTCFullYear(), next.getUTCMonth() + 1, 1, 0, 0, tz),
  };
}

export function monthLabel(key: string) {
  const [y, m] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
}

export function fmt(date: Date | string, tz: string, opts: Intl.DateTimeFormatOptions) {
  return new Date(date).toLocaleString("en-GB", { ...opts, timeZone: tz });
}

export const fmtTime = (d: Date | string, tz: string) => fmt(d, tz, { hour: "2-digit", minute: "2-digit" });
export const fmtDay = (d: Date | string, tz: string) => fmt(d, tz, { weekday: "long", day: "numeric", month: "long" });
export const fmtShort = (d: Date | string, tz: string) =>
  fmt(d, tz, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/** Value for an <input type="datetime-local"> showing `date` in `tz`. */
export function localInputValue(date: Date | string, tz: string) {
  const p = zParts(new Date(date), tz);
  return `${p.y}-${pad(p.m)}-${pad(p.d)}T${pad(p.h)}:${pad(p.mi)}`;
}

/** Parse 'YYYY-MM-DDTHH:mm' (no zone) as wall-clock time in `tz`. Full ISO strings with a zone pass through. */
export function parseLocalInput(value: string, tz: string) {
  if (/[zZ]|[+-]\d\d:\d\d$/.test(value)) return new Date(value);
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/);
  if (!m) return new Date(NaN);
  return zonedTime(Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5]), tz);
}

export function isValidTz(tz: string | null | undefined) {
  if (!tz) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Money as people read it: "€41.00", in the account's currency. */
export function fmtMoney(n: number, currency: string) {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency }).format(n);
}
