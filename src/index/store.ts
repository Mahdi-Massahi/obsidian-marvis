import { create, StoreApi, UseBoundStore } from "zustand";
import type { Milestone, Project, Task, FilterState } from "../schema/types";
import { EMPTY_FILTER } from "../schema/types";

export interface PlannerState {
  tasks: Record<string, Task>;
  projects: Record<string, Project>;
  milestones: Record<string, Milestone>;
  filter: FilterState;
  setTasks: (tasks: Task[]) => void;
  setProjects: (projects: Project[]) => void;
  setMilestones: (milestones: Milestone[]) => void;
  upsertTask: (task: Task) => void;
  removeByPath: (path: string) => void;
  upsertProject: (project: Project) => void;
  upsertMilestone: (milestone: Milestone) => void;
  setFilter: (next: Partial<FilterState>) => void;
  resetFilter: () => void;
}

export type PlannerStore = UseBoundStore<StoreApi<PlannerState>>;

export function createPlannerStore(initialFilter: FilterState = EMPTY_FILTER): PlannerStore {
  return create<PlannerState>((set) => ({
    tasks: {},
    projects: {},
    milestones: {},
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
    upsertTask: (task) =>
      set((s) => ({ tasks: { ...s.tasks, [task.path]: task } })),
    upsertProject: (project) =>
      set((s) => ({ projects: { ...s.projects, [project.path]: project } })),
    upsertMilestone: (milestone) =>
      set((s) => ({ milestones: { ...s.milestones, [milestone.path]: milestone } })),
    removeByPath: (path) =>
      set((s) => {
        const tasks = { ...s.tasks };
        const projects = { ...s.projects };
        const milestones = { ...s.milestones };
        delete tasks[path];
        delete projects[path];
        delete milestones[path];
        return { tasks, projects, milestones };
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
