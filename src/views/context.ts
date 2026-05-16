import * as React from "react";
import { createContext, useContext } from "react";
import type { App } from "obsidian";
import type { PlannerStore } from "../index/store";
import type { TaskService } from "../services/taskService";
import type { ProjectService } from "../services/projectService";
import type { MilestoneService } from "../services/milestoneService";
import type { LogService } from "../services/logService";
import type { EventService } from "../services/eventService";
import type { HabitService } from "../services/habitService";
import type { CalendarSyncEngine } from "../services/calendar/syncEngine";
import type { AssistantSession } from "../services/assistant/assistantSession";
import type { KanbanPlusSettings, ViewStateSettings } from "../settings";
import type { ViewKind } from "../schema/types";

export interface PluginContextValue {
  app: App;
  store: PlannerStore;
  taskService: TaskService;
  projectService: ProjectService;
  milestoneService: MilestoneService;
  logService: LogService;
  eventService: EventService;
  habitService: HabitService;
  calendarSyncEngine: CalendarSyncEngine;
  assistantSession: AssistantSession;
  settings: KanbanPlusSettings;
  savePluginSettings: () => Promise<void>;
  switchView: (kind: ViewKind) => void;
  openQuickCreate: (defaults?: Partial<{ due: string; project: string }>) => void;
  openCreateMenu: () => void;
  toggleAssistant: () => void;
  isAssistantOpen: boolean;
}

export const PluginContext = createContext<PluginContextValue | null>(null);

export function usePlugin(): PluginContextValue {
  const ctx = useContext(PluginContext);
  if (!ctx) throw new Error("PluginContext not provided");
  return ctx;
}

export function usePersistedViewState<K extends keyof ViewStateSettings>(
  key: K
): [ViewStateSettings[K], (value: ViewStateSettings[K]) => void] {
  const { settings, savePluginSettings } = usePlugin();
  const [value, setValue] = React.useState<ViewStateSettings[K]>(
    settings.viewState[key]
  );
  const update = React.useCallback(
    (next: ViewStateSettings[K]) => {
      setValue(next);
      settings.viewState[key] = next;
      void savePluginSettings();
    },
    [key, settings, savePluginSettings]
  );
  return [value, update];
}
