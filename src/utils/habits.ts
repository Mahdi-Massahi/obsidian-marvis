import {
  addDays,
  addMonths,
  addWeeks,
  getISOWeek,
  getISOWeekYear,
  startOfDay,
  startOfMonth,
} from "date-fns";
import type { Habit, HabitFrequency, Log } from "../schema/types";
import { fmtISO, parseDate } from "./dates";

export function periodKey(date: Date, frequency: HabitFrequency): string {
  if (frequency === "daily") return fmtISO(startOfDay(date));
  if (frequency === "weekly") {
    const year = getISOWeekYear(date);
    const week = getISOWeek(date);
    return `${year}-W${String(week).padStart(2, "0")}`;
  }
  const m = startOfMonth(date);
  return `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, "0")}`;
}

export function periodKeyFromISO(iso: string, frequency: HabitFrequency): string | null {
  const d = parseDate(iso);
  if (!d) return null;
  return periodKey(d, frequency);
}

export function previousPeriod(key: string, frequency: HabitFrequency): string {
  return shiftPeriod(key, frequency, -1);
}

export function nextPeriod(key: string, frequency: HabitFrequency): string {
  return shiftPeriod(key, frequency, 1);
}

function shiftPeriod(key: string, frequency: HabitFrequency, by: number): string {
  if (frequency === "daily") {
    const d = parseDate(key);
    if (!d) return key;
    return periodKey(addDays(d, by), frequency);
  }
  if (frequency === "weekly") {
    const m = key.match(/^(\d{4})-W(\d{2})$/);
    if (!m) return key;
    const isoYear = Number(m[1]);
    const isoWeek = Number(m[2]);
    const jan4 = new Date(isoYear, 0, 4);
    const jan4Dow = (jan4.getDay() + 6) % 7;
    const week1Mon = addDays(jan4, -jan4Dow);
    const target = addWeeks(week1Mon, isoWeek - 1 + by);
    return periodKey(target, frequency);
  }
  const m2 = key.match(/^(\d{4})-(\d{2})$/);
  if (!m2) return key;
  const anchor = new Date(Number(m2[1]), Number(m2[2]) - 1, 1);
  return periodKey(addMonths(anchor, by), frequency);
}

export function periodsBack(now: Date, frequency: HabitFrequency, count: number): string[] {
  const out: string[] = [];
  let key = periodKey(now, frequency);
  for (let i = 0; i < count; i++) {
    out.unshift(key);
    key = previousPeriod(key, frequency);
  }
  return out;
}

/** Maps periodKey → completion count for this habit. */
export function completionCounts(habit: Habit, logs: Log[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const log of logs) {
    if (log.habit !== habit.name) continue;
    const key = periodKeyFromISO(log.timestamp, habit.frequency);
    if (!key) continue;
    out.set(key, (out.get(key) ?? 0) + 1);
  }
  return out;
}

/** Maps ISO day (YYYY-MM-DD) → completion count for this habit. Independent of frequency. */
export function dayCounts(habit: Habit, logs: Log[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const log of logs) {
    if (log.habit !== habit.name) continue;
    const day = log.timestamp.slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
    out.set(day, (out.get(day) ?? 0) + 1);
  }
  return out;
}

export function isPeriodMet(habit: Habit, counts: Map<string, number>, key: string): boolean {
  return (counts.get(key) ?? 0) >= habit.target;
}

export interface StreakInfo {
  current: number;
  longest: number;
  lastCompleted?: string;
}

export function computeStreak(habit: Habit, counts: Map<string, number>, now: Date): StreakInfo {
  if (habit.state === "paused" || counts.size === 0) {
    return { current: 0, longest: longestStreak(counts, habit) };
  }
  const met = (k: string) => (counts.get(k) ?? 0) >= habit.target;
  let current = 0;
  let cursor = periodKey(now, habit.frequency);
  if (!met(cursor)) {
    cursor = previousPeriod(cursor, habit.frequency);
  }
  while (met(cursor)) {
    current++;
    cursor = previousPeriod(cursor, habit.frequency);
  }
  const sortedMet = Array.from(counts.entries())
    .filter(([, n]) => n >= habit.target)
    .map(([k]) => k)
    .sort();
  const lastCompleted = sortedMet[sortedMet.length - 1];
  return { current, longest: longestStreak(counts, habit), lastCompleted };
}

function longestStreak(counts: Map<string, number>, habit: Habit): number {
  if (counts.size === 0) return 0;
  const sortedMet = Array.from(counts.entries())
    .filter(([, n]) => n >= habit.target)
    .map(([k]) => k)
    .sort();
  if (sortedMet.length === 0) return 0;
  let longest = 1;
  let run = 1;
  for (let i = 1; i < sortedMet.length; i++) {
    const expected = nextPeriod(sortedMet[i - 1], habit.frequency);
    if (sortedMet[i] === expected) {
      run++;
      longest = Math.max(longest, run);
    } else {
      run = 1;
    }
  }
  return longest;
}

/**
 * Days where at least one tick is a *bonus* tick — meaning it exceeds the
 * habit's target within its period. Used by the Review grid to colour cells
 * gold (vs green for in-target ticks).
 */
export function bonusTickDays(habit: Habit, logs: Log[]): Set<string> {
  const byPeriod = new Map<string, Log[]>();
  for (const log of logs) {
    if (log.habit !== habit.name) continue;
    const key = periodKeyFromISO(log.timestamp, habit.frequency);
    if (!key) continue;
    const arr = byPeriod.get(key) ?? [];
    arr.push(log);
    byPeriod.set(key, arr);
  }
  const bonus = new Set<string>();
  for (const list of byPeriod.values()) {
    list.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    for (let i = habit.target; i < list.length; i++) {
      bonus.add(list[i].timestamp.slice(0, 10));
    }
  }
  return bonus;
}

/** Generates the past `count` calendar days ending today (today is last). */
export function pastDays(now: Date, count: number): Date[] {
  const days: Date[] = [];
  const today = startOfDay(now);
  for (let i = count - 1; i >= 0; i--) {
    days.push(addDays(today, -i));
  }
  return days;
}
