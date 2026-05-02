import { App, Modal, Notice, Setting, setIcon } from "obsidian";
import type KanbanPlusPlugin from "../../main";
import { listProjectFolders } from "../../services/taskService";
import { PROJECT_PALETTE } from "../../schema/types";

type Tab = "task" | "log" | "project" | "milestone";

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: "task", label: "Task", icon: "check" },
  { id: "log", label: "Log", icon: "book" },
  { id: "project", label: "Project", icon: "folder" },
  { id: "milestone", label: "Milestone", icon: "flag" },
];

export class CreateMenuModal extends Modal {
  private plugin: KanbanPlusPlugin;
  private tab: Tab = "task";
  private tabBar!: HTMLElement;
  private formEl!: HTMLElement;

  constructor(app: App, plugin: KanbanPlusPlugin) {
    super(app);
    this.plugin = plugin;
  }

  onOpen(): void {
    // kp-portal exposes the same CSS variables as kp-host without imposing
    // its flex layout, so .kp-viewswitcher styles resolve inside the modal.
    this.contentEl.addClass("kp-portal");
    this.contentEl.addClass("kp-create-menu");
    this.contentEl.createEl("h2", { text: "Create" });

    this.tabBar = this.contentEl.createDiv({ cls: "kp-viewswitcher kp-create-menu__tabs" });
    for (const t of TABS) {
      const btn = this.tabBar.createEl("button", {
        cls: `kp-viewswitcher__btn ${this.tab === t.id ? "is-active" : ""}`,
        attr: { title: t.label },
      });
      const iconWrap = btn.createSpan({ cls: "kp-create-menu__tabicon" });
      setIcon(iconWrap, t.icon);
      btn.createSpan({ text: t.label });
      btn.addEventListener("click", () => {
        this.tab = t.id;
        this.refreshTabs();
        this.renderForm();
      });
    }

    this.formEl = this.contentEl.createDiv({ cls: "kp-create-menu__form" });
    this.renderForm();
  }

  private refreshTabs(): void {
    Array.from(this.tabBar.children).forEach((el, idx) => {
      const t = TABS[idx];
      el.classList.toggle("is-active", t.id === this.tab);
    });
  }

  private renderForm(): void {
    this.formEl.empty();
    if (this.tab === "task") this.renderTaskForm();
    else if (this.tab === "log") this.renderLogForm();
    else if (this.tab === "project") this.renderProjectForm();
    else this.renderMilestoneForm();
  }

  private projectOptions(): string[] {
    return listProjectFolders(this.app, this.plugin.settings.rootFolder);
  }

  private renderTaskForm(): void {
    const projects = this.projectOptions();
    const statuses = this.plugin.settings.statuses;
    const priorities = this.plugin.settings.priorities;
    const state = {
      title: "",
      project: projects[0] ?? "",
      status: statuses[1]?.id ?? statuses[0]?.id ?? "todo",
      priority: "",
      due: "",
    };

    new Setting(this.formEl).setName("Title").addText((t) => {
      t.setPlaceholder("Fix the login bug")
        .onChange((v) => (state.title = v));
      t.inputEl.addEventListener("keydown", (e) => {
        if (e.key === "Enter") void submit();
      });
      setTimeout(() => t.inputEl.focus(), 0);
    });
    new Setting(this.formEl).setName("Project").addDropdown((dd) => {
      if (projects.length === 0) dd.addOption("", "(no projects)");
      for (const p of projects) dd.addOption(p, p);
      dd.setValue(state.project);
      dd.onChange((v) => (state.project = v));
    });
    new Setting(this.formEl).setName("Status").addDropdown((dd) => {
      for (const s of statuses) dd.addOption(s.id, s.label);
      dd.setValue(state.status);
      dd.onChange((v) => (state.status = v));
    });
    new Setting(this.formEl).setName("Priority").addDropdown((dd) => {
      dd.addOption("", "—");
      for (const p of priorities) dd.addOption(p.id, p.label);
      dd.setValue(state.priority);
      dd.onChange((v) => (state.priority = v));
    });
    new Setting(this.formEl).setName("Due").addText((t) => {
      t.inputEl.type = "date";
      t.onChange((v) => (state.due = v));
    });

    const submit = async () => {
      const title = state.title.trim();
      if (!title) {
        new Notice("Title is required.");
        return;
      }
      try {
        await this.plugin.taskService.createTask({
          title,
          project: state.project || undefined,
          status: state.status,
          priority: state.priority || undefined,
          due: state.due || undefined,
        });
        new Notice(`Task "${title}" created`);
        this.close();
      } catch (e) {
        console.error(e);
        new Notice("Failed to create task — see console");
      }
    };

    this.renderActions(submit, "Create task");
  }

  private renderLogForm(): void {
    const projects = this.projectOptions();
    const state = { project: projects[0] ?? "", tags: "", body: "" };

    if (projects.length === 0) {
      this.formEl.createEl("p", {
        text: "Create a project first.",
        cls: "setting-item-description",
      });
      return;
    }

    new Setting(this.formEl).setName("Project").addDropdown((dd) => {
      for (const p of projects) dd.addOption(p, p);
      dd.setValue(state.project);
      dd.onChange((v) => (state.project = v));
    });
    new Setting(this.formEl).setName("Tags").addText((t) => {
      t.setPlaceholder("comma-separated").onChange((v) => (state.tags = v));
    });
    new Setting(this.formEl).setName("Body").addTextArea((t) => {
      t.setPlaceholder("What happened?").onChange((v) => (state.body = v));
      t.inputEl.rows = 5;
      t.inputEl.style.width = "100%";
      t.inputEl.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void submit();
      });
      setTimeout(() => t.inputEl.focus(), 0);
    });

    const submit = async () => {
      try {
        const tags = state.tags
          .split(/[,\s]+/)
          .map((t) => t.replace(/^#/, "").trim())
          .filter(Boolean);
        await this.plugin.logService.createLog(state.project, {
          body: state.body.trim() || undefined,
          tags: tags.length ? tags : undefined,
        });
        new Notice(`Log added to ${state.project}`);
        this.close();
      } catch (e) {
        console.error(e);
        new Notice("Failed to create log — see console");
      }
    };

    this.renderActions(submit, "Create log");
  }

  private renderProjectForm(): void {
    const state = { name: "", color: PROJECT_PALETTE[0] };

    new Setting(this.formEl).setName("Name").addText((t) => {
      t.setPlaceholder("New project").onChange((v) => (state.name = v));
      t.inputEl.addEventListener("keydown", (e) => {
        if (e.key === "Enter") void submit();
      });
      setTimeout(() => t.inputEl.focus(), 0);
    });
    new Setting(this.formEl).setName("Color").addColorPicker((c) =>
      c.setValue(state.color).onChange((v) => (state.color = v))
    );

    const submit = async () => {
      const n = state.name.trim();
      if (!n) {
        new Notice("Name is required.");
        return;
      }
      try {
        await this.plugin.projectService.createProject(n, state.color);
        new Notice(`Project ${n} ready`);
        this.close();
      } catch (e) {
        console.error(e);
        new Notice("Failed to create project — see console");
      }
    };

    this.renderActions(submit, "Create project");
  }

  private renderMilestoneForm(): void {
    const projects = this.projectOptions();
    const state = { project: projects[0] ?? "", name: "", due: "" };

    if (projects.length === 0) {
      this.formEl.createEl("p", {
        text: "Create a project first.",
        cls: "setting-item-description",
      });
      return;
    }

    new Setting(this.formEl).setName("Project").addDropdown((dd) => {
      for (const p of projects) dd.addOption(p, p);
      dd.setValue(state.project);
      dd.onChange((v) => (state.project = v));
    });
    new Setting(this.formEl).setName("Name").addText((t) => {
      t.setPlaceholder("v1").onChange((v) => (state.name = v));
      t.inputEl.addEventListener("keydown", (e) => {
        if (e.key === "Enter") void submit();
      });
      setTimeout(() => t.inputEl.focus(), 0);
    });
    new Setting(this.formEl).setName("Due").addText((t) => {
      t.inputEl.type = "date";
      t.onChange((v) => (state.due = v));
    });

    const submit = async () => {
      const n = state.name.trim();
      if (!n) {
        new Notice("Name is required.");
        return;
      }
      try {
        await this.plugin.milestoneService.createMilestone(state.project, n, {
          due: state.due || undefined,
        });
        new Notice(`Milestone ${n} added to ${state.project}`);
        this.close();
      } catch (e) {
        console.error(e);
        new Notice("Failed to create milestone — see console");
      }
    };

    this.renderActions(submit, "Create milestone");
  }

  private renderActions(onSubmit: () => Promise<void>, ctaLabel: string): void {
    new Setting(this.formEl)
      .addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()))
      .addButton((b) =>
        b
          .setButtonText(ctaLabel)
          .setCta()
          .onClick(() => void onSubmit())
      );
  }
}
