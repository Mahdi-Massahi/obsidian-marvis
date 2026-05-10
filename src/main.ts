import { Plugin, WorkspaceLeaf } from "obsidian";
import type { SidebarLeafCache } from "./utils/openFile";
import {
  DEFAULT_ASSISTANT_SETTINGS,
  DEFAULT_SETTINGS,
  DEFAULT_VIEW_STATE,
  KanbanPlusSettings,
  KanbanPlusSettingTab,
} from "./settings";
import { Indexer } from "./index/indexer";
import { createPlannerStore, PlannerStore } from "./index/store";
import { ProjectService } from "./services/projectService";
import { MilestoneService } from "./services/milestoneService";
import { TaskService } from "./services/taskService";
import { LogService } from "./services/logService";
import { EventService } from "./services/eventService";
import { CalendarSyncEngine } from "./services/calendar/syncEngine";
import { ChatTranscriptService } from "./services/assistant/chatTranscriptService";
import { AssistantSession } from "./services/assistant/assistantSession";
import { PlannerView, VIEW_TYPE_KANBAN_PLUS } from "./views/PlannerView";
import { AssistantView, VIEW_TYPE_MARVIS_ASSISTANT } from "./views/AssistantView";
import { TaskActionBar } from "./views/shared/TaskActionBar";
import { registerCommands } from "./commands";
import type { ViewKind } from "./schema/types";

export default class KanbanPlusPlugin extends Plugin {
  settings!: KanbanPlusSettings;
  store!: PlannerStore;
  indexer!: Indexer;
  projectService!: ProjectService;
  milestoneService!: MilestoneService;
  taskService!: TaskService;
  logService!: LogService;
  eventService!: EventService;
  calendarSyncEngine!: CalendarSyncEngine;
  chatTranscriptService!: ChatTranscriptService;
  assistantSession!: AssistantSession;
  taskActionBar!: TaskActionBar;

  private openViews = new Set<PlannerView>();

  async onload(): Promise<void> {
    await this.loadSettings();
    this.store = createPlannerStore({
      ...DEFAULT_SETTINGS_FILTER,
      includeArchived: this.settings.showArchivedByDefault,
    });

    const getOpenMode = () => this.settings.openIn;
    let sidebarLeaf: WorkspaceLeaf | null = null;
    const sidebarCache: SidebarLeafCache = {
      get: () => sidebarLeaf,
      set: (leaf) => {
        sidebarLeaf = leaf;
      },
    };
    this.projectService = new ProjectService(
      this.app,
      () => this.settings.rootFolder,
      getOpenMode,
      sidebarCache,
      () => this.settings.marvisSkillTemplate,
      () => this.allocateCode("project")
    );
    this.milestoneService = new MilestoneService(
      this.app,
      this.projectService,
      getOpenMode,
      sidebarCache,
      () => this.allocateCode("milestone")
    );
    this.taskService = new TaskService(
      this.app,
      this.projectService,
      getOpenMode,
      sidebarCache,
      () => this.allocateCode("task")
    );
    this.logService = new LogService(
      this.app,
      this.projectService,
      getOpenMode,
      sidebarCache,
      () => this.allocateCode("log")
    );
    this.eventService = new EventService(
      this.app,
      this.projectService,
      getOpenMode,
      sidebarCache,
      () => this.allocateCode("event")
    );
    this.calendarSyncEngine = new CalendarSyncEngine(
      this,
      this.eventService,
      this.projectService
    );
    this.chatTranscriptService = new ChatTranscriptService(
      this.app,
      () => this.settings.rootFolder
    );
    this.assistantSession = new AssistantSession(this, this.chatTranscriptService);

    this.indexer = new Indexer(this.app, this.store, () => this.settings.rootFolder);
    this.app.workspace.onLayoutReady(() => this.indexer.start());

    this.registerView(
      VIEW_TYPE_KANBAN_PLUS,
      (leaf: WorkspaceLeaf) => new PlannerView(leaf, this, this.settings.defaultView)
    );
    this.registerView(
      VIEW_TYPE_MARVIS_ASSISTANT,
      (leaf: WorkspaceLeaf) => new AssistantView(leaf, this)
    );

    registerCommands(this);
    this.registerTaskContextMenu();
    this.taskActionBar = new TaskActionBar(this);
    this.taskActionBar.start();

    this.addRibbonIcon("kanban-square", "Open Marvis", () => {
      void this.activateView(this.settings.defaultView);
    });

    this.addSettingTab(new KanbanPlusSettingTab(this.app, this));
  }

  onunload(): void {
    this.taskActionBar?.stop();
    this.indexer?.stop();
    void this.assistantSession?.stop();
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    if (!this.settings.calendarSync) {
      this.settings.calendarSync = {
        macos: { availableCalendars: [], selectedCalendars: [] },
      };
    }
    if (!this.settings.calendarSync.macos) {
      this.settings.calendarSync.macos = { availableCalendars: [], selectedCalendars: [] };
    }
    // Drop any vestigial OAuth-provider blocks from earlier iterations.
    const stale = this.settings.calendarSync as unknown as Record<string, unknown>;
    delete stale["outlook"];
    delete stale["google"];
    if (!this.settings.assistant) {
      this.settings.assistant = { ...DEFAULT_ASSISTANT_SETTINGS };
    } else {
      this.settings.assistant = { ...DEFAULT_ASSISTANT_SETTINGS, ...this.settings.assistant };
    }
    if (!this.settings.viewState) {
      this.settings.viewState = {
        ...DEFAULT_VIEW_STATE,
        kanbanGroupBy: this.settings.defaultKanbanGroupBy ?? DEFAULT_VIEW_STATE.kanbanGroupBy,
      };
    } else {
      this.settings.viewState = { ...DEFAULT_VIEW_STATE, ...this.settings.viewState };
    }
    // Migrate older installs that don't yet carry the `review` status. Splice
    // it in between in-progress and blocked so the natural workflow order is
    // preserved.
    if (
      Array.isArray(this.settings.statuses) &&
      !this.settings.statuses.some((s) => s.id === "review")
    ) {
      const idx = this.settings.statuses.findIndex((s) => s.id === "in-progress");
      const reviewDef = {
        id: "review",
        label: "Review",
        color: "#a855f7",
        category: "active" as const,
      };
      const insertAt = idx >= 0 ? idx + 1 : this.settings.statuses.length;
      this.settings.statuses = [
        ...this.settings.statuses.slice(0, insertAt),
        reviewDef,
        ...this.settings.statuses.slice(insertAt),
      ];
      await this.saveSettings();
    }
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  async allocateCode(kind: "task" | "log" | "milestone" | "project" | "event"): Promise<string> {
    if (!this.settings.nextCode) {
      this.settings.nextCode = { task: 1, log: 1, milestone: 1, project: 1, event: 1 };
    }
    if (this.settings.nextCode.event == null) this.settings.nextCode.event = 1;
    const n = this.settings.nextCode[kind] ?? 1;
    this.settings.nextCode[kind] = n + 1;
    await this.saveSettings();
    const prefix = { task: "T", log: "L", milestone: "M", project: "P", event: "E" }[kind];
    return `${prefix}-${n}`;
  }

  bumpCodeCounter(kind: "task" | "log" | "milestone" | "project" | "event", to: number): void {
    if (!this.settings.nextCode) {
      this.settings.nextCode = { task: 1, log: 1, milestone: 1, project: 1, event: 1 };
    }
    if (this.settings.nextCode.event == null) this.settings.nextCode.event = 1;
    if (to > this.settings.nextCode[kind]) {
      this.settings.nextCode[kind] = to;
    }
  }

  private registerTaskContextMenu(): void {
    const isTask = (file: { path: string } | null): boolean => {
      if (!file) return false;
      const real = this.app.vault.getAbstractFileByPath(file.path);
      if (!real || (real as { extension?: string }).extension !== "md") return false;
      const fm = this.app.metadataCache.getFileCache(real as never)?.frontmatter ?? null;
      return !!fm && fm["kind"] === "task";
    };
    const confirmAndDelete = (filePath: string) => {
      (
        this.app as unknown as {
          commands: { executeCommandById: (id: string) => boolean };
        }
      ).commands.executeCommandById("marvis:delete-active-task");
      void filePath;
    };
    this.registerEvent(
      this.app.workspace.on("file-menu", (menu, file) => {
        const f = file as { path: string } | null;
        if (!isTask(f)) return;
        menu.addItem((item) =>
          item
            .setTitle("Delete Marvis task")
            .setIcon("trash")
            .onClick(async () => {
              if (!f) return;
              // Activate the file first so the command's checkCallback resolves to it.
              const target = this.app.vault.getAbstractFileByPath(f.path);
              if (target && (target as { extension?: string }).extension === "md") {
                await this.app.workspace.getLeaf(false).openFile(target as never);
              }
              confirmAndDelete(f.path);
            })
        );
      })
    );
    this.registerEvent(
      this.app.workspace.on("editor-menu", (menu, _editor, view) => {
        const file = (view as { file?: { path: string } }).file;
        if (!file || !isTask(file)) return;
        menu.addItem((item) =>
          item
            .setTitle("Delete Marvis task")
            .setIcon("trash")
            .onClick(() => confirmAndDelete(file.path))
        );
      })
    );
  }

  registerOpenView(view: PlannerView): void {
    this.openViews.add(view);
  }

  unregisterOpenView(view: PlannerView): void {
    this.openViews.delete(view);
  }

  refreshViews(): void {
    for (const v of this.openViews) v.refresh();
  }

  async activateView(kind: ViewKind): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_KANBAN_PLUS);
    let leaf: WorkspaceLeaf | undefined = existing[0];
    if (!leaf) {
      leaf = this.app.workspace.getLeaf("tab");
      await leaf.setViewState({ type: VIEW_TYPE_KANBAN_PLUS, state: { kind }, active: true });
    } else {
      await leaf.setViewState({ type: VIEW_TYPE_KANBAN_PLUS, state: { kind }, active: true });
    }
    await this.app.workspace.revealLeaf(leaf);
  }

  isAssistantLeafOpen(): boolean {
    return this.app.workspace.getLeavesOfType(VIEW_TYPE_MARVIS_ASSISTANT).length > 0;
  }

  async toggleAssistantLeaf(): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_MARVIS_ASSISTANT);
    if (existing.length > 0) {
      // Detach all instances. AssistantView.onClose stops the session and
      // notifies planner views to refresh their toggle button.
      for (const leaf of existing) leaf.detach();
      return;
    }
    // ensureSideLeaf adds the view as a tab in the right sidebar instead of
    // splitting beside whatever leaf is already there — prevents the "narrow
    // sliver beside another pane" layout that getRightLeaf(false) can produce.
    await this.app.workspace.ensureSideLeaf(VIEW_TYPE_MARVIS_ASSISTANT, "right", {
      active: true,
      reveal: true,
    });
  }
}

const DEFAULT_SETTINGS_FILTER = {
  projects: [] as string[],
  milestones: [] as string[],
  statuses: [] as string[],
  priorities: [] as string[],
  tags: [] as string[],
  dateRange: null,
  search: "",
  includeArchived: false,
  includeLogs: true,
  includeEvents: true,
};
