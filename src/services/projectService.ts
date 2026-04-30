import { App, normalizePath, TFile, TFolder } from "obsidian";
import { todayISO, updateFrontmatter } from "../schema/frontmatter";
import { DEFAULT_PROJECT_COLOR, PROJECT_PALETTE } from "../schema/types";
import type { Project } from "../schema/types";

export class ProjectService {
  constructor(private app: App, private getRoot: () => string) {}

  projectFolder(name: string): string {
    return normalizePath(`${this.getRoot()}/${name}`);
  }

  projectFilePath(name: string): string {
    return normalizePath(`${this.projectFolder(name)}/_project.md`);
  }

  async ensureFolder(path: string): Promise<TFolder> {
    const existing = this.app.vault.getAbstractFileByPath(path);
    if (existing instanceof TFolder) return existing;
    if (existing) throw new Error(`Path exists but is not a folder: ${path}`);
    await this.app.vault.createFolder(path);
    const created = this.app.vault.getAbstractFileByPath(path);
    if (created instanceof TFolder) return created;
    throw new Error(`Failed to create folder ${path}`);
  }

  async createProject(name: string, color?: string): Promise<TFile> {
    const safeName = name.trim();
    if (!safeName) throw new Error("Project name required");

    await this.ensureFolder(this.getRoot());
    const folder = await this.ensureFolder(this.projectFolder(safeName));
    await this.ensureFolder(`${folder.path}/milestones`);
    await this.ensureFolder(`${folder.path}/tasks`);
    await this.ensureFolder(`${folder.path}/archive`);

    const filePath = this.projectFilePath(safeName);
    const existing = this.app.vault.getAbstractFileByPath(filePath);
    if (existing instanceof TFile) return existing;

    const palette = PROJECT_PALETTE;
    const chosenColor =
      color ?? palette[Math.floor(Math.random() * palette.length)] ?? DEFAULT_PROJECT_COLOR;

    const body = [
      "---",
      "kind: project",
      "status: active",
      `color: "${chosenColor}"`,
      `created: ${todayISO()}`,
      "---",
      "",
      `# ${safeName}`,
      "",
      "## Goals",
      "",
      "## Notes",
      "",
    ].join("\n");

    return await this.app.vault.create(filePath, body);
  }

  private getFile(project: Project): TFile | null {
    const file = this.app.vault.getAbstractFileByPath(project.path);
    return file instanceof TFile ? file : null;
  }

  async updateField(project: Project, key: string, value: unknown): Promise<void> {
    const file = this.getFile(project);
    if (!file) return;
    await updateFrontmatter(this.app, file, (fm) => {
      if (value == null || value === "") delete fm[key];
      else fm[key] = value;
    });
  }

  async setStatus(project: Project, status: Project["status"]): Promise<void> {
    await this.updateField(project, "status", status);
  }

  async setColor(project: Project, color: string): Promise<void> {
    await this.updateField(project, "color", color);
  }

  async openInNewLeaf(project: Project): Promise<void> {
    const file = this.getFile(project);
    if (!file) return;
    const leaf = this.app.workspace.getLeaf("tab");
    await leaf.openFile(file);
  }
}
