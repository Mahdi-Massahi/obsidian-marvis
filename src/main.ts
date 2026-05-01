import { Plugin, WorkspaceLeaf } from "obsidian";
import type { SidebarLeafCache } from "./utils/openFile";
import { DEFAULT_SETTINGS, KanbanPlusSettings, KanbanPlusSettingTab } from "./settings";
import { Indexer } from "./index/indexer";
import { createPlannerStore, PlannerStore } from "./index/store";
import { ProjectService } from "./services/projectService";
import { MilestoneService } from "./services/milestoneService";
import { TaskService } from "./services/taskService";
import { PlannerView, VIEW_TYPE_KANBAN_PLUS } from "./views/PlannerView";
import { registerCommands } from "./commands";
import type { ViewKind } from "./schema/types";

export default class KanbanPlusPlugin extends Plugin {
  settings!: KanbanPlusSettings;
  store!: PlannerStore;
  indexer!: Indexer;
  projectService!: ProjectService;
  milestoneService!: MilestoneService;
  taskService!: TaskService;

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
      sidebarCache
    );
    this.milestoneService = new MilestoneService(
      this.app,
      this.projectService,
      getOpenMode,
      sidebarCache
    );
    this.taskService = new TaskService(
      this.app,
      this.projectService,
      getOpenMode,
      sidebarCache
    );

    this.indexer = new Indexer(this.app, this.store, () => this.settings.rootFolder);
    this.app.workspace.onLayoutReady(() => this.indexer.start());

    this.registerView(
      VIEW_TYPE_KANBAN_PLUS,
      (leaf: WorkspaceLeaf) => new PlannerView(leaf, this, this.settings.defaultView)
    );

    registerCommands(this);

    this.addRibbonIcon("kanban-square", "Open Kanban+", () => {
      void this.activateView(this.settings.defaultView);
    });

    this.addSettingTab(new KanbanPlusSettingTab(this.app, this));
  }

  onunload(): void {
    this.indexer?.stop();
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
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
    this.app.workspace.revealLeaf(leaf);
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
};
