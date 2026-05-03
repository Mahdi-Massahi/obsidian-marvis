import { RRule } from "rrule";
import type { Event } from "../schema/types";

const PRESET_TO_RRULE: Record<string, string> = {
  daily: "FREQ=DAILY",
  weekly: "FREQ=WEEKLY",
  monthly: "FREQ=MONTHLY",
  yearly: "FREQ=YEARLY",
};

export function presetToRRule(preset: string): string | undefined {
  return PRESET_TO_RRULE[preset.toLowerCase()];
}

export function eventStartDate(event: Event): Date {
  const [y, m, d] = event.date.split("-").map(Number);
  if (event.time) {
    const [h, mi] = event.time.split(":").map(Number);
    return new Date(y, (m ?? 1) - 1, d ?? 1, h ?? 0, mi ?? 0, 0, 0);
  }
  return new Date(y, (m ?? 1) - 1, d ?? 1, 0, 0, 0, 0);
}

function parseRule(event: Event): RRule | null {
  if (!event.recurrence) return null;
  const dtstart = eventStartDate(event);
  try {
    const opts = RRule.parseString(event.recurrence);
    opts.dtstart = dtstart;
    return new RRule(opts);
  } catch {
    return null;
  }
}

/**
 * Returns occurrence start dates within [rangeStart, rangeEnd].
 * For non-recurring events, returns the single base date if it falls in range.
 */
export function expandOccurrences(
  event: Event,
  rangeStart: Date,
  rangeEnd: Date
): Date[] {
  const rule = parseRule(event);
  if (!rule) {
    const start = eventStartDate(event);
    return start >= rangeStart && start <= rangeEnd ? [start] : [];
  }
  return rule.between(rangeStart, rangeEnd, true);
}

const HUMAN_FREQ: Record<number, string> = {
  [RRule.YEARLY]: "Yearly",
  [RRule.MONTHLY]: "Monthly",
  [RRule.WEEKLY]: "Weekly",
  [RRule.DAILY]: "Daily",
  [RRule.HOURLY]: "Hourly",
  [RRule.MINUTELY]: "Minutely",
  [RRule.SECONDLY]: "Secondly",
};

const WEEKDAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function describeRecurrence(rrule: string | undefined): string {
  if (!rrule) return "";
  try {
    const opts = RRule.parseString(rrule);
    const freq = opts.freq != null ? HUMAN_FREQ[opts.freq] ?? "Custom" : "Custom";
    const parts: string[] = [freq];
    if (opts.interval && opts.interval !== 1) parts[0] = `Every ${opts.interval} · ${freq}`;
    if (opts.byweekday) {
      const days = ([] as { weekday?: number }[])
        .concat(opts.byweekday as never)
        .map((d) => (typeof d === "number" ? d : d?.weekday))
        .filter((d): d is number => typeof d === "number")
        .map((d) => WEEKDAY_NAMES[d]);
      if (days.length) parts.push(days.join(", "));
    }
    if (opts.until) parts.push(`until ${opts.until.toISOString().slice(0, 10)}`);
    if (opts.count) parts.push(`× ${opts.count}`);
    return parts.join(" · ");
  } catch {
    return rrule;
  }
}
