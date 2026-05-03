import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import type KanbanPlusPlugin from "./main";
import {
  DEFAULT_PRIORITIES,
  DEFAULT_STATUSES,
  PriorityDef,
  StatusDef,
  ViewKind,
  FilterPreset,
} from "./schema/types";
import { DEFAULT_MARVIS_SKILL } from "./skills/defaultTemplate";
import {
  CalendarProvider,
  RemoteCalendar,
  TokenSet,
} from "./services/calendar/types";
import { macCalendarProvider } from "./services/calendar/macCalendarProvider";

export interface CalendarProviderSettings {
  token?: TokenSet;
  availableCalendars: RemoteCalendar[];
  selectedCalendars: SelectedCalendar[];
}

export interface SelectedCalendar {
  id: string;
  displayName: string;
  projectName: string;
  lastSyncedAt?: number;
  lastResult?: { created: number; updated: number; archived: number; failed: number };
}

export interface CalendarSyncSettings {
  macos: CalendarProviderSettings;
}

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
  telegramToken: string;
  telegramInboxProject: string;
  telegramChatId: string;
  telegramOffset: number;
  marvisSkillTemplate: string;
  nextCode: { task: number; log: number; milestone: number; project: number; event: number };
  calendarSync: CalendarSyncSettings;
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
  telegramToken: "",
  telegramInboxProject: "_project",
  telegramChatId: "",
  telegramOffset: 0,
  marvisSkillTemplate: DEFAULT_MARVIS_SKILL,
  nextCode: { task: 1, log: 1, milestone: 1, project: 1, event: 1 },
  calendarSync: {
    macos: { availableCalendars: [], selectedCalendars: [] },
  },
};

function sanitizeProjectName(name: string): string {
  return name.replace(/[\\/:*?"<>|#^[\]]/g, "").trim().slice(0, 60) || "Calendar";
}

function humanAgo(ms: number): string {
  const diff = Math.max(0, Date.now() - ms);
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export class KanbanPlusSettingTab extends PluginSettingTab {
  plugin: KanbanPlusPlugin;

  constructor(app: App, plugin: KanbanPlusPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Marvis settings" });

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
      .setDesc("Which view opens first when you launch Marvis.")
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

    containerEl.createEl("h3", { text: "Telegram ingest" });
    new Setting(containerEl)
      .setName("Bot token")
      .setDesc("BotFather token. Stored locally in plugin settings.")
      .addText((t) => {
        t.inputEl.type = "password";
        t.setPlaceholder("123456:ABC…")
          .setValue(this.plugin.settings.telegramToken)
          .onChange(async (v) => {
            this.plugin.settings.telegramToken = v.trim();
            await this.plugin.saveSettings();
          });
      });
    new Setting(containerEl)
      .setName("Chat ID")
      .setDesc(
        "Only messages from this chat are ingested. Leave empty to accept all chats. Negative for groups/channels (e.g. -1001234567890). Use 'Show recent Telegram chats' to discover."
      )
      .addText((t) =>
        t
          .setPlaceholder("123456789")
          .setValue(this.plugin.settings.telegramChatId)
          .onChange(async (v) => {
            this.plugin.settings.telegramChatId = v.trim();
            await this.plugin.saveSettings();
          })
      );
    new Setting(containerEl)
      .setName("Inbox project")
      .setDesc(
        "Project name whose logs/ folder receives pulled messages. Auto-created if missing."
      )
      .addText((t) =>
        t
          .setPlaceholder("_project")
          .setValue(this.plugin.settings.telegramInboxProject)
          .onChange(async (v) => {
            this.plugin.settings.telegramInboxProject = v.trim() || "_project";
            await this.plugin.saveSettings();
          })
      );
    new Setting(containerEl)
      .setName("Last update offset")
      .setDesc(
        `Stored update_id offset (currently ${this.plugin.settings.telegramOffset}). Reset to re-pull history.`
      )
      .addButton((b) =>
        b.setButtonText("Reset offset").onClick(async () => {
          this.plugin.settings.telegramOffset = 0;
          await this.plugin.saveSettings();
          this.display();
        })
      );

    this.renderCalendarSync(containerEl);

    containerEl.createEl("h3", { text: "Coding-agent skills" });
    containerEl.createEl("p", {
      cls: "setting-item-description",
      text:
        "Each project gets a skills/marvis.md scaffolded from this template. " +
        "Edit it once here; new projects pick it up automatically. " +
        "Use the commands to retrofit existing projects.",
    });
    new Setting(containerEl)
      .setName("marvis.md template")
      .addTextArea((t) => {
        t.setValue(this.plugin.settings.marvisSkillTemplate).onChange(async (v) => {
          this.plugin.settings.marvisSkillTemplate = v;
          await this.plugin.saveSettings();
        });
        t.inputEl.rows = 16;
        t.inputEl.style.width = "100%";
        t.inputEl.style.fontFamily = "var(--font-monospace)";
        t.inputEl.style.fontSize = "12px";
      });
    new Setting(containerEl)
      .addButton((b) =>
        b.setButtonText("Reset to default").onClick(async () => {
          this.plugin.settings.marvisSkillTemplate = DEFAULT_MARVIS_SKILL;
          await this.plugin.saveSettings();
          this.display();
        })
      )
      .addButton((b) =>
        b.setButtonText("Apply to all projects").onClick(async () => {
          const r = await this.plugin.projectService.applySkillTemplateToAll();
          new Notice(
            `Skills: ${r.created} created, ${r.skipped} already had one`
          );
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

  private renderCalendarSync(container: HTMLElement): void {
    container.createEl("h3", { text: "Calendar sync" });
    container.createEl("p", {
      cls: "setting-item-description",
      text:
        "Pull events from external calendars into Marvis as event files. " +
        "One-way (read-only). Synced events are tagged #external and linked " +
        "back via extId / source frontmatter.",
    });
    this.renderProviderSection(container, macCalendarProvider);
  }

  private renderProviderSection(
    container: HTMLElement,
    provider: CalendarProvider
  ): void {
    container.createEl("h4", { text: provider.label });

    if (!provider.isAvailable()) {
      container.createEl("p", {
        cls: "setting-item-description",
        text:
          "Apple Calendar is only available on the macOS desktop app. " +
          "It reads from any account configured in System Settings → Internet Accounts " +
          "(Exchange, iCloud, Google, etc.).",
      });
      return;
    }

    const block = this.plugin.settings.calendarSync.macos;
    const token = block.token;
    const engine = this.plugin.calendarSyncEngine;

    if (!token) {
      new Setting(container)
        .setName("Not connected")
        .setDesc(
          "Connect to read events from Calendar.app. macOS will ask for permission once."
        )
        .addButton((b) =>
          b
            .setCta()
            .setButtonText("Connect Apple Calendar")
            .onClick(async () => {
              try {
                await engine.connect(provider, {});
                new Notice("Apple Calendar connected.");
              } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                new Notice(`Connect failed: ${msg}`);
              }
              this.display();
            })
        );
      return;
    }

    new Setting(container)
      .setName("Connected")
      .setDesc(
        "Reading from any account Calendar.app knows about (Exchange, iCloud, Google, etc.)."
      )
      .addButton((b) =>
        b.setButtonText("Refresh calendar list").onClick(async () => {
          try {
            await engine.refreshCalendars(provider);
            new Notice("Calendar list refreshed.");
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            new Notice(`Refresh failed: ${msg}`);
          }
          this.display();
        })
      )
      .addButton((b) =>
        b
          .setWarning()
          .setButtonText("Disconnect")
          .onClick(async () => {
            await engine.disconnect(provider);
            this.display();
          })
      );

    if (block.availableCalendars.length === 0) {
      container.createEl("p", {
        cls: "setting-item-description",
        text: "No calendars loaded yet — click 'Refresh calendar list'.",
      });
    } else {
      for (const cal of block.availableCalendars) {
        this.renderCalendarRow(container, provider, cal);
      }
      new Setting(container).addButton((b) =>
        b
          .setCta()
          .setButtonText("Sync all selected")
          .onClick(async () => {
            try {
              const r = await engine.syncAllSelected(provider);
              new Notice(
                `Sync: +${r.created} ~${r.updated} ⌫${r.archived}` +
                  (r.failed ? ` · ${r.failed} failed` : "")
              );
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              new Notice(`Sync failed: ${msg}`);
            }
            this.display();
          })
      );
    }
  }

  private renderCalendarRow(
    container: HTMLElement,
    provider: CalendarProvider,
    cal: RemoteCalendar
  ): void {
    const block = this.plugin.settings.calendarSync.macos;
    const selected = block.selectedCalendars.find((c) => c.id === cal.id);
    const projects = Object.values(this.plugin.store.getState().projects).map(
      (p) => p.name
    );
    const defaultProject = selected?.projectName ?? sanitizeProjectName(cal.displayName);
    const setting = new Setting(container).setName(cal.displayName);

    // Color swatch + account email render in the name area, before the title
    // we already set, so duplicates are easy to tell apart at a glance.
    if (cal.color) {
      const swatch = createSpan({ cls: "kp-cal-swatch" });
      swatch.style.background = cal.color;
      setting.nameEl.prepend(swatch);
    }

    let descParts: string[] = [];
    if (cal.account) descParts.push(cal.account);
    if (cal.isPrimary) descParts.push("primary");
    if (selected?.lastSyncedAt) {
      const ago = humanAgo(selected.lastSyncedAt);
      const r = selected.lastResult;
      const summary = r
        ? `last sync ${ago} · +${r.created} ~${r.updated} ⌫${r.archived}` +
          (r.failed ? ` · ${r.failed} failed` : "")
        : `last sync ${ago}`;
      descParts.push(summary);
    }
    if (descParts.length) setting.setDesc(descParts.join(" · "));

    setting.addToggle((tog) =>
      tog.setValue(!!selected).onChange(async (v) => {
        if (v && !selected) {
          block.selectedCalendars.push({
            id: cal.id,
            displayName: cal.displayName,
            projectName: defaultProject,
          });
        } else if (!v && selected) {
          block.selectedCalendars = block.selectedCalendars.filter(
            (c) => c.id !== cal.id
          );
        }
        await this.plugin.saveSettings();
        this.display();
      })
    );

    if (selected) {
      setting.addText((t) =>
        t
          .setPlaceholder("Project")
          .setValue(selected.projectName)
          .onChange(async (v) => {
            const trimmed = v.trim();
            if (!trimmed) return;
            selected.projectName = trimmed;
            await this.plugin.saveSettings();
          })
      );
      const _projects = projects;
      setting.addExtraButton((b) =>
        b
          .setIcon("refresh-ccw")
          .setTooltip("Sync this calendar")
          .onClick(async () => {
            try {
              const r = await this.plugin.calendarSyncEngine.syncCalendar(
                provider,
                cal.id
              );
              new Notice(
                `${cal.displayName}: +${r.created} ~${r.updated} ⌫${r.archived}` +
                  (r.failed ? ` · ${r.failed} failed` : "")
              );
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              new Notice(`Sync failed: ${msg}`);
            }
            this.display();
          })
      );
      void _projects;
    }
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
