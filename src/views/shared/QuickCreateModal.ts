import { App, Modal, Setting, Notice } from "obsidian";
import type { TaskService } from "../../services/taskService";
import type { ProjectService } from "../../services/projectService";
import type { KanbanPlusSettings } from "../../settings";
import { listProjectFolders } from "../../services/taskService";
import { todayISO } from "../../schema/frontmatter";
import { tomorrowISO, nextWeekISO } from "../../utils/dates";

interface ParsedInput {
  title: string;
  tags: string[];
  project?: string;
  priority?: string;
  due?: string;
}

export interface QuickCreateDefaults {
  due?: string;
  project?: string;
}

export class QuickCreateModal extends Modal {
  private taskService: TaskService;
  private projectService: ProjectService;
  private settings: KanbanPlusSettings;
  private defaults: QuickCreateDefaults;

  private title = "";
  private project = "";
  private milestone = "";
  private status: string;
  private priority: string; // empty string = no priority
  private due: string;
  private tags = "";

  constructor(
    app: App,
    taskService: TaskService,
    projectService: ProjectService,
    settings: KanbanPlusSettings,
    defaults: QuickCreateDefaults = {}
  ) {
    super(app);
    this.taskService = taskService;
    this.projectService = projectService;
    this.settings = settings;
    this.defaults = defaults;
    this.status = settings.statuses[1]?.id ?? settings.statuses[0]?.id ?? "todo";
    this.priority = "";
    this.due = defaults.due ?? "";
    this.project = defaults.project ?? "";
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("kp-quickcreate");
    contentEl.createEl("h2", { text: "New task" });

    const titleSetting = new Setting(contentEl)
      .setName("Title")
      .setDesc("Smart parse — exclamation marks set priority, @project assigns the project, #tag adds tags, and due:tomorrow sets the date.")
      .addText((t) =>
        t
          .setPlaceholder("Fix login bug !high due:tomorrow @marvis #bug")
          .setValue(this.title)
          .onChange((v) => {
            this.title = v;
            const parsed = parseSmart(v);
            if (parsed.priority) this.priority = parsed.priority;
            if (parsed.due) this.due = parsed.due;
            if (parsed.project) this.project = parsed.project;
            if (parsed.tags.length) this.tags = parsed.tags.join(", ");
            this.refreshFields();
          })
          .inputEl.focus()
      );
    titleSetting.controlEl.querySelector("input")?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        void this.submit();
      }
    });

    const projects = listProjectFolders(this.app, this.settings.rootFolder);

    new Setting(contentEl).setName("Project").addDropdown((dd) => {
      const initial = this.project || projects[0] || "Inbox";
      this.project = initial;
      const opts: Record<string, string> = {};
      for (const p of projects) opts[p] = p;
      if (projects.length === 0) opts["Inbox"] = "Inbox";
      dd.addOptions(opts);
      dd.setValue(this.project);
      dd.onChange((v) => {
        this.project = v;
      });
      this.projectDropdown = dd.selectEl;
    });

    new Setting(contentEl).setName("Status").addDropdown((dd) => {
      for (const s of this.settings.statuses) dd.addOption(s.id, s.label);
      dd.setValue(this.status).onChange((v) => (this.status = v));
      this.statusDropdown = dd.selectEl;
    });

    new Setting(contentEl).setName("Priority").addDropdown((dd) => {
      dd.addOption("", "— none —");
      for (const p of this.settings.priorities) dd.addOption(p.id, p.label);
      dd.setValue(this.priority).onChange((v) => (this.priority = v));
      this.priorityDropdown = dd.selectEl;
    });

    new Setting(contentEl).setName("Due").addText((t) => {
      t.inputEl.type = "date";
      t.setValue(this.due).onChange((v) => (this.due = v));
      this.dueInput = t.inputEl;
    });

    new Setting(contentEl).setName("Quick due").addExtraButton((b) =>
      b
        .setIcon("calendar-days")
        .setTooltip("Today")
        .onClick(() => {
          this.due = todayISO();
          this.refreshFields();
        })
    );
    const lastSetting = contentEl.lastElementChild as HTMLElement;
    if (lastSetting) {
      const ctl = lastSetting.querySelector(".setting-item-control");
      if (ctl) {
        const tomorrow = ctl.createEl("button", { text: "Tomorrow", cls: "kp-btn kp-btn--ghost" });
        tomorrow.onclick = () => {
          this.due = tomorrowISO();
          this.refreshFields();
        };
        const week = ctl.createEl("button", { text: "Next week", cls: "kp-btn kp-btn--ghost" });
        week.onclick = () => {
          this.due = nextWeekISO();
          this.refreshFields();
        };
      }
    }

    new Setting(contentEl).setName("Tags").addText((t) =>
      t.setPlaceholder("Comma, separated").setValue(this.tags).onChange((v) => (this.tags = v))
    );

    new Setting(contentEl)
      .addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()))
      .addButton((b) =>
        b
          .setButtonText("Create")
          .setCta()
          .onClick(() => void this.submit())
      );
  }

  private projectDropdown?: HTMLSelectElement;
  private statusDropdown?: HTMLSelectElement;
  private priorityDropdown?: HTMLSelectElement;
  private dueInput?: HTMLInputElement;

  private refreshFields(): void {
    if (this.projectDropdown && this.project) {
      const exists = Array.from(this.projectDropdown.options).some((o) => o.value === this.project);
      if (!exists) {
        const opt = activeDocument.createEl("option");
        opt.value = this.project;
        opt.text = this.project;
        this.projectDropdown.add(opt);
      }
      this.projectDropdown.value = this.project;
    }
    if (this.statusDropdown) this.statusDropdown.value = this.status;
    if (this.priorityDropdown) this.priorityDropdown.value = this.priority;
    if (this.dueInput) this.dueInput.value = this.due;
  }

  private async submit(): Promise<void> {
    const cleanedTitle = stripSmartTokens(this.title).trim();
    if (!cleanedTitle) {
      new Notice("Task title required");
      return;
    }
    try {
      const tags = this.tags
        .split(/[,\s]+/)
        .map((t) => t.replace(/^#/, "").trim())
        .filter((t) => t.length > 0);
      const file = await this.taskService.createTask({
        title: cleanedTitle,
        project: this.project || "Inbox",
        status: this.status,
        priority: this.priority || undefined,
        due: this.due || undefined,
        tags,
      });
      new Notice(`Created ${file.basename}`);
      this.close();
    } catch (e) {
      console.error(e);
      new Notice("Failed to create task — see console");
    }
  }
}

const PRIORITY_TOKENS: Record<string, string> = {
  low: "low",
  medium: "medium",
  med: "medium",
  high: "high",
};

const DATE_KEYWORDS: Record<string, () => string> = {
  today: () => todayISO(),
  tomorrow: () => tomorrowISO(),
  "next-week": () => nextWeekISO(),
  nextweek: () => nextWeekISO(),
};

export function parseSmart(input: string): ParsedInput {
  const tags: string[] = [];
  let project: string | undefined;
  let priority: string | undefined;
  let due: string | undefined;

  const tagRe = /(?:^|\s)#([\w-]+)/g;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(input))) tags.push(m[1]);

  const projectMatch = input.match(/(?:^|\s)@([\w][\w\s-]*?)(?=\s|$)/);
  if (projectMatch) project = projectMatch[1].trim();

  // Bang notation: !!! → high, !! → medium, ! → low (longer wins)
  const bangMatch = input.match(/(?:^|\s)(!{1,3})(?=\s|$)/);
  if (bangMatch) {
    const n = bangMatch[1].length;
    priority = n === 3 ? "high" : n === 2 ? "medium" : "low";
  }

  // Keyword form: !high / !low / !med — overrides bang notation if present
  const keywordMatch = input.match(/(?:^|\s)!(low|med|medium|high)\b/i);
  if (keywordMatch) priority = PRIORITY_TOKENS[keywordMatch[1].toLowerCase()];

  const dueMatch = input.match(/due:(\S+)/i);
  if (dueMatch) {
    const v = dueMatch[1].toLowerCase();
    if (DATE_KEYWORDS[v]) due = DATE_KEYWORDS[v]();
    else if (/^\d{4}-\d{2}-\d{2}$/.test(v)) due = v;
  }

  return { title: stripSmartTokens(input).trim(), tags, project, priority, due };
}

export function stripSmartTokens(input: string): string {
  return input
    .replace(/(?:^|\s)#[\w-]+/g, "")
    .replace(/(?:^|\s)@[\w][\w\s-]*?(?=\s|$)/g, "")
    .replace(/(?:^|\s)!(?:low|med|medium|high)\b/gi, "")
    .replace(/(?:^|\s)!{1,3}(?=\s|$)/g, "")
    .replace(/due:\S+/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}
