import type { FilterState, Habit, Task } from "../schema/types";
import { isInRange } from "../utils/dates";

// Cache the lowercased search haystack per object so we don't rebuild a
// potentially-8000-char string on every keystroke for every task across four
// views. `WeakMap` so cache entries vanish when the indexer replaces a Task.
const taskHaystacks = new WeakMap<Task, string>();
const habitHaystacks = new WeakMap<Habit, string>();

function taskHaystack(t: Task): string {
  let h = taskHaystacks.get(t);
  if (h === undefined) {
    h = `${t.title} ${t.tags.join(" ")} ${t.project ?? ""} ${t.milestone ?? ""} ${t.body ?? ""}`.toLowerCase();
    taskHaystacks.set(t, h);
  }
  return h;
}

function habitHaystack(h: Habit): string {
  let s = habitHaystacks.get(h);
  if (s === undefined) {
    s = `${h.title} ${h.tags.join(" ")} ${h.project} ${h.milestone ?? ""} ${h.goal ?? ""}`.toLowerCase();
    habitHaystacks.set(h, s);
  }
  return s;
}

export function applyFilter(tasks: Task[], filter: FilterState): Task[] {
  const search = filter.search.trim().toLowerCase();
  const dateFrom = filter.dateRange?.from;
  const dateTo = filter.dateRange?.to;
  const projectSet = filter.projects.length ? new Set(filter.projects) : null;
  const milestoneSet = filter.milestones.length ? new Set(filter.milestones) : null;
  const statusSet = filter.statuses.length ? new Set(filter.statuses) : null;
  const prioritySet = filter.priorities.length ? new Set(filter.priorities) : null;
  const tagFilter = filter.tags.length ? filter.tags : null;
  const dateActive = !!(dateFrom || dateTo);

  return tasks.filter((t) => {
    if (!filter.includeArchived && t.archived) return false;
    if (projectSet && (!t.project || !projectSet.has(t.project))) return false;
    if (milestoneSet && (!t.milestone || !milestoneSet.has(t.milestone))) return false;
    if (statusSet && !statusSet.has(t.status)) return false;
    if (prioritySet && (!t.priority || !prioritySet.has(t.priority))) return false;
    if (tagFilter) {
      const taskTags = new Set(t.tags);
      for (const tag of tagFilter) if (!taskTags.has(tag)) return false;
    }
    if (dateActive && !isInRange(t.due, dateFrom, dateTo)) return false;
    if (search && !taskHaystack(t).includes(search)) return false;
    return true;
  });
}

export function applyHabitFilter(habits: Habit[], filter: FilterState): Habit[] {
  const search = filter.search.trim().toLowerCase();
  const projectSet = filter.projects.length ? new Set(filter.projects) : null;
  const milestoneSet = filter.milestones.length ? new Set(filter.milestones) : null;
  const freqSet = filter.frequencies.length ? new Set(filter.frequencies) : null;
  const stateSet = filter.habitStates.length ? new Set(filter.habitStates) : null;
  const tagFilter = filter.tags.length ? filter.tags : null;
  return habits.filter((h) => {
    if (!filter.includeArchived && h.archived) return false;
    if (projectSet && !projectSet.has(h.project)) return false;
    if (milestoneSet && (!h.milestone || !milestoneSet.has(h.milestone))) return false;
    if (freqSet && !freqSet.has(h.frequency)) return false;
    if (stateSet && !stateSet.has(h.state)) return false;
    if (tagFilter) {
      const habitTags = new Set(h.tags);
      for (const tag of tagFilter) if (!habitTags.has(tag)) return false;
    }
    if (search && !habitHaystack(h).includes(search)) return false;
    return true;
  });
}
