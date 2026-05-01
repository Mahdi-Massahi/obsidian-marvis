import { App, normalizePath, TFile, TFolder } from "obsidian";
import {
  todayISO,
  toWikilink,
  updateFrontmatter,
} from "../schema/frontmatter";
import type { ProjectService } from "./projectService";
import type { Task } from "../schema/types";
import { openOrFocusFile, OpenMode, SidebarLeafCache } from "../utils/openFile";

export { findOpenLeafForFile } from "../utils/openFile";

export interface CreateTaskInput {
  title: string;
  project?: string;
  milestone?: string;
  status?: string;
  priority?: string;
  due?: string;
  start?: string;
  tags?: string[];
}

export class TaskService {
  constructor(
    private app: App,
    private projects: ProjectService,
    private getOpenMode: () => OpenMode = () => "sidebar",
    private sidebarCache?: SidebarLeafCache
  ) {}

  tasksFolder(projectName: string): string {
    return normalizePath(`${this.projects.projectFolder(projectName)}/tasks`);
  }

  archiveFolder(projectName: string): string {
    return normalizePath(`${this.projects.projectFolder(projectName)}/archive`);
  }

  private sanitizeFileName(name: string): string {
    return name
      .replace(/[\\/:*?"<>|#^[\]]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80);
  }

  private async uniquePath(folder: string, base: string): Promise<string> {
    const safe = this.sanitizeFileName(base) || "Task";
    let candidate = normalizePath(`${folder}/${safe}.md`);
    let n = 2;
    while (this.app.vault.getAbstractFileByPath(candidate)) {
      candidate = normalizePath(`${folder}/${safe} ${n}.md`);
      n++;
    }
    return candidate;
  }

  async createTask(input: CreateTaskInput): Promise<TFile> {
    const projectName = input.project ?? "Inbox";
    await this.projects.createProject(projectName);
    const folder = this.tasksFolder(projectName);
    await this.projects.ensureFolder(folder);

    const path = await this.uniquePath(folder, input.title);
    const fm: string[] = ["---", "kind: task", `project: "${toWikilink(projectName)}"`];
    if (input.milestone) fm.push(`milestone: "${toWikilink(input.milestone)}"`);
    fm.push(`status: ${input.status ?? "todo"}`);
    if (input.priority) fm.push(`priority: ${input.priority}`);
    if (input.due) fm.push(`due: ${input.due}`);
    if (input.start) fm.push(`start: ${input.start}`);
    if (input.tags && input.tags.length > 0) {
      fm.push(`tags: [${input.tags.map((t) => JSON.stringify(t)).join(", ")}]`);
    }
    fm.push(`created: ${todayISO()}`);
    fm.push("order: 1");
    fm.push("---", "", "");

    return await this.app.vault.create(path, fm.join("\n"));
  }

  private getFile(task: Task): TFile | null {
    const file = this.app.vault.getAbstractFileByPath(task.path);
    return file instanceof TFile ? file : null;
  }

  async updateField(task: Task, key: string, value: unknown): Promise<void> {
    const file = this.getFile(task);
    if (!file) return;
    await updateFrontmatter(this.app, file, (fm) => {
      if (value == null || value === "") delete fm[key];
      else fm[key] = value;
    });
  }

  async setStatus(task: Task, status: string): Promise<void> {
    await this.updateField(task, "status", status);
  }

  async setPriority(task: Task, priority: string): Promise<void> {
    await this.updateField(task, "priority", priority);
  }

  async setDue(task: Task, due: string | undefined): Promise<void> {
    await this.updateField(task, "due", due);
  }

  async setStart(task: Task, start: string | undefined): Promise<void> {
    await this.updateField(task, "start", start);
  }

  async setMilestone(task: Task, milestone: string | undefined): Promise<void> {
    const file = this.getFile(task);
    if (!file) return;
    await updateFrontmatter(this.app, file, (fm) => {
      if (!milestone) delete fm["milestone"];
      else fm["milestone"] = toWikilink(milestone);
    });
  }

  async setProject(task: Task, projectName: string): Promise<void> {
    const file = this.getFile(task);
    if (!file) return;
    await this.projects.createProject(projectName);
    const newFolder = this.tasksFolder(projectName);
    await this.projects.ensureFolder(newFolder);
    const newPath = normalizePath(`${newFolder}/${file.name}`);
    if (newPath !== file.path) {
      await this.app.fileManager.renameFile(file, newPath);
    }
    const moved = this.app.vault.getAbstractFileByPath(newPath);
    if (moved instanceof TFile) {
      await updateFrontmatter(this.app, moved, (fm) => {
        fm["project"] = toWikilink(projectName);
      });
    }
  }

  async setOrder(task: Task, order: number): Promise<void> {
    await this.updateField(task, "order", order);
  }

  async setTags(task: Task, tags: string[]): Promise<void> {
    await this.updateField(task, "tags", tags);
  }

  async archive(task: Task): Promise<void> {
    const file = this.getFile(task);
    if (!file) return;
    const projectName = task.project ?? "Inbox";
    const archiveFolder = this.archiveFolder(projectName);
    await this.projects.ensureFolder(archiveFolder);
    const newPath = normalizePath(`${archiveFolder}/${file.name}`);
    await updateFrontmatter(this.app, file, (fm) => {
      fm["status"] = "done";
      fm["archived"] = true;
    });
    const refreshed = this.app.vault.getAbstractFileByPath(file.path);
    if (refreshed instanceof TFile) {
      await this.app.fileManager.renameFile(refreshed, newPath);
    }
  }

  async unarchive(task: Task): Promise<void> {
    const file = this.getFile(task);
    if (!file) return;
    const projectName = task.project ?? "Inbox";
    const taskFolder = this.tasksFolder(projectName);
    await this.projects.ensureFolder(taskFolder);
    await updateFrontmatter(this.app, file, (fm) => {
      fm["archived"] = false;
    });
    const refreshed = this.app.vault.getAbstractFileByPath(file.path);
    if (refreshed instanceof TFile) {
      const newPath = normalizePath(`${taskFolder}/${file.name}`);
      await this.app.fileManager.renameFile(refreshed, newPath);
    }
  }

  async openInNewLeaf(task: Task, modeOverride?: OpenMode): Promise<void> {
    const file = this.getFile(task);
    if (!file) return;
    await openOrFocusFile(
      this.app,
      file,
      modeOverride ?? this.getOpenMode(),
      this.sidebarCache
    );
  }
}

export function listProjectFolders(app: App, root: string): string[] {
  const folder = app.vault.getAbstractFileByPath(root);
  if (!(folder instanceof TFolder)) return [];
  return folder.children
    .filter((c): c is TFolder => c instanceof TFolder)
    .map((c) => c.name);
}
