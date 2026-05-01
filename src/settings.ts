import { App, PluginSettingTab, Setting } from "obsidian";
import type KanbanPlusPlugin from "./main";
import {
  DEFAULT_PRIORITIES,
  DEFAULT_STATUSES,
  PriorityDef,
  StatusDef,
  ViewKind,
  FilterPreset,
} from "./schema/types";

export interface KanbanPlusSettings {
  rootFolder: string;
  statuses: StatusDef[];
  priorities: PriorityDef[];
  defaultView: ViewKind;
  defaultKanbanGroupBy: "status" | "priority" | "milestone";
  weekStartsOn: 0 | 1;
  showArchivedByDefault: boolean;
  filterPresets: FilterPreset[];
  openIn: "sidebar" | "window" | "tab";
}

export const DEFAULT_SETTINGS: KanbanPlusSettings = {
  rootFolder: "Planner",
  statuses: DEFAULT_STATUSES,
  priorities: DEFAULT_PRIORITIES,
  defaultView: "kanban",
  defaultKanbanGroupBy: "status",
  weekStartsOn: 1,
  showArchivedByDefault: false,
  filterPresets: [],
  openIn: "sidebar",
};

export class KanbanPlusSettingTab extends PluginSettingTab {
  plugin: KanbanPlusPlugin;

  constructor(app: App, plugin: KanbanPlusPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Kanban+ settings" });

    new Setting(containerEl)
      .setName("Planner root folder")
      .setDesc("All projects, milestones and tasks live under this folder.")
      .addText((text) =>
        text
          .setPlaceholder("Planner")
          .setValue(this.plugin.settings.rootFolder)
          .onChange(async (value) => {
            this.plugin.settings.rootFolder = value.trim() || "Planner";
            await this.plugin.saveSettings();
            this.plugin.indexer?.reindex();
          })
      );

    new Setting(containerEl)
      .setName("Default view")
      .setDesc("Which view opens first when you launch Kanban+.")
      .addDropdown((dd) =>
        dd
          .addOption("kanban", "Kanban")
          .addOption("timeline", "Timeline")
          .addOption("calendar", "Calendar")
          .addOption("table", "Table")
          .setValue(this.plugin.settings.defaultView)
          .onChange(async (value) => {
            this.plugin.settings.defaultView = value as ViewKind;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Default Kanban grouping")
      .addDropdown((dd) =>
        dd
          .addOption("status", "Status")
          .addOption("priority", "Priority")
          .addOption("milestone", "Milestone")
          .setValue(this.plugin.settings.defaultKanbanGroupBy)
          .onChange(async (value) => {
            this.plugin.settings.defaultKanbanGroupBy = value as
              | "status"
              | "priority"
              | "milestone";
            await this.plugin.saveSettings();
            this.plugin.refreshViews();
          })
      );

    new Setting(containerEl)
      .setName("Week starts on")
      .addDropdown((dd) =>
        dd
          .addOption("1", "Monday")
          .addOption("0", "Sunday")
          .setValue(String(this.plugin.settings.weekStartsOn))
          .onChange(async (value) => {
            this.plugin.settings.weekStartsOn = (value === "0" ? 0 : 1) as 0 | 1;
            await this.plugin.saveSettings();
            this.plugin.refreshViews();
          })
      );

    new Setting(containerEl)
      .setName("Open task in")
      .setDesc("Where to open a task/project/milestone note when you click it.")
      .addDropdown((dd) =>
        dd
          .addOption("sidebar", "Right sidebar")
          .addOption("tab", "New tab in current pane")
          .addOption("window", "New window")
          .setValue(this.plugin.settings.openIn)
          .onChange(async (value) => {
            this.plugin.settings.openIn = value as KanbanPlusSettings["openIn"];
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Show archived by default")
      .addToggle((tog) =>
        tog.setValue(this.plugin.settings.showArchivedByDefault).onChange(async (v) => {
          this.plugin.settings.showArchivedByDefault = v;
          await this.plugin.saveSettings();
          this.plugin.refreshViews();
        })
      );

    containerEl.createEl("h3", { text: "Statuses" });
    this.renderVocabulary(
      containerEl,
      this.plugin.settings.statuses,
      (next) => {
        this.plugin.settings.statuses = next;
      },
      () =>
        ({ id: "new-status", label: "New status", color: "#94a3b8", category: "open" } as StatusDef)
    );

    containerEl.createEl("h3", { text: "Priorities" });
    this.renderVocabulary(
      containerEl,
      this.plugin.settings.priorities,
      (next) => {
        this.plugin.settings.priorities = next;
      },
      () => ({ id: "new-priority", label: "New priority", color: "#94a3b8", weight: 1 })
    );
  }

  private renderVocabulary<T extends { id: string; label: string; color: string }>(
    container: HTMLElement,
    items: T[],
    set: (next: T[]) => void,
    factory: () => T
  ) {
    const list = container.createDiv({ cls: "kp-vocab-list" });
    items.forEach((item, idx) => {
      const row = new Setting(list).setName(item.label);
      row.addText((t) =>
        t.setValue(item.id).onChange(async (v) => {
          items[idx] = { ...item, id: v };
          set(items.slice());
          await this.plugin.saveSettings();
        })
      );
      row.addText((t) =>
        t.setValue(item.label).onChange(async (v) => {
          items[idx] = { ...item, label: v };
          set(items.slice());
          await this.plugin.saveSettings();
        })
      );
      row.addColorPicker((c) =>
        c.setValue(item.color).onChange(async (v) => {
          items[idx] = { ...item, color: v };
          set(items.slice());
          await this.plugin.saveSettings();
          this.plugin.refreshViews();
        })
      );
      row.addExtraButton((b) =>
        b
          .setIcon("trash")
          .setTooltip("Remove")
          .onClick(async () => {
            const next = items.slice();
            next.splice(idx, 1);
            set(next);
            await this.plugin.saveSettings();
            this.display();
          })
      );
    });
    new Setting(list).addButton((b) =>
      b.setButtonText("Add").onClick(async () => {
        set([...items, factory()]);
        await this.plugin.saveSettings();
        this.display();
      })
    );
  }
}
