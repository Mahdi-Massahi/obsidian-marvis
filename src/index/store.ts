import { create, StoreApi, UseBoundStore } from "zustand";
import type { Milestone, Project, Task, Log, Event, Habit, FilterState } from "../schema/types";
import { EMPTY_FILTER } from "../schema/types";

export interface PlannerState {
  tasks: Record<string, Task>;
  projects: Record<string, Project>;
  milestones: Record<string, Milestone>;
  logs: Record<string, Log>;
  events: Record<string, Event>;
  habits: Record<string, Habit>;
  filter: FilterState;
  focusTaskPath: string | null;
  focusTask: (path: string | null) => void;
  setTasks: (tasks: Task[]) => void;
  setProjects: (projects: Project[]) => void;
  setMilestones: (milestones: Milestone[]) => void;
  setLogs: (logs: Log[]) => void;
  setEvents: (events: Event[]) => void;
  setHabits: (habits: Habit[]) => void;
  upsertTask: (task: Task) => void;
  removeByPath: (path: string) => void;
  upsertProject: (project: Project) => void;
  upsertMilestone: (milestone: Milestone) => void;
  upsertLog: (log: Log) => void;
  upsertEvent: (event: Event) => void;
  upsertHabit: (habit: Habit) => void;
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
    events: {},
    habits: {},
    filter: initialFilter,
    focusTaskPath: null,
    focusTask: (path) => set({ focusTaskPath: path }),
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
    setEvents: (events) =>
      set(() => ({
        events: Object.fromEntries(events.map((e) => [e.path, e])),
      })),
    setHabits: (habits) =>
      set(() => ({
        habits: Object.fromEntries(habits.map((h) => [h.path, h])),
      })),
    upsertTask: (task) =>
      set((s) => ({ tasks: { ...s.tasks, [task.path]: task } })),
    upsertProject: (project) =>
      set((s) => ({ projects: { ...s.projects, [project.path]: project } })),
    upsertMilestone: (milestone) =>
      set((s) => ({ milestones: { ...s.milestones, [milestone.path]: milestone } })),
    upsertLog: (log) =>
      set((s) => ({ logs: { ...s.logs, [log.path]: log } })),
    upsertEvent: (event) =>
      set((s) => ({ events: { ...s.events, [event.path]: event } })),
    upsertHabit: (habit) =>
      set((s) => ({ habits: { ...s.habits, [habit.path]: habit } })),
    removeByPath: (path) =>
      set((s) => {
        const tasks = { ...s.tasks };
        const projects = { ...s.projects };
        const milestones = { ...s.milestones };
        const logs = { ...s.logs };
        const events = { ...s.events };
        const habits = { ...s.habits };
        delete tasks[path];
        delete projects[path];
        delete milestones[path];
        delete logs[path];
        delete events[path];
        delete habits[path];
        return { tasks, projects, milestones, logs, events, habits };
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

export function selectEventList(s: PlannerState): Event[] {
  return Object.values(s.events);
}

export function selectHabitList(s: PlannerState): Habit[] {
  return Object.values(s.habits);
}

export function selectLogList(s: PlannerState): Log[] {
  return Object.values(s.logs);
}
