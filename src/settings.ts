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
import { testGeminiConnection } from "./services/assistant/assistantSession";
import { CalendarSyncResultModal } from "./views/shared/CalendarSyncResultModal";

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

export type AssistantVoice = "Aoede" | "Charon" | "Fenrir" | "Kore" | "Puck";

export interface AssistantSettings {
  enabled: boolean;
  apiKey: string;
  model: string;
  voice: AssistantVoice;
  systemInstructionOverride?: string;
  showTimer: boolean;
  persistTranscripts: boolean;
  userName: string;
}

export interface ViewStateSettings {
  kanbanGroupBy: "status" | "priority" | "milestone";
  calendarMode: "month" | "week" | "day";
  timelineZoom: "day" | "week" | "month";
  timelineGroupBy: "project" | "milestone";
  tableTab: "tasks" | "projects" | "milestones" | "events" | "logs";
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
  marvisSkillTemplate: string;
  nextCode: { task: number; log: number; milestone: number; project: number; event: number };
  calendarSync: CalendarSyncSettings;
  assistant: AssistantSettings;
  viewState: ViewStateSettings;
}

export const DEFAULT_VIEW_STATE: ViewStateSettings = {
  kanbanGroupBy: "status",
  calendarMode: "month",
  timelineZoom: "week",
  timelineGroupBy: "project",
  tableTab: "tasks",
};

export const DEFAULT_ASSISTANT_SETTINGS: AssistantSettings = {
  enabled: false,
  apiKey: "",
  model: "gemini-3.1-flash-live-preview",
  voice: "Kore",
  showTimer: true,
  persistTranscripts: true,
  userName: "",
};

export const DEFAULT_SETTINGS: KanbanPlusSettings = {
  rootFolder: "Marvis",
  statuses: DEFAULT_STATUSES,
  priorities: DEFAULT_PRIORITIES,
  defaultView: "kanban",
  defaultKanbanGroupBy: "status",
  weekStartsOn: 1,
  showArchivedByDefault: false,
  filterPresets: [],
  openIn: "sidebar",
  marvisSkillTemplate: DEFAULT_MARVIS_SKILL,
  nextCode: { task: 1, log: 1, milestone: 1, project: 1, event: 1 },
  calendarSync: {
    macos: { availableCalendars: [], selectedCalendars: [] },
  },
  assistant: DEFAULT_ASSISTANT_SETTINGS,
  viewState: DEFAULT_VIEW_STATE,
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
    ;

    new Setting(containerEl)
      .setName("Marvis root folder")
      .setDesc("All projects, milestones and tasks live under this folder.")
      .addText((text) =>
        text
          .setPlaceholder("Marvis")
          .setValue(this.plugin.settings.rootFolder)
          .onChange(async (value) => {
            this.plugin.settings.rootFolder = value.trim() || "Marvis";
            await this.plugin.saveSettings();
            void this.plugin.indexer?.reindex();
          })
      );

    new Setting(containerEl)
      .setName("Default view")
      .setDesc("Which view opens first when you launch marvis.")
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
      .setName("Default kanban grouping")
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
            this.plugin.settings.weekStartsOn = (value === "0" ? 0 : 1);
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

    this.renderCalendarSync(containerEl);

    this.renderAssistant(containerEl);

    new Setting(containerEl).setName("Coding-agent skills").setHeading();
    containerEl.createEl("p", {
      cls: "setting-item-description",
      text:
        "Each project gets a skills/marvis.md scaffolded from this template. " +
        "Edit it once here; new projects pick it up automatically. " +
        "Use the commands to retrofit existing projects.",
    });
    new Setting(containerEl)
      .setName("Per-project skill template")
      .addTextArea((t) => {
        t.setValue(this.plugin.settings.marvisSkillTemplate).onChange(async (v) => {
          this.plugin.settings.marvisSkillTemplate = v;
          await this.plugin.saveSettings();
        });
        t.inputEl.rows = 16;
        t.inputEl.addClass("kp-settings__code-textarea");
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

    new Setting(containerEl).setName("Statuses").setHeading();
    this.renderVocabulary(
      containerEl,
      this.plugin.settings.statuses,
      (next) => {
        this.plugin.settings.statuses = next;
      },
      () =>
        ({ id: "new-status", label: "New status", color: "#94a3b8", category: "open" as const })
    );

    new Setting(containerEl).setName("Priorities").setHeading();
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
    new Setting(container).setName("Calendar sync").setHeading();
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
    new Setting(container).setName("").setHeading();

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
          "Connect to read events from calendar.app. macOS will ask for permission once."
        )
        .addButton((b) =>
          b
            .setCta()
            .setButtonText("Connect apple calendar")
            .onClick(async () => {
              try {
                await engine.connect(provider, {});
                new Notice("Apple calendar connected.");
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
        "Reads events from any account configured in Calendar.app — iCloud, Google, Exchange, and so on."
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
        text: "No calendars loaded yet — click 'refresh calendar list'.",
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
              new CalendarSyncResultModal(this.app, "Calendar sync", r).open();
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
              new CalendarSyncResultModal(this.app, cal.displayName, r).open();
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

  private renderAssistant(container: HTMLElement): void {
    new Setting(container).setName("AI assistant").setHeading();
    container.createEl("p", {
      cls: "setting-item-description",
      text:
        "Voice-first conversational assistant. Audio leaves your device and is sent " +
        "to Google's Gemini Live API. Every change to your vault is gated by a " +
        "confirmation modal.",
    });

    const a = this.plugin.settings.assistant;

    new Setting(container)
      .setName("Enable assistant")
      .setDesc("Show the mic button in the marvis toolbar.")
      .addToggle((tog) =>
        tog.setValue(a.enabled).onChange(async (v) => {
          a.enabled = v;
          await this.plugin.saveSettings();
          this.plugin.refreshViews();
        })
      );

    new Setting(container)
      .setName("Gemini API key")
      .setDesc("Your own API key. Stored locally with the rest of your plugin settings.")
      .addText((t) => {
        t.inputEl.type = "password";
        t.setPlaceholder("Aiza…")
          .setValue(a.apiKey)
          .onChange(async (v) => {
            a.apiKey = v.trim();
            await this.plugin.saveSettings();
          });
      });

    new Setting(container)
      .setName("Your name")
      .setDesc("How marvis should address you. Injected into the system prompt.")
      .addText((t) =>
        t
          .setPlaceholder("E.g. Mahdi")
          .setValue(a.userName)
          .onChange(async (v) => {
            a.userName = v.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(container)
      .setName("Model")
      .addDropdown((dd) => {
        dd
          .addOption("gemini-3.1-flash-live-preview", "Gemini-3.1-flash-live-preview")
          .addOption(
            "gemini-2.5-flash-preview-native-audio-dialog",
            "Gemini-2.5-flash-preview-native-audio-dialog"
          )
          .addOption("gemini-2.0-flash-exp", "Gemini-2.0-flash-exp")
          .setValue(a.model)
          .onChange(async (v) => {
            a.model = v;
            await this.plugin.saveSettings();
          });
      });

    new Setting(container)
      .setName("Voice")
      .addDropdown((dd) => {
        for (const v of ["Aoede", "Charon", "Fenrir", "Kore", "Puck"] as const) {
          dd.addOption(v, v);
        }
        dd.setValue(a.voice).onChange(async (v) => {
          a.voice = v as typeof a.voice;
          await this.plugin.saveSettings();
        });
      });

    new Setting(container)
      .setName("Persist transcripts")
      .setDesc("Save each session as Marvis/_chats/<datetime>.md.")
      .addToggle((tog) =>
        tog.setValue(a.persistTranscripts).onChange(async (v) => {
          a.persistTranscripts = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(container)
      .setName("Show session timer")
      .setDesc("Gemini live caps audio sessions at 15 minutes.")
      .addToggle((tog) =>
        tog.setValue(a.showTimer).onChange(async (v) => {
          a.showTimer = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(container)
      .setName("System instruction (override)")
      .setDesc(
        "Leave blank to use the bundled marvis prompt. Custom prompts are appended to the model setup."
      )
      .addTextArea((t) => {
        t.setValue(a.systemInstructionOverride ?? "").onChange(async (v) => {
          a.systemInstructionOverride = v.trim() ? v : undefined;
          await this.plugin.saveSettings();
        });
        t.inputEl.rows = 4;
        t.inputEl.addClass("kp-settings__code-textarea");
      });

    new Setting(container).addButton((b) =>
      b.setButtonText("Test connection").onClick(async () => {
        if (!a.apiKey.trim()) {
          new Notice("Set an API key first.");
          return;
        }
        b.setButtonText("Testing…").setDisabled(true);
        try {
          await testGeminiConnection({
            apiKey: a.apiKey,
            model: a.model,
            voice: a.voice,
          });
          new Notice("Connection verified. ✔");
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          new Notice(`Test failed: ${msg}`);
        } finally {
          b.setButtonText("Test connection").setDisabled(false);
        }
      })
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
