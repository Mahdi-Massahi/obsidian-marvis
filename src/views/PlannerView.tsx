import { ItemView, WorkspaceLeaf, ViewStateResult } from "obsidian";
import * as React from "react";
import { createRoot, Root } from "react-dom/client";
import type KanbanPlusPlugin from "../main";
import type { ViewKind } from "../schema/types";
import { PluginContext } from "./context";
import { KanbanRoot } from "./Kanban";
import { TableRoot } from "./Table";
import { CalendarRoot } from "./Calendar";
import { TimelineRoot } from "./Timeline";
import { QuickCreateModal, QuickCreateDefaults } from "./shared/QuickCreateModal";
import { CreateMenuModal } from "./shared/CreateMenuModal";

export const VIEW_TYPE_KANBAN_PLUS = "marvis-view";

interface PlannerViewState {
  kind: ViewKind;
}

export class PlannerView extends ItemView {
  private plugin: KanbanPlusPlugin;
  private root: Root | null = null;
  private kind: ViewKind;

  constructor(leaf: WorkspaceLeaf, plugin: KanbanPlusPlugin, initialKind: ViewKind) {
    super(leaf);
    this.plugin = plugin;
    this.kind = initialKind;
  }

  getViewType(): string {
    return VIEW_TYPE_KANBAN_PLUS;
  }

  getDisplayText(): string {
    return `Marvis — ${labelFor(this.kind)}`;
  }

  getIcon(): string {
    return iconFor(this.kind);
  }

  async setState(state: unknown, result: ViewStateResult): Promise<void> {
    const s = state as Partial<PlannerViewState> | null;
    if (s && (s.kind === "kanban" || s.kind === "timeline" || s.kind === "calendar" || s.kind === "table")) {
      this.kind = s.kind;
    }
    await super.setState(state, result);
    this.render();
  }

  getState(): Record<string, unknown> {
    return { kind: this.kind };
  }

  async onOpen(): Promise<void> {
    this.containerEl.children[1].empty();
    this.containerEl.children[1].addClass("kp-host");
    const mount = this.containerEl.children[1].createDiv({ cls: "kp-mount" });
    this.root = createRoot(mount);
    this.render();
    this.plugin.registerOpenView(this);
    // Re-render when the assistant leaf opens or closes so the toolbar's
    // assistant button reflects the current state without manual refresh.
    this.registerEvent(this.app.workspace.on("layout-change", () => this.render()));
  }

  async onClose(): Promise<void> {
    this.plugin.unregisterOpenView(this);
    this.root?.unmount();
    this.root = null;
  }

  refresh(): void {
    this.render();
  }

  switchKind(kind: ViewKind): void {
    this.kind = kind;
    this.leaf.setViewState({ type: VIEW_TYPE_KANBAN_PLUS, state: { kind } });
    this.render();
    this.app.workspace.requestSaveLayout();
  }

  private openQuickCreate = (defaults?: QuickCreateDefaults) => {
    new QuickCreateModal(
      this.app,
      this.plugin.taskService,
      this.plugin.projectService,
      this.plugin.settings,
      defaults ?? {}
    ).open();
  };

  private openCreateMenu = () => {
    new CreateMenuModal(this.app, this.plugin).open();
  };

  private toggleAssistant = () => {
    void this.plugin.toggleAssistantLeaf();
  };

  private render(): void {
    if (!this.root) return;
    const ctx = {
      app: this.app,
      store: this.plugin.store,
      taskService: this.plugin.taskService,
      projectService: this.plugin.projectService,
      milestoneService: this.plugin.milestoneService,
      logService: this.plugin.logService,
      eventService: this.plugin.eventService,
      calendarSyncEngine: this.plugin.calendarSyncEngine,
      assistantSession: this.plugin.assistantSession,
      settings: this.plugin.settings,
      savePluginSettings: () => this.plugin.saveSettings(),
      switchView: (kind: ViewKind) => this.switchKind(kind),
      openQuickCreate: this.openQuickCreate,
      openCreateMenu: this.openCreateMenu,
      toggleAssistant: this.toggleAssistant,
      isAssistantOpen: this.plugin.isAssistantLeafOpen(),
    };
    this.root.render(
      <PluginContext.Provider value={ctx}>
        {renderRoot(this.kind)}
      </PluginContext.Provider>
    );
  }
}

function renderRoot(kind: ViewKind): React.ReactNode {
  switch (kind) {
    case "kanban":
      return <KanbanRoot />;
    case "timeline":
      return <TimelineRoot />;
    case "calendar":
      return <CalendarRoot />;
    case "table":
      return <TableRoot />;
  }
}

function labelFor(kind: ViewKind): string {
  if (kind === "kanban") return "Kanban";
  if (kind === "timeline") return "Timeline";
  if (kind === "calendar") return "Calendar";
  return "Table";
}

function iconFor(kind: ViewKind): string {
  if (kind === "kanban") return "kanban-square";
  if (kind === "timeline") return "gantt-chart";
  if (kind === "calendar") return "calendar-days";
  return "table";
}
