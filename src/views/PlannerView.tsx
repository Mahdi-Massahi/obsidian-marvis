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

export const VIEW_TYPE_KANBAN_PLUS = "kanban-plus-view";

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
    return `Kanban+ — ${labelFor(this.kind)}`;
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

  private render(): void {
    if (!this.root) return;
    const ctx = {
      app: this.app,
      store: this.plugin.store,
      taskService: this.plugin.taskService,
      projectService: this.plugin.projectService,
      milestoneService: this.plugin.milestoneService,
      logService: this.plugin.logService,
      settings: this.plugin.settings,
      switchView: (kind: ViewKind) => this.switchKind(kind),
      openQuickCreate: this.openQuickCreate,
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
