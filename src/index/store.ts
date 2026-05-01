import { create, StoreApi, UseBoundStore } from "zustand";
import type { Milestone, Project, Task, Log, FilterState } from "../schema/types";
import { EMPTY_FILTER } from "../schema/types";

export interface PlannerState {
  tasks: Record<string, Task>;
  projects: Record<string, Project>;
  milestones: Record<string, Milestone>;
  logs: Record<string, Log>;
  filter: FilterState;
  setTasks: (tasks: Task[]) => void;
  setProjects: (projects: Project[]) => void;
  setMilestones: (milestones: Milestone[]) => void;
  setLogs: (logs: Log[]) => void;
  upsertTask: (task: Task) => void;
  removeByPath: (path: string) => void;
  upsertProject: (project: Project) => void;
  upsertMilestone: (milestone: Milestone) => void;
  upsertLog: (log: Log) => void;
  setFilter: (next: Partial<FilterState>) => void;
  resetFilter: () => void;
}

export type PlannerStore = UseBoundStore<StoreApi<PlannerState>>;

export function createPlannerStore(initialFilter: FilterState = EMPTY_FILTER): PlannerStore {
  return create<PlannerState>((set) => ({
    tasks: {},
    projects: {},
    milestones: {},
    logs: {},
    filter: initialFilter,
    setTasks: (tasks) =>
      set(() => ({
        tasks: Object.fromEntries(tasks.map((t) => [t.path, t])),
      })),
    setProjects: (projects) =>
      set(() => ({
        projects: Object.fromEntries(projects.map((p) => [p.path, p])),
      })),
    setMilestones: (milestones) =>
      set(() => ({
        milestones: Object.fromEntries(milestones.map((m) => [m.path, m])),
      })),
    setLogs: (logs) =>
      set(() => ({
        logs: Object.fromEntries(logs.map((l) => [l.path, l])),
      })),
    upsertTask: (task) =>
      set((s) => ({ tasks: { ...s.tasks, [task.path]: task } })),
    upsertProject: (project) =>
      set((s) => ({ projects: { ...s.projects, [project.path]: project } })),
    upsertMilestone: (milestone) =>
      set((s) => ({ milestones: { ...s.milestones, [milestone.path]: milestone } })),
    upsertLog: (log) =>
      set((s) => ({ logs: { ...s.logs, [log.path]: log } })),
    removeByPath: (path) =>
      set((s) => {
        const tasks = { ...s.tasks };
        const projects = { ...s.projects };
        const milestones = { ...s.milestones };
        const logs = { ...s.logs };
        delete tasks[path];
        delete projects[path];
        delete milestones[path];
        delete logs[path];
        return { tasks, projects, milestones, logs };
      }),
    setFilter: (next) =>
      set((s) => ({ filter: { ...s.filter, ...next } })),
    resetFilter: () => set({ filter: EMPTY_FILTER }),
  }));
}

export function selectTaskList(s: PlannerState): Task[] {
  return Object.values(s.tasks);
}

export function selectProjectList(s: PlannerState): Project[] {
  return Object.values(s.projects);
}

export function selectMilestoneList(s: PlannerState): Milestone[] {
  return Object.values(s.milestones);
}
