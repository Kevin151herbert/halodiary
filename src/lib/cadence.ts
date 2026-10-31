// Recurring cadences and the dates they produce.
// Weekdays use JS numbering: 0 = Sunday ... 6 = Saturday.

import { monthRange, zonedTime, zParts } from "./time";

export type CadenceKey =
  | "thrice_weekly"
  | "twice_weekly"
  | "weekly"
  | "weekends"
  | "biweekly"
  | "every_3_weeks"
  | "twice_monthly"
  | "monthly"
  | "every_6_weeks"
  | "quarterly"
  | "every_6_months";

type Cadence = {
  label: string;
  perMonth: number; // average visits a month, for budgets
  kind: "weekdays" | "interval_weeks" | "month_days" | "interval_months";
  defaultWeekdays?: number[];
  intervalWeeks?: number;
  monthDays?: number[];
  intervalMonths?: number;
};

export const CADENCES: Record<CadenceKey, Cadence> = {
  thrice_weekly: { label: "3 times a week", perMonth: 13, kind: "weekdays", defaultWeekdays: [1, 3, 5] },
  twice_weekly: { label: "Twice a week", perMonth: 8.7, kind: "weekdays", defaultWeekdays: [2, 5] },
  weekly: { label: "Weekly", perMonth: 4.3, kind: "weekdays", defaultWeekdays: [3] },
  weekends: { label: "Weekends", perMonth: 8.7, kind: "weekdays", defaultWeekdays: [6, 0] },
  biweekly: { label: "Every 2 weeks", perMonth: 2.2, kind: "interval_weeks", intervalWeeks: 2 },
  every_3_weeks: { label: "Every 3 weeks", perMonth: 1.4, kind: "interval_weeks", intervalWeeks: 3 },
  twice_monthly: { label: "Twice a month", perMonth: 2, kind: "month_days", monthDays: [5, 20] },
  monthly: { label: "Monthly", perMonth: 1, kind: "month_days", monthDays: [10] },
  every_6_weeks: { label: "Every 6 weeks", perMonth: 0.7, kind: "interval_weeks", intervalWeeks: 6 },
  quarterly: { label: "Quarterly", perMonth: 0.33, kind: "interval_months", intervalMonths: 3 },
  every_6_months: { label: "Every 6 months", perMonth: 0.17, kind: "interval_months", intervalMonths: 6 },
};

export const CADENCE_KEYS = Object.keys(CADENCES) as CadenceKey[];

export const WEEKDAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function cadenceLabel(key: string, weekdays?: number[]) {
  const c = CADENCES[key as CadenceKey];
  if (!c) return key;
  if (c.kind === "weekdays" && weekdays && weekdays.length) {
    const names = [...weekdays].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)).map((d) => WEEKDAY_NAMES[d]);
    return `${c.label} (${names.join(", ")})`;
  }
  return c.label;
}

export function defaultWeekdays(key: string): number[] {
  return CADENCES[key as CadenceKey]?.defaultWeekdays ?? [];
}

type PlanTiming = { cadence: string; weekdays: number[]; time_of_day: string; start_date: string };

/**
 * All occurrences of a plan between `from` (inclusive) and `to` (exclusive),
 * at the plan's wall-clock time in time zone `tz`.
 */
export function occurrences(plan: PlanTiming, from: Date, to: Date, tz: string): Date[] {
  const c = CADENCES[plan.cadence as CadenceKey];
  if (!c) return [];
  const [hh, mm] = plan.time_of_day.slice(0, 5).split(":").map(Number);
  const [sy, sm, sd] = plan.start_date.split("-").map(Number);
  const startUtc = Date.UTC(sy, sm - 1, sd);
  const f = zParts(from, tz);
  const t = zParts(to, tz);
  const firstUtc = Math.max(Date.UTC(f.y, f.m - 1, f.d), startUtc);
  const lastUtc = Date.UTC(t.y, t.m - 1, t.d);
  const DAY = 86_400_000;
  const days: { y: number; m: number; d: number }[] = [];
  const asDay = (ms: number) => {
    const x = new Date(ms);
    return { y: x.getUTCFullYear(), m: x.getUTCMonth() + 1, d: x.getUTCDate(), wd: x.getUTCDay() };
  };

  if (c.kind === "weekdays") {
    const wanted = plan.weekdays.length ? plan.weekdays : c.defaultWeekdays ?? [];
    for (let ms = firstUtc; ms <= lastUtc; ms += DAY) {
      const day = asDay(ms);
      if (wanted.includes(day.wd)) days.push(day);
    }
  } else if (c.kind === "interval_weeks") {
    const step = 7 * (c.intervalWeeks ?? 1) * DAY;
    let ms = startUtc;
    while (ms < firstUtc) ms += step;
    for (; ms <= lastUtc; ms += step) days.push(asDay(ms));
  } else if (c.kind === "month_days") {
    const first = asDay(firstUtc);
    for (let k = 0; ; k++) {
      const base = new Date(Date.UTC(first.y, first.m - 1 + k, 1));
      if (base.getTime() > lastUtc) break;
      for (const md of c.monthDays ?? [1]) {
        const ms = Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), md);
        if (ms >= firstUtc && ms <= lastUtc) days.push(asDay(ms));
      }
    }
  } else if (c.kind === "interval_months") {
    const step = c.intervalMonths ?? 3;
    for (let k = 0; ; k += step) {
      const ms = Date.UTC(sy, sm - 1 + k, sd);
      if (ms > lastUtc) break;
      if (ms >= firstUtc) days.push(asDay(ms));
    }
  }

  return days
    .map((d) => zonedTime(d.y, d.m, d.d, hh || 0, mm || 0, tz))
    .filter((d) => d >= from && d < to)
    .sort((a, b) => +a - +b);
}

/** Visits a plan produces in a 'YYYY-MM-01' month in `tz`. */
export function visitsInMonth(plan: PlanTiming, month: string, tz: string) {
  const { start, end } = monthRange(month, tz);
  return occurrences(plan, start, end, tz);
}
