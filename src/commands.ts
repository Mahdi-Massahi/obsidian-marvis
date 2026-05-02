import { Modal, Notice, Setting, App } from "obsidian";
import type KanbanPlusPlugin from "./main";
import { QuickCreateModal } from "./views/shared/QuickCreateModal";
import { listProjectFolders } from "./services/taskService";
import type { PullProgress } from "./services/telegramService";
import { ConfirmModal } from "./views/shared/ConfirmModal";

export function registerCommands(plugin: KanbanPlusPlugin): void {
  plugin.addCommand({
    id: "open-kanban",
    name: "Open Kanban",
    callback: () => plugin.activateView("kanban"),
  });
  plugin.addCommand({
    id: "open-timeline",
    name: "Open Timeline",
    callback: () => plugin.activateView("timeline"),
  });
  plugin.addCommand({
    id: "open-calendar",
    name: "Open Calendar",
    callback: () => plugin.activateView("calendar"),
  });
  plugin.addCommand({
    id: "open-table",
    name: "Open Table",
    callback: () => plugin.activateView("table"),
  });

  plugin.addCommand({
    id: "quick-create-task",
    name: "Quick-create task",
    callback: () => {
      new QuickCreateModal(
        plugin.app,
        plugin.taskService,
        plugin.projectService,
        plugin.settings
      ).open();
    },
  });

  plugin.addCommand({
    id: "create-project",
    name: "Create project",
    callback: () => {
      new TextPromptModal(plugin.app, "New project", "Project name", async (name) => {
        try {
          await plugin.projectService.createProject(name);
          new Notice(`Project ${name} ready`);
        } catch (e) {
          console.error(e);
          new Notice("Failed to create project — see console");
        }
      }).open();
    },
  });

  plugin.addCommand({
    id: "quick-log",
    name: "Quick log",
    callback: () => {
      const projects = listProjectFolders(plugin.app, plugin.settings.rootFolder);
      if (projects.length === 0) {
        new Notice("Create a project first.");
        return;
      }
      new QuickLogModal(plugin.app, projects, async (project, body, tags) => {
        try {
          await plugin.logService.createLog(project, {
            body: body || undefined,
            tags: tags.length ? tags : undefined,
          });
          new Notice(`Log added to ${project}`);
        } catch (e) {
          console.error(e);
          new Notice("Failed to create log — see console");
        }
      }).open();
    },
  });

  plugin.addCommand({
    id: "show-telegram-chats",
    name: "Show recent Telegram chats",
    callback: async () => {
      try {
        const chats = await plugin.telegramService.discoverChats();
        if (chats.length === 0) {
          new Notice(
            "No recent Telegram chats. Send a message to the bot first, then run this again."
          );
          return;
        }
        const lines = chats.map((c) => `${c.title}: ${c.id}`).join("\n");
        new Notice(`Telegram chats:\n${lines}`, 15000);
        console.log("[marvis] Telegram chats:\n" + lines);
      } catch (e) {
        console.error(e);
        new Notice(
          e instanceof Error ? `Telegram error: ${e.message}` : "Telegram error"
        );
      }
    },
  });

  plugin.addCommand({
    id: "pull-telegram-logs",
    name: "Pull Telegram logs",
    callback: async () => {
      const modal = new TelegramProgressModal(plugin.app);
      modal.open();
      try {
        const r = await plugin.telegramService.pull((p) => modal.update(p));
        modal.finish(r);
      } catch (e) {
        console.error(e);
        modal.fail(e instanceof Error ? e.message : "Pull failed");
      }
    },
  });

  plugin.addCommand({
    id: "apply-skill-template-all",
    name: "Apply skill template to all projects",
    callback: async () => {
      try {
        const r = await plugin.projectService.applySkillTemplateToAll();
        new Notice(`Skills: ${r.created} created, ${r.skipped} already had one`);
      } catch (e) {
        console.error(e);
        new Notice("Failed to apply skill template — see console");
      }
    },
  });

  plugin.addCommand({
    id: "reset-skill-for-project",
    name: "Reset skill template for project…",
    callback: () => {
      const projects = listProjectFolders(plugin.app, plugin.settings.rootFolder);
      if (projects.length === 0) {
        new Notice("No projects found.");
        return;
      }
      new SkillResetModal(plugin.app, projects, async (project) => {
        try {
          const r = await plugin.projectService.writeSkillFile(
            project,
            "marvis",
            plugin.settings.marvisSkillTemplate,
            true
          );
          new Notice(`Reset ${r.path}`);
        } catch (e) {
          console.error(e);
          new Notice("Failed to reset skill — see console");
        }
      }).open();
    },
  });

  plugin.addCommand({
    id: "backfill-codes",
    name: "Backfill IDs (T-/L-/M-/P-)",
    callback: async () => {
      try {
        const r = await backfillCodes(plugin);
        new Notice(
          `IDs assigned — tasks: ${r.task}, logs: ${r.log}, milestones: ${r.milestone}, projects: ${r.project}`
        );
      } catch (e) {
        console.error(e);
        new Notice("Backfill failed — see console");
      }
    },
  });

  plugin.addCommand({
    id: "delete-active-task",
    name: "Delete task",
    checkCallback: (checking) => {
      const file = plugin.app.workspace.getActiveFile();
      if (!file) return false;
      const fm = plugin.app.metadataCache.getFileCache(file)?.frontmatter ?? null;
      if (!fm || fm["kind"] !== "task") return false;
      if (checking) return true;
      const taskPath = file.path;
      const task = plugin.store.getState().tasks[taskPath];
      const title =
        (typeof fm["title"] === "string" && fm["title"]) ||
        task?.title ||
        file.basename;
      new ConfirmModal(
        plugin.app,
        "Delete task",
        `Permanently delete "${title}"? This moves the file to the system or vault trash.`,
        async () => {
          try {
            if (task) {
              await plugin.taskService.deleteTask(task);
            } else {
              await plugin.app.fileManager.trashFile(file);
            }
            new Notice(`Deleted "${title}"`);
          } catch (e) {
            console.error(e);
            new Notice("Failed to delete task — see console");
          }
        }
      ).open();
      return true;
    },
  });

  plugin.addCommand({
    id: "create-milestone",
    name: "Create milestone",
    callback: () => {
      const projects = listProjectFolders(plugin.app, plugin.settings.rootFolder);
      if (projects.length === 0) {
        new Notice("Create a project first.");
        return;
      }
      new MilestonePromptModal(plugin.app, projects, async (project, name) => {
        try {
          await plugin.milestoneService.createMilestone(project, name);
          new Notice(`Milestone ${name} added to ${project}`);
        } catch (e) {
          console.error(e);
          new Notice("Failed to create milestone — see console");
        }
      }).open();
    },
  });
}

class TextPromptModal extends Modal {
  private title: string;
  private label: string;
  private onSubmit: (value: string) => void;
  private value = "";

  constructor(app: App, title: string, label: string, onSubmit: (value: string) => void) {
    super(app);
    this.title = title;
    this.label = label;
    this.onSubmit = onSubmit;
  }

  onOpen(): void {
    this.contentEl.createEl("h2", { text: this.title });
    new Setting(this.contentEl).setName(this.label).addText((t) => {
      t.onChange((v) => (this.value = v));
      t.inputEl.addEventListener("keydown", (e) => {
        if (e.key === "Enter") this.submit();
      });
      setTimeout(() => t.inputEl.focus(), 0);
    });
    new Setting(this.contentEl)
      .addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()))
      .addButton((b) =>
        b
          .setButtonText("Create")
          .setCta()
          .onClick(() => this.submit())
      );
  }

  private submit(): void {
    const v = this.value.trim();
    if (!v) return;
    this.close();
    this.onSubmit(v);
  }
}

class QuickLogModal extends Modal {
  private projects: string[];
  private onSubmit: (project: string, body: string, tags: string[]) => void;
  private project: string;
  private body = "";
  private tagsInput = "";

  constructor(
    app: App,
    projects: string[],
    onSubmit: (project: string, body: string, tags: string[]) => void
  ) {
    super(app);
    this.projects = projects;
    this.project = projects[0];
    this.onSubmit = onSubmit;
  }

  onOpen(): void {
    this.contentEl.createEl("h2", { text: "Quick log" });
    new Setting(this.contentEl).setName("Project").addDropdown((dd) => {
      for (const p of this.projects) dd.addOption(p, p);
      dd.setValue(this.project);
      dd.onChange((v) => (this.project = v));
    });
    new Setting(this.contentEl).setName("Tags").addText((t) => {
      t.setPlaceholder("comma-separated");
      t.onChange((v) => (this.tagsInput = v));
    });
    new Setting(this.contentEl).setName("Body").addTextArea((t) => {
      t.setPlaceholder("What happened?");
      t.onChange((v) => (this.body = v));
      t.inputEl.rows = 5;
      t.inputEl.style.width = "100%";
      t.inputEl.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) this.submit();
      });
      setTimeout(() => t.inputEl.focus(), 0);
    });
    new Setting(this.contentEl)
      .addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()))
      .addButton((b) =>
        b
          .setButtonText("Save")
          .setCta()
          .onClick(() => this.submit())
      );
  }

  private submit(): void {
    const tags = this.tagsInput
      .split(/[,\s]+/)
      .map((t) => t.replace(/^#/, "").trim())
      .filter((t) => t.length > 0);
    this.close();
    this.onSubmit(this.project, this.body.trim(), tags);
  }
}

class MilestonePromptModal extends Modal {
  private projects: string[];
  private onSubmit: (project: string, name: string) => void;
  private project: string;
  private name = "";

  constructor(app: App, projects: string[], onSubmit: (project: string, name: string) => void) {
    super(app);
    this.projects = projects;
    this.project = projects[0];
    this.onSubmit = onSubmit;
  }

  onOpen(): void {
    this.contentEl.createEl("h2", { text: "New milestone" });
    new Setting(this.contentEl).setName("Project").addDropdown((dd) => {
      for (const p of this.projects) dd.addOption(p, p);
      dd.setValue(this.project);
      dd.onChange((v) => (this.project = v));
    });
    new Setting(this.contentEl).setName("Milestone name").addText((t) => {
      t.onChange((v) => (this.name = v));
      t.inputEl.addEventListener("keydown", (e) => {
        if (e.key === "Enter") this.submit();
      });
      setTimeout(() => t.inputEl.focus(), 0);
    });
    new Setting(this.contentEl)
      .addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()))
      .addButton((b) =>
        b
          .setButtonText("Create")
          .setCta()
          .onClick(() => this.submit())
      );
  }

  private submit(): void {
    const n = this.name.trim();
    if (!n) return;
    this.close();
    this.onSubmit(this.project, n);
  }
}

class TelegramProgressModal extends Modal {
  private titleEl_!: HTMLElement;
  private statusEl!: HTMLElement;
  private barFill!: HTMLElement;
  private countsEl!: HTMLElement;
  private closeBtn!: HTMLButtonElement;
  private saved = 0;
  private skipped = 0;
  private errors = 0;
  private done = false;

  onOpen(): void {
    this.contentEl.addClass("kp-tg-progress");
    this.titleEl_ = this.contentEl.createEl("h2", { text: "Pulling Telegram logs…" });
    this.statusEl = this.contentEl.createEl("div", {
      cls: "kp-tg-progress__status",
      text: "Connecting…",
    });
    const barWrap = this.contentEl.createDiv({ cls: "kp-tg-progress__bar" });
    this.barFill = barWrap.createDiv({ cls: "kp-tg-progress__bar-fill" });
    this.barFill.style.width = "0%";
    this.countsEl = this.contentEl.createDiv({ cls: "kp-tg-progress__counts" });
    this.renderCounts();
    const actions = this.contentEl.createDiv({ cls: "kp-tg-progress__actions" });
    this.closeBtn = actions.createEl("button", { text: "Close", cls: "mod-cta" });
    this.closeBtn.disabled = true;
    this.closeBtn.addEventListener("click", () => this.close());
  }

  update(p: PullProgress): void {
    if (p.phase === "fetching") {
      this.statusEl.setText("Fetching updates from Telegram…");
      this.barFill.style.width = "5%";
    } else if (p.phase === "processing") {
      const pct = p.total === 0 ? 100 : Math.round((p.current / p.total) * 100);
      this.barFill.style.width = `${pct}%`;
      this.statusEl.setText(
        `Processing ${p.current}/${p.total}${p.label ? ` — ${p.label}` : ""}`
      );
    } else if (p.phase === "done") {
      this.saved = p.result.saved;
      this.skipped = p.result.skipped;
      this.errors = p.result.errors;
      this.barFill.style.width = "100%";
      this.statusEl.setText(
        p.result.fetched === 0 ? "No new updates." : "Done."
      );
      this.titleEl_.setText("Telegram pull complete");
      this.done = true;
      this.closeBtn.disabled = false;
    }
    this.renderCounts();
  }

  finish(r: { saved: number; skipped: number; errors: number; fetched: number }): void {
    this.update({ phase: "done", result: r });
  }

  fail(message: string): void {
    this.titleEl_.setText("Telegram pull failed");
    this.statusEl.setText(message);
    this.barFill.style.width = "100%";
    this.barFill.addClass("is-error");
    this.done = true;
    this.closeBtn.disabled = false;
    new Notice(`Telegram: ${message}`);
  }

  private renderCounts(): void {
    this.countsEl.empty();
    const item = (label: string, value: number) => {
      const wrap = this.countsEl.createDiv({ cls: "kp-tg-progress__count" });
      wrap.createSpan({ cls: "kp-tg-progress__count-label", text: label });
      wrap.createSpan({ cls: "kp-tg-progress__count-value", text: String(value) });
    };
    item("saved", this.saved);
    item("skipped", this.skipped);
    item("errors", this.errors);
  }

  onClose(): void {
    if (!this.done) return;
    this.contentEl.empty();
  }
}

class SkillResetModal extends Modal {
  private projects: string[];
  private onSubmit: (project: string) => void;
  private project: string;

  constructor(app: App, projects: string[], onSubmit: (project: string) => void) {
    super(app);
    this.projects = projects;
    this.project = projects[0];
    this.onSubmit = onSubmit;
  }

  onOpen(): void {
    this.contentEl.createEl("h2", { text: "Reset skills/marvis.md" });
    this.contentEl.createEl("p", {
      text:
        "This overwrites the picked project's skills/marvis.md with the current settings template. The existing file is replaced.",
    });
    new Setting(this.contentEl).setName("Project").addDropdown((dd) => {
      for (const p of this.projects) dd.addOption(p, p);
      dd.setValue(this.project);
      dd.onChange((v) => (this.project = v));
    });
    new Setting(this.contentEl)
      .addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()))
      .addButton((b) =>
        b
          .setButtonText("Reset")
          .setWarning()
          .onClick(() => {
            this.close();
            this.onSubmit(this.project);
          })
      );
  }
}

async function backfillCodes(plugin: KanbanPlusPlugin): Promise<{
  task: number;
  log: number;
  milestone: number;
  project: number;
}> {
  const counts = { task: 0, log: 0, milestone: 0, project: 0 };
  const state = plugin.store.getState();
  const groups: Array<{
    kind: "task" | "log" | "milestone" | "project";
    items: { path: string; created?: string; code?: string }[];
  }> = [
    { kind: "project", items: Object.values(state.projects) },
    { kind: "milestone", items: Object.values(state.milestones) },
    { kind: "task", items: Object.values(state.tasks) },
    { kind: "log", items: Object.values(state.logs) },
  ];
  // First pass: bump counters past any existing codes so new allocations don't collide.
  const codeRegex = /^[A-Z]-(\d+)$/;
  for (const { kind, items } of groups) {
    let max = 0;
    for (const it of items) {
      const m = it.code?.match(codeRegex);
      if (m) max = Math.max(max, parseInt(m[1], 10));
    }
    if (max > 0) plugin.bumpCodeCounter(kind, max + 1);
  }
  await plugin.saveSettings();

  // Second pass: assign codes to items missing them, in created-then-path order.
  for (const { kind, items } of groups) {
    const missing = items
      .filter((it) => !it.code)
      .sort((a, b) => {
        const ca = a.created ?? "";
        const cb = b.created ?? "";
        if (ca !== cb) return ca.localeCompare(cb);
        return a.path.localeCompare(b.path);
      });
    for (const it of missing) {
      const code = await plugin.allocateCode(kind);
      const file = plugin.app.vault.getAbstractFileByPath(it.path);
      if (!file || !(file as { extension?: string }).extension) continue;
      try {
        await plugin.app.fileManager.processFrontMatter(
          file as never,
          (fm: Record<string, unknown>) => {
            fm["code"] = code;
          }
        );
        counts[kind] += 1;
      } catch (e) {
        console.warn("Failed to set code on", it.path, e);
      }
    }
  }
  return counts;
}
