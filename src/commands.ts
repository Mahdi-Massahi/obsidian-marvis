import { App, Modal, Notice, Setting } from "obsidian";
import type KanbanPlusPlugin from "./main";
import { QuickCreateModal } from "./views/shared/QuickCreateModal";
import { listProjectFolders } from "./services/taskService";
import { ConfirmModal } from "./views/shared/ConfirmModal";
import type { HabitFrequency } from "./schema/types";
import { HABIT_FREQUENCY_LABEL } from "./schema/types";
import { selectHabitList, selectLogList } from "./index/store";

export function registerCommands(plugin: KanbanPlusPlugin): void {
  plugin.addCommand({
    id: "open-kanban",
    name: "Open kanban",
    callback: () => plugin.activateView("kanban"),
  });
  plugin.addCommand({
    id: "open-timeline",
    name: "Open timeline",
    callback: () => plugin.activateView("timeline"),
  });
  plugin.addCommand({
    id: "open-calendar",
    name: "Open calendar",
    callback: () => plugin.activateView("calendar"),
  });
  plugin.addCommand({
    id: "open-table",
    name: "Open table",
    callback: () => plugin.activateView("table"),
  });
  plugin.addCommand({
    id: "open-habits",
    name: "Open habits",
    callback: () => plugin.activateView("habits"),
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
    name: "Backfill stable codes",
    callback: async () => {
      try {
        const r = await backfillCodes(plugin);
        new Notice(
          `IDs assigned — tasks: ${r.task}, logs: ${r.log}, milestones: ${r.milestone}, projects: ${r.project}, habits: ${r.habit}`
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
    id: "create-habit",
    name: "Create habit",
    callback: () => {
      const projects = listProjectFolders(plugin.app, plugin.settings.rootFolder);
      if (projects.length === 0) {
        new Notice("Create a project first.");
        return;
      }
      new HabitPromptModal(plugin.app, projects, async (project, title, frequency, target, goal) => {
        try {
          await plugin.habitService.createHabit({ project, title, frequency, target, goal });
          new Notice(`Habit ${title} added to ${project}`);
        } catch (e) {
          console.error(e);
          new Notice("Failed to create habit — see console");
        }
      }).open();
    },
  });

  plugin.addCommand({
    id: "log-habit-completion",
    name: "Log habit completion",
    callback: () => {
      const habits = selectHabitList(plugin.store.getState()).filter((h) => !h.archived);
      if (habits.length === 0) {
        new Notice("Create a habit first.");
        return;
      }
      new HabitPickModal(plugin.app, habits.map((h) => ({ path: h.path, title: h.title, project: h.project })), async (path) => {
        const habit = plugin.store.getState().habits[path];
        if (!habit) {
          new Notice("Habit not found.");
          return;
        }
        try {
          const logs = selectLogList(plugin.store.getState());
          await plugin.habitService.logCompletion(habit, logs);
          new Notice(`Marked ${habit.title} done`);
        } catch (e) {
          console.error(e);
          new Notice("Failed to log completion — see console");
        }
      }).open();
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
  private onSubmit: (value: string) => void | Promise<void>;
  private value = "";

  constructor(app: App, title: string, label: string, onSubmit: (value: string) => void | Promise<void>) {
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
      activeWindow.setTimeout(() => t.inputEl.focus(), 0);
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
    void this.onSubmit(v);
  }
}

class QuickLogModal extends Modal {
  private projects: string[];
  private onSubmit: (project: string, body: string, tags: string[]) => void | Promise<void>;
  private project: string;
  private body = "";
  private tagsInput = "";

  constructor(
    app: App,
    projects: string[],
    onSubmit: (project: string, body: string, tags: string[]) => void | Promise<void>
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
      t.setPlaceholder("Comma-separated");
      t.onChange((v) => (this.tagsInput = v));
    });
    new Setting(this.contentEl).setName("Body").addTextArea((t) => {
      t.setPlaceholder("What happened?");
      t.onChange((v) => (this.body = v));
      t.inputEl.rows = 5;
      t.inputEl.addClass("kp-modal__textarea");
      t.inputEl.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) this.submit();
      });
      activeWindow.setTimeout(() => t.inputEl.focus(), 0);
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
    void this.onSubmit(this.project, this.body.trim(), tags);
  }
}

class MilestonePromptModal extends Modal {
  private projects: string[];
  private onSubmit: (project: string, name: string) => void | Promise<void>;
  private project: string;
  private name = "";

  constructor(
    app: App,
    projects: string[],
    onSubmit: (project: string, name: string) => void | Promise<void>
  ) {
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
      activeWindow.setTimeout(() => t.inputEl.focus(), 0);
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
    void this.onSubmit(this.project, n);
  }
}

class SkillResetModal extends Modal {
  private projects: string[];
  private onSubmit: (project: string) => void | Promise<void>;
  private project: string;

  constructor(
    app: App,
    projects: string[],
    onSubmit: (project: string) => void | Promise<void>
  ) {
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
            void this.onSubmit(this.project);
          })
      );
  }
}

class HabitPromptModal extends Modal {
  private projects: string[];
  private onSubmit: (
    project: string,
    title: string,
    frequency: HabitFrequency,
    target: number,
    goal?: string
  ) => void | Promise<void>;
  private project: string;
  private title = "";
  private frequency: HabitFrequency = "daily";
  private target = 1;
  private goal = "";

  constructor(
    app: App,
    projects: string[],
    onSubmit: (
      project: string,
      title: string,
      frequency: HabitFrequency,
      target: number,
      goal?: string
    ) => void | Promise<void>
  ) {
    super(app);
    this.projects = projects;
    this.project = projects[0];
    this.onSubmit = onSubmit;
  }

  onOpen(): void {
    this.contentEl.createEl("h2", { text: "New habit" });
    new Setting(this.contentEl).setName("Project").addDropdown((dd) => {
      for (const p of this.projects) dd.addOption(p, p);
      dd.setValue(this.project);
      dd.onChange((v) => (this.project = v));
    });
    new Setting(this.contentEl).setName("Title").addText((t) => {
      t.setPlaceholder("Habit name");
      t.onChange((v) => (this.title = v));
      t.inputEl.addEventListener("keydown", (e) => {
        if (e.key === "Enter") this.submit();
      });
      activeWindow.setTimeout(() => t.inputEl.focus(), 0);
    });
    new Setting(this.contentEl).setName("Frequency").addDropdown((dd) => {
      dd.addOption("daily", HABIT_FREQUENCY_LABEL.daily);
      dd.addOption("weekly", HABIT_FREQUENCY_LABEL.weekly);
      dd.addOption("monthly", HABIT_FREQUENCY_LABEL.monthly);
      dd.setValue(this.frequency);
      dd.onChange((v) => (this.frequency = v as HabitFrequency));
    });
    new Setting(this.contentEl)
      .setName("Target")
      .setDesc("How many times per period to count it done.")
      .addText((t) => {
        t.inputEl.type = "number";
        t.inputEl.min = "1";
        t.inputEl.step = "1";
        t.setValue(String(this.target)).onChange((v) => {
          const n = parseInt(v, 10);
          this.target = Number.isFinite(n) && n >= 1 ? n : 1;
        });
      });
    new Setting(this.contentEl).setName("Goal").addText((t) => {
      t.setPlaceholder("What to do each period");
      t.onChange((v) => (this.goal = v));
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
    const t = this.title.trim();
    if (!t) return;
    const goal = this.goal.trim() || undefined;
    this.close();
    void this.onSubmit(this.project, t, this.frequency, this.target, goal);
  }
}

class HabitPickModal extends Modal {
  private habits: { path: string; title: string; project: string }[];
  private onSubmit: (path: string) => void | Promise<void>;
  private path: string;

  constructor(
    app: App,
    habits: { path: string; title: string; project: string }[],
    onSubmit: (path: string) => void | Promise<void>
  ) {
    super(app);
    this.habits = habits;
    this.path = habits[0]?.path ?? "";
    this.onSubmit = onSubmit;
  }

  onOpen(): void {
    this.contentEl.createEl("h2", { text: "Log habit completion" });
    new Setting(this.contentEl).setName("Habit").addDropdown((dd) => {
      for (const h of this.habits) {
        dd.addOption(h.path, `${h.title} — ${h.project}`);
      }
      dd.setValue(this.path);
      dd.onChange((v) => (this.path = v));
    });
    new Setting(this.contentEl)
      .addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()))
      .addButton((b) =>
        b
          .setButtonText("Mark done")
          .setCta()
          .onClick(() => {
            this.close();
            void this.onSubmit(this.path);
          })
      );
  }
}

async function backfillCodes(plugin: KanbanPlusPlugin): Promise<{
  task: number;
  log: number;
  milestone: number;
  project: number;
  habit: number;
}> {
  const counts = { task: 0, log: 0, milestone: 0, project: 0, habit: 0 };
  const state = plugin.store.getState();
  const groups: Array<{
    kind: "task" | "log" | "milestone" | "project" | "habit";
    items: { path: string; created?: string; code?: string }[];
  }> = [
    { kind: "project", items: Object.values(state.projects) },
    { kind: "milestone", items: Object.values(state.milestones) },
    { kind: "task", items: Object.values(state.tasks) },
    { kind: "log", items: Object.values(state.logs) },
    { kind: "habit", items: Object.values(state.habits) },
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
