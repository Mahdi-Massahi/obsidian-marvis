import { ItemView, WorkspaceLeaf } from "obsidian";
import * as React from "react";
import { createRoot, Root } from "react-dom/client";
import type KanbanPlusPlugin from "../main";
import { PluginContext, PluginContextValue } from "./context";
import { AssistantPanel } from "./AssistantPanel";

export const VIEW_TYPE_MARVIS_ASSISTANT = "marvis-assistant";

export class AssistantView extends ItemView {
  private plugin: KanbanPlusPlugin;
  private root: Root | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: KanbanPlusPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return VIEW_TYPE_MARVIS_ASSISTANT;
  }

  getDisplayText(): string {
    return "Marvis assistant";
  }

  getIcon(): string {
    return "sparkles";
  }

  async onOpen(): Promise<void> {
    this.containerEl.children[1].empty();
    this.containerEl.children[1].addClass("kp-host");
    const mount = this.containerEl.children[1].createDiv({ cls: "kp-mount" });
    this.root = createRoot(mount);
    this.render();
  }

  async onClose(): Promise<void> {
    this.root?.unmount();
    this.root = null;
    void this.plugin.assistantSession.stop();
    this.plugin.refreshViews();
  }

  private render(): void {
    if (!this.root) return;
    const ctx: PluginContextValue = {
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
      switchView: () => {},
      openQuickCreate: () => {},
      openCreateMenu: () => {},
      toggleAssistant: () => this.leaf.detach(),
      isAssistantOpen: true,
    };
    this.root.render(
      <PluginContext.Provider value={ctx}>
        <AssistantPanel
          session={this.plugin.assistantSession}
          onClose={() => this.leaf.detach()}
        />
      </PluginContext.Provider>
    );
  }
}
