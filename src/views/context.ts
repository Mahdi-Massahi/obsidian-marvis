import { createContext, useContext } from "react";
import type { App } from "obsidian";
import type { PlannerStore } from "../index/store";
import type { TaskService } from "../services/taskService";
import type { ProjectService } from "../services/projectService";
import type { MilestoneService } from "../services/milestoneService";
import type { LogService } from "../services/logService";
import type { EventService } from "../services/eventService";
import type { KanbanPlusSettings } from "../settings";

export interface PluginContextValue {
  app: App;
  store: PlannerStore;
  taskService: TaskService;
  projectService: ProjectService;
  milestoneService: MilestoneService;
  logService: LogService;
  eventService: EventService;
  settings: KanbanPlusSettings;
  switchView: (kind: "kanban" | "timeline" | "calendar" | "table") => void;
  openQuickCreate: (defaults?: Partial<{ due: string; project: string }>) => void;
  openCreateMenu: () => void;
}

export const PluginContext = createContext<PluginContextValue | null>(null);

export function usePlugin(): PluginContextValue {
  const ctx = useContext(PluginContext);
  if (!ctx) throw new Error("PluginContext not provided");
  return ctx;
}
