import Fuse from "fuse.js";
import type { Task } from "../schema/types";

export function buildSearchIndex(tasks: Task[]): Fuse<Task> {
  return new Fuse(tasks, {
    keys: [
      { name: "title", weight: 0.6 },
      { name: "tags", weight: 0.2 },
      { name: "project", weight: 0.1 },
      { name: "milestone", weight: 0.1 },
    ],
    threshold: 0.35,
    ignoreLocation: true,
  });
}

export function fuzzySearch(tasks: Task[], query: string): Task[] {
  if (!query.trim()) return tasks;
  const fuse = buildSearchIndex(tasks);
  return fuse.search(query).map((r) => r.item);
}
