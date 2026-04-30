export type Kind = "task" | "project" | "milestone";

export type Status = string;
export type Priority = string;

export interface StatusDef {
  id: string;
  label: string;
  color: string;
  category: "open" | "active" | "done" | "blocked";
}

export interface PriorityDef {
  id: string;
  label: string;
  color: string;
  weight: number;
}

export interface ProjectStatusDef {
  id: "active" | "paused" | "done" | "archived";
  label: string;
}

export interface MilestoneStatusDef {
  id: "planned" | "active" | "done";
  label: string;
}

export interface Task {
  id: string;
  path: string;
  name: string;
  title: string;
  project?: string;
  milestone?: string;
  status: Status;
  priority?: Priority;
  due?: string;
  start?: string;
  tags: string[];
  created?: string;
  order: number;
  parent?: string;
  recurrence?: string;
  archived: boolean;
}

export interface Project {
  id: string;
  path: string;
  name: string;
  title: string;
  status: ProjectStatusDef["id"];
  color: string;
  created?: string;
  folder: string;
}

export interface Milestone {
  id: string;
  path: string;
  name: string;
  title: string;
  project?: string;
  due?: string;
  status: MilestoneStatusDef["id"];
}

export type ViewKind = "kanban" | "timeline" | "calendar" | "table";

export interface FilterState {
  projects: string[];
  milestones: string[];
  statuses: Status[];
  priorities: Priority[];
  tags: string[];
  dateRange: { from?: string; to?: string } | null;
  search: string;
  includeArchived: boolean;
  preset?: string;
}

export interface FilterPreset {
  id: string;
  name: string;
  filter: Omit<FilterState, "preset">;
}

export const DEFAULT_STATUSES: StatusDef[] = [
  { id: "backlog", label: "Backlog", color: "#94a3b8", category: "open" },
  { id: "todo", label: "To do", color: "#60a5fa", category: "open" },
  { id: "in-progress", label: "In progress", color: "#f59e0b", category: "active" },
  { id: "blocked", label: "Blocked", color: "#ef4444", category: "blocked" },
  { id: "done", label: "Done", color: "#10b981", category: "done" },
];

export const DEFAULT_PRIORITIES: PriorityDef[] = [
  { id: "low", label: "!", color: "#60a5fa", weight: 1 },
  { id: "medium", label: "!!", color: "#f59e0b", weight: 2 },
  { id: "high", label: "!!!", color: "#ef4444", weight: 3 },
];

export const DEFAULT_PROJECT_COLOR = "#3b82f6";

export const PROJECT_PALETTE = [
  "#3b82f6",
  "#10b981",
  "#f59e0b",
  "#ef4444",
  "#8b5cf6",
  "#ec4899",
  "#06b6d4",
  "#84cc16",
];

export const EMPTY_FILTER: FilterState = {
  projects: [],
  milestones: [],
  statuses: [],
  priorities: [],
  tags: [],
  dateRange: null,
  search: "",
  includeArchived: false,
};
