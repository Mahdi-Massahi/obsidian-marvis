import type { FilterState, Habit, Task } from "../schema/types";
import { isInRange } from "../utils/dates";

export function applyFilter(tasks: Task[], filter: FilterState): Task[] {
  const search = filter.search.trim().toLowerCase();
  const dateFrom = filter.dateRange?.from;
  const dateTo = filter.dateRange?.to;

  return tasks.filter((t) => {
    if (!filter.includeArchived && t.archived) return false;
    if (filter.projects.length && (!t.project || !filter.projects.includes(t.project))) return false;
    if (filter.milestones.length) {
      if (!t.milestone || !filter.milestones.includes(t.milestone)) return false;
    }
    if (filter.statuses.length && !filter.statuses.includes(t.status)) return false;
    if (filter.priorities.length) {
      if (!t.priority || !filter.priorities.includes(t.priority)) return false;
    }
    if (filter.tags.length) {
      const taskTags = new Set(t.tags);
      if (!filter.tags.every((tag) => taskTags.has(tag))) return false;
    }
    if (dateFrom || dateTo) {
      if (!isInRange(t.due, dateFrom, dateTo)) return false;
    }
    if (search) {
      const haystack = `${t.title} ${t.tags.join(" ")} ${t.project ?? ""} ${
        t.milestone ?? ""
      } ${t.body ?? ""}`.toLowerCase();
      if (!haystack.includes(search)) return false;
    }
    return true;
  });
}

export function applyHabitFilter(habits: Habit[], filter: FilterState): Habit[] {
  const search = filter.search.trim().toLowerCase();
  return habits.filter((h) => {
    if (!filter.includeArchived && h.archived) return false;
    if (filter.projects.length && !filter.projects.includes(h.project)) return false;
    if (filter.milestones.length) {
      if (!h.milestone || !filter.milestones.includes(h.milestone)) return false;
    }
    if (filter.frequencies.length && !filter.frequencies.includes(h.frequency)) return false;
    if (filter.habitStates.length && !filter.habitStates.includes(h.state)) return false;
    if (filter.tags.length) {
      const habitTags = new Set(h.tags);
      if (!filter.tags.every((tag) => habitTags.has(tag))) return false;
    }
    if (search) {
      const haystack = `${h.title} ${h.tags.join(" ")} ${h.project} ${h.milestone ?? ""} ${h.goal ?? ""}`.toLowerCase();
      if (!haystack.includes(search)) return false;
    }
    return true;
  });
}
