import { App, Modal, Notice, Setting, setIcon } from "obsidian";
import type KanbanPlusPlugin from "../../main";
import { listProjectFolders } from "../../services/taskService";
import { PROJECT_PALETTE } from "../../schema/types";
import { saveAttachmentFile } from "../../utils/attachments";
import { presetToRRule } from "../../utils/recurrence";
import { DEFAULT_EVENT_PROJECT } from "../../services/eventService";

type Tab = "task" | "log" | "event" | "project" | "milestone";

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: "task", label: "Task", icon: "check" },
  { id: "log", label: "Log", icon: "book" },
  { id: "event", label: "Event", icon: "calendar" },
  { id: "project", label: "Project", icon: "folder" },
  { id: "milestone", label: "Milestone", icon: "flag" },
];

export class CreateMenuModal extends Modal {
  private plugin: KanbanPlusPlugin;
  private tab: Tab = "task";
  private tabBar!: HTMLElement;
  private formEl!: HTMLElement;
  private dropCleanup: (() => void) | null = null;

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
    this.dropCleanup?.();
    this.dropCleanup = null;
    this.formEl.empty();
    if (this.tab === "task") this.renderTaskForm();
    else if (this.tab === "log") this.renderLogForm();
    else if (this.tab === "event") this.renderEventForm();
    else if (this.tab === "project") this.renderProjectForm();
    else this.renderMilestoneForm();
  }

  onClose(): void {
    this.dropCleanup?.();
    this.dropCleanup = null;
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
      attachments: [] as File[],
    };

    new Setting(this.formEl).setName("Title").addText((t) => {
      t.setPlaceholder("Fix the login bug")
        .onChange((v) => (state.title = v));
      t.inputEl.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          t.inputEl.blur();
        }
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

    this.renderAttachmentsField(state);

    const submit = async () => {
      const title = state.title.trim();
      if (!title) {
        new Notice("Title is required.");
        return;
      }
      try {
        const projectName = state.project || "Inbox";
        const refs = await this.persistAttachments(
          state.attachments,
          this.plugin.taskService.attachmentsFolder(projectName)
        );
        const body = refs.length ? refs.map((r) => `![[${r}]]`).join("\n") : undefined;
        await this.plugin.taskService.createTask({
          title,
          project: state.project || undefined,
          status: state.status,
          priority: state.priority || undefined,
          due: state.due || undefined,
          body,
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
    const state = {
      project: projects[0] ?? "",
      tags: "",
      body: "",
      attachments: [] as File[],
    };

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

    this.renderAttachmentsField(state);

    const submit = async () => {
      try {
        const tags = state.tags
          .split(/[,\s]+/)
          .map((t) => t.replace(/^#/, "").trim())
          .filter(Boolean);
        const refs = await this.persistAttachments(
          state.attachments,
          this.plugin.logService.attachmentsFolder(state.project)
        );
        const refsBlock = refs.map((r) => `![[${r}]]`).join("\n");
        const bodyParts = [state.body.trim(), refsBlock].filter(Boolean);
        const body = bodyParts.length ? bodyParts.join("\n\n") : undefined;
        await this.plugin.logService.createLog(state.project, {
          body,
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

  private renderEventForm(): void {
    const projects = this.projectOptions();
    const milestones = Object.values(this.plugin.store.getState().milestones)
      .map((m) => m.name)
      .sort();
    const todayIso = new Date().toISOString().slice(0, 10);
    const state = {
      title: "",
      date: todayIso,
      allDay: true,
      time: "09:00",
      endTime: "10:00",
      project: projects.includes(DEFAULT_EVENT_PROJECT)
        ? DEFAULT_EVENT_PROJECT
        : (projects[0] ?? DEFAULT_EVENT_PROJECT),
      milestone: "",
      recurrencePreset: "none",
      recurrenceCustom: "",
      tags: "",
      body: "",
      attachments: [] as File[],
    };

    new Setting(this.formEl).setName("Title").addText((t) => {
      t.setPlaceholder("Standup")
        .onChange((v) => (state.title = v));
      t.inputEl.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          t.inputEl.blur();
        }
      });
      setTimeout(() => t.inputEl.focus(), 0);
    });

    new Setting(this.formEl).setName("Date").addText((t) => {
      t.inputEl.type = "date";
      t.setValue(state.date).onChange((v) => (state.date = v));
    });

    let timeRow: Setting | null = null;
    let endTimeRow: Setting | null = null;
    const updateTimeVisibility = () => {
      const display = state.allDay ? "none" : "";
      if (timeRow) (timeRow.settingEl as HTMLElement).style.display = display;
      if (endTimeRow) (endTimeRow.settingEl as HTMLElement).style.display = display;
    };

    new Setting(this.formEl).setName("All-day").addToggle((t) => {
      t.setValue(state.allDay).onChange((v) => {
        state.allDay = v;
        updateTimeVisibility();
      });
    });

    timeRow = new Setting(this.formEl).setName("Time").addText((t) => {
      t.inputEl.type = "time";
      t.setValue(state.time).onChange((v) => (state.time = v));
    });

    endTimeRow = new Setting(this.formEl).setName("End time").addText((t) => {
      t.inputEl.type = "time";
      t.setValue(state.endTime).onChange((v) => (state.endTime = v));
    });

    updateTimeVisibility();

    new Setting(this.formEl).setName("Project").addDropdown((dd) => {
      if (!projects.includes(DEFAULT_EVENT_PROJECT)) {
        dd.addOption(DEFAULT_EVENT_PROJECT, DEFAULT_EVENT_PROJECT);
      }
      for (const p of projects) dd.addOption(p, p);
      dd.setValue(state.project);
      dd.onChange((v) => (state.project = v));
    });

    if (milestones.length > 0) {
      new Setting(this.formEl).setName("Milestone").addDropdown((dd) => {
        dd.addOption("", "—");
        for (const m of milestones) dd.addOption(m, m);
        dd.setValue(state.milestone);
        dd.onChange((v) => (state.milestone = v));
      });
    }

    let customRow: Setting | null = null;
    new Setting(this.formEl).setName("Recurrence").addDropdown((dd) => {
      dd.addOption("none", "None");
      dd.addOption("daily", "Daily");
      dd.addOption("weekly", "Weekly");
      dd.addOption("monthly", "Monthly");
      dd.addOption("yearly", "Yearly");
      dd.addOption("custom", "Custom RRULE…");
      dd.setValue(state.recurrencePreset);
      dd.onChange((v) => {
        state.recurrencePreset = v;
        if (customRow) {
          (customRow.settingEl as HTMLElement).style.display =
            v === "custom" ? "" : "none";
        }
      });
    });
    customRow = new Setting(this.formEl).setName("Custom RRULE").addText((t) => {
      t.setPlaceholder("FREQ=WEEKLY;BYDAY=MO,WE")
        .onChange((v) => (state.recurrenceCustom = v));
    });
    (customRow.settingEl as HTMLElement).style.display = "none";

    new Setting(this.formEl).setName("Tags").addText((t) => {
      t.setPlaceholder("comma-separated").onChange((v) => (state.tags = v));
    });

    new Setting(this.formEl).setName("Body").addTextArea((t) => {
      t.setPlaceholder("Notes…").onChange((v) => (state.body = v));
      t.inputEl.rows = 3;
      t.inputEl.style.width = "100%";
    });

    this.renderAttachmentsField(state);

    const submit = async () => {
      const title = state.title.trim();
      if (!title) {
        new Notice("Title is required.");
        return;
      }
      if (!state.date) {
        new Notice("Date is required.");
        return;
      }
      try {
        const tags = state.tags
          .split(/[,\s]+/)
          .map((t) => t.replace(/^#/, "").trim())
          .filter(Boolean);
        const projectName = state.project || DEFAULT_EVENT_PROJECT;
        const refs = await this.persistAttachments(
          state.attachments,
          this.plugin.eventService.attachmentsFolder(projectName)
        );
        const refsBlock = refs.map((r) => `![[${r}]]`).join("\n");
        const bodyParts = [state.body.trim(), refsBlock].filter(Boolean);
        const body = bodyParts.length ? bodyParts.join("\n\n") : undefined;

        let recurrence: string | undefined;
        if (state.recurrencePreset === "custom") {
          recurrence = state.recurrenceCustom.trim() || undefined;
        } else if (state.recurrencePreset !== "none") {
          recurrence = presetToRRule(state.recurrencePreset);
        }

        await this.plugin.eventService.createEvent({
          title,
          date: state.date,
          time: state.allDay ? undefined : state.time || undefined,
          endTime: state.allDay ? undefined : state.endTime || undefined,
          recurrence,
          tags: tags.length ? tags : undefined,
          body,
          project: projectName,
          milestone: state.milestone || undefined,
        });
        new Notice(`Event "${title}" created`);
        this.close();
      } catch (e) {
        console.error(e);
        new Notice("Failed to create event — see console");
      }
    };

    this.renderActions(submit, "Create event");
  }

  private renderProjectForm(): void {
    const state = { name: "", color: PROJECT_PALETTE[0] };

    new Setting(this.formEl).setName("Name").addText((t) => {
      t.setPlaceholder("New project").onChange((v) => (state.name = v));
      t.inputEl.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          t.inputEl.blur();
        }
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
        if (e.key === "Enter") {
          e.preventDefault();
          t.inputEl.blur();
        }
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

  private renderAttachmentsField(state: { attachments: File[] }): void {
    const zone = this.formEl.createDiv({ cls: "kp-attach__zone" });
    const setting = new Setting(zone).setName("Attachments");

    const input = setting.controlEl.createEl("input", {
      type: "file",
      cls: "kp-attach__input",
      attr: { multiple: "true" },
    }) as HTMLInputElement;
    input.style.display = "none";

    setting.addButton((b) =>
      b
        .setButtonText("Add file")
        .setIcon("paperclip")
        .onClick(() => input.click())
    );

    const list = zone.createDiv({ cls: "kp-attach__list" });

    const renderList = () => {
      list.empty();
      state.attachments.forEach((file, idx) => {
        const chip = list.createDiv({ cls: "kp-attach__chip" });
        chip.createSpan({ cls: "kp-attach__name", text: file.name });
        const removeBtn = chip.createEl("button", {
          cls: "kp-attach__remove",
          attr: { "aria-label": "Remove" },
        });
        setIcon(removeBtn, "x");
        removeBtn.addEventListener("click", () => {
          state.attachments.splice(idx, 1);
          renderList();
        });
      });
    };

    input.addEventListener("change", () => {
      const files = Array.from(input.files ?? []);
      if (files.length) {
        state.attachments.push(...files);
        renderList();
      }
      input.value = "";
    });

    // Drag-and-drop scoped to the attachments zone. The depth counter prevents
    // dragleave from firing when the cursor crosses child elements.
    let depth = 0;
    const isFileDrag = (e: DragEvent) =>
      !!e.dataTransfer && Array.from(e.dataTransfer.types).includes("Files");
    const onDragEnter = (e: DragEvent) => {
      if (!isFileDrag(e)) return;
      e.preventDefault();
      depth += 1;
      zone.addClass("is-dropzone");
    };
    const onDragOver = (e: DragEvent) => {
      if (!isFileDrag(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    };
    const onDragLeave = (e: DragEvent) => {
      if (!isFileDrag(e)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) zone.removeClass("is-dropzone");
    };
    const onDrop = (e: DragEvent) => {
      if (!e.dataTransfer?.files || e.dataTransfer.files.length === 0) return;
      e.preventDefault();
      depth = 0;
      zone.removeClass("is-dropzone");
      const files = Array.from(e.dataTransfer.files);
      if (files.length) {
        state.attachments.push(...files);
        renderList();
      }
    };
    zone.addEventListener("dragenter", onDragEnter);
    zone.addEventListener("dragover", onDragOver);
    zone.addEventListener("dragleave", onDragLeave);
    zone.addEventListener("drop", onDrop);
    this.dropCleanup = () => {
      zone.removeEventListener("dragenter", onDragEnter);
      zone.removeEventListener("dragover", onDragOver);
      zone.removeEventListener("dragleave", onDragLeave);
      zone.removeEventListener("drop", onDrop);
      zone.removeClass("is-dropzone");
    };

    renderList();
  }

  private async persistAttachments(
    files: File[],
    folder: string
  ): Promise<string[]> {
    if (!files.length) return [];
    await this.plugin.projectService.ensureFolder(folder);
    const refs: string[] = [];
    for (const file of files) {
      const saved = await saveAttachmentFile(this.app, folder, file);
      refs.push(saved.name);
    }
    return refs;
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
