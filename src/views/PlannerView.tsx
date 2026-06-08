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
import { HabitsRoot } from "./Habits";
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
  // Tracks the last-rendered assistant-leaf state so we can skip layout-change
  // renders that don't actually affect the toolbar. Layout-change fires on tab
  // focus, sidebar resize, leaf moves — re-rendering the whole React tree on
  // every one of those was the worst hit on top of debouncing.
  private lastAssistantOpen: boolean | null = null;

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
    if (
      s &&
      (s.kind === "kanban" ||
        s.kind === "timeline" ||
        s.kind === "calendar" ||
        s.kind === "table" ||
        s.kind === "habits")
    ) {
      this.kind = s.kind;
    }
    await super.setState(state, result);
    this.render();
  }

  getState(): Record<string, unknown> {
    return { kind: this.kind };
  }

  onOpen(): Promise<void> {
    this.containerEl.children[1].empty();
    this.containerEl.children[1].addClass("kp-host");
    const mount = this.containerEl.children[1].createDiv({ cls: "kp-mount" });
    this.root = createRoot(mount);
    this.render();
    this.plugin.registerOpenView(this);
    // Re-render when the assistant leaf opens or closes so the toolbar's
    // assistant button reflects the current state without manual refresh.
    // Skip layout-change events that don't change the assistant state — they
    // otherwise re-render the whole React tree on every tab focus/leaf move.
    this.registerEvent(
      this.app.workspace.on("layout-change", () => {
        const open = this.plugin.isAssistantLeafOpen();
        if (open === this.lastAssistantOpen) return;
        this.render();
      })
    );
    return Promise.resolve();
  }

  onClose(): Promise<void> {
    this.plugin.unregisterOpenView(this);
    this.root?.unmount();
    this.root = null;
    return Promise.resolve();
  }

  refresh(): void {
    this.render();
  }

  switchKind(kind: ViewKind): void {
    this.kind = kind;
    void this.leaf.setViewState({ type: VIEW_TYPE_KANBAN_PLUS, state: { kind } });
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
    const isAssistantOpen = this.plugin.isAssistantLeafOpen();
    this.lastAssistantOpen = isAssistantOpen;
    const ctx = {
      app: this.app,
      store: this.plugin.store,
      taskService: this.plugin.taskService,
      projectService: this.plugin.projectService,
      milestoneService: this.plugin.milestoneService,
      logService: this.plugin.logService,
      eventService: this.plugin.eventService,
      habitService: this.plugin.habitService,
      calendarSyncEngine: this.plugin.calendarSyncEngine,
      assistantSession: this.plugin.assistantSession,
      settings: this.plugin.settings,
      savePluginSettings: () => this.plugin.saveSettings(),
      switchView: (kind: ViewKind) => this.switchKind(kind),
      openQuickCreate: this.openQuickCreate,
      openCreateMenu: this.openCreateMenu,
      toggleAssistant: this.toggleAssistant,
      isAssistantOpen,
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
    case "habits":
      return <HabitsRoot />;
  }
}

function labelFor(kind: ViewKind): string {
  if (kind === "kanban") return "Kanban";
  if (kind === "timeline") return "Timeline";
  if (kind === "calendar") return "Calendar";
  if (kind === "habits") return "Habits";
  return "Table";
}

function iconFor(kind: ViewKind): string {
  if (kind === "kanban") return "kanban-square";
  if (kind === "timeline") return "gantt-chart";
  if (kind === "calendar") return "calendar-days";
  if (kind === "habits") return "repeat";
  return "table";
}
