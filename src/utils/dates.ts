import {
  addDays,
  endOfMonth,
  endOfWeek,
  format,
  isAfter,
  isBefore,
  isSameDay,
  isSameMonth,
  parseISO,
  startOfDay,
  startOfMonth,
  startOfWeek,
} from "date-fns";

export function parseDate(iso?: string): Date | null {
  if (!iso) return null;
  const d = parseISO(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function fmtISO(d: Date): string {
  return format(d, "yyyy-MM-dd");
}

export function fmtShort(d: Date): string {
  return format(d, "MMM d");
}

export function fmtMonth(d: Date): string {
  return format(d, "MMMM yyyy");
}

export function isInRange(iso: string | undefined, from?: string, to?: string): boolean {
  if (!iso) return !from && !to;
  const d = parseDate(iso);
  if (!d) return false;
  if (from) {
    const f = parseDate(from);
    if (f && isBefore(d, startOfDay(f))) return false;
  }
  if (to) {
    const t = parseDate(to);
    if (t && isAfter(d, startOfDay(t))) return false;
  }
  return true;
}

export function tomorrowISO(): string {
  return fmtISO(addDays(new Date(), 1));
}

export function nextWeekISO(): string {
  return fmtISO(addDays(new Date(), 7));
}

export function monthGrid(month: Date, weekStartsOn: 0 | 1 = 1): Date[][] {
  const start = startOfWeek(startOfMonth(month), { weekStartsOn });
  const end = endOfWeek(endOfMonth(month), { weekStartsOn });
  const days: Date[] = [];
  let cur = start;
  while (!isAfter(cur, end)) {
    days.push(cur);
    cur = addDays(cur, 1);
  }
  const weeks: Date[][] = [];
  for (let i = 0; i < days.length; i += 7) {
    weeks.push(days.slice(i, i + 7));
  }
  return weeks;
}

export function formatAge(fromMs: number, nowMs: number = Date.now()): string {
  const diff = Math.max(0, nowMs - fromMs);
  const sec = Math.floor(diff / 1000);
  if (sec < 45) return "now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  const day = Math.floor(hr / 24);
  if (day < 14) return `${day}d`;
  const wk = Math.floor(day / 7);
  if (wk < 9) return `${wk}w`;
  const mo = Math.floor(day / 30);
  if (mo < 12) return `${mo}mo`;
  const yr = Math.floor(day / 365);
  return `${yr}y`;
}

export { addDays, isSameDay, isSameMonth, startOfDay, format };
