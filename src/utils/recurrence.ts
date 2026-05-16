import { RRule } from "rrule";
import type { Event } from "../schema/types";

export function eventIconName(event: Event): "appleCalendar" | "calendar" {
  const src = event.source ?? "";
  if (src.startsWith("macos:")) return "appleCalendar";
  return "calendar";
}

// Empty for accepted / unset; otherwise a class hook the renderer applies
// to chips/bars/rows so non-accepted invitations are visually distinct.
export function responseStatusClass(event: Event): string {
  switch (event.responseStatus) {
    case "needsAction":
      return "kp-event--needs-response";
    case "tentative":
      return "kp-event--tentative";
    case "declined":
      return "kp-event--declined";
    default:
      return "";
  }
}

export function responseStatusLabel(event: Event): string | undefined {
  switch (event.responseStatus) {
    case "needsAction":
      return "Needs response";
    case "tentative":
      return "Tentative";
    case "declined":
      return "Declined";
    default:
      return undefined;
  }
}

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

// rrule.js reads a Date's UTC components when interpreting BYDAY / BYMONTHDAY /
// etc. — so passing a local-time Date directly causes a one-day weekday drift
// for anyone in a UTC+ timezone (local midnight Tue is Mon evening in UTC, so
// BYDAY=TU resolves to the next UTC Tuesday, which is local Wednesday). The
// standard workaround is "floating dates": build a Date whose UTC components
// match the intended local components, then reverse the transform on output.
function toFloating(d: Date): Date {
  return new Date(
    Date.UTC(
      d.getFullYear(),
      d.getMonth(),
      d.getDate(),
      d.getHours(),
      d.getMinutes(),
      d.getSeconds()
    )
  );
}

function fromFloating(d: Date): Date {
  return new Date(
    d.getUTCFullYear(),
    d.getUTCMonth(),
    d.getUTCDate(),
    d.getUTCHours(),
    d.getUTCMinutes(),
    d.getUTCSeconds()
  );
}

function parseRule(event: Event): RRule | null {
  if (!event.recurrence) return null;
  const dtstart = toFloating(eventStartDate(event));
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
  const floatingStart = toFloating(rangeStart);
  const floatingEnd = toFloating(rangeEnd);
  return rule.between(floatingStart, floatingEnd, true).map(fromFloating);
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
