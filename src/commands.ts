import { Modal, Notice, Setting, App } from "obsidian";
import type KanbanPlusPlugin from "./main";
import { QuickCreateModal } from "./views/shared/QuickCreateModal";
import { listProjectFolders } from "./services/taskService";

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
