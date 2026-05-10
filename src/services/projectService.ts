import { App, normalizePath, TFile, TFolder } from "obsidian";
import { todayISO, updateFrontmatter } from "../schema/frontmatter";
import { DEFAULT_PROJECT_COLOR, PROJECT_PALETTE } from "../schema/types";
import type { Project } from "../schema/types";
import { openOrFocusFile, OpenMode, SidebarLeafCache } from "../utils/openFile";

export class ProjectService {
  constructor(
    private app: App,
    private getRoot: () => string,
    private getOpenMode: () => OpenMode = () => "sidebar",
    private sidebarCache?: SidebarLeafCache,
    private getSkillTemplate: () => string = () => "",
    private allocateCode: () => Promise<string | undefined> = () => Promise.resolve(undefined)
  ) {}

  projectFolder(name: string): string {
    return normalizePath(`${this.getRoot()}/${name}`);
  }

  projectFilePath(name: string): string {
    return normalizePath(`${this.projectFolder(name)}/_project.md`);
  }

  skillsFolder(name: string): string {
    return normalizePath(`${this.projectFolder(name)}/skills`);
  }

  skillFilePath(projectName: string, skillName: string): string {
    const safe = skillName.endsWith(".md") ? skillName : `${skillName}.md`;
    return normalizePath(`${this.skillsFolder(projectName)}/${safe}`);
  }

  async writeSkillFile(
    projectName: string,
    skillName: string,
    body: string,
    overwrite: boolean
  ): Promise<{ written: boolean; path: string }> {
    await this.ensureFolder(this.skillsFolder(projectName));
    const path = this.skillFilePath(projectName, skillName);
    const existing = this.app.vault.getAbstractFileByPath(path);
    if (existing instanceof TFile) {
      if (!overwrite) return { written: false, path };
      await this.app.vault.modify(existing, body);
      return { written: true, path };
    }
    await this.app.vault.create(path, body);
    return { written: true, path };
  }

  async applySkillTemplateToAll(): Promise<{ created: number; skipped: number }> {
    const root = this.getRoot();
    const folder = this.app.vault.getAbstractFileByPath(root);
    if (!(folder instanceof TFolder)) return { created: 0, skipped: 0 };
    const template = this.getSkillTemplate();
    let created = 0;
    let skipped = 0;
    for (const child of folder.children) {
      if (!(child instanceof TFolder)) continue;
      // Only treat as project if a _project.md exists.
      const projectFile = this.app.vault.getAbstractFileByPath(
        normalizePath(`${child.path}/_project.md`)
      );
      if (!(projectFile instanceof TFile)) continue;
      const r = await this.writeSkillFile(child.name, "marvis", template, false);
      if (r.written) created += 1;
      else skipped += 1;
    }
    return { created, skipped };
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
    await this.ensureFolder(`${folder.path}/skills`);

    const filePath = this.projectFilePath(safeName);
    const existing = this.app.vault.getAbstractFileByPath(filePath);
    if (existing instanceof TFile) {
      // Make sure the skill file is present even on re-runs.
      await this.writeSkillFile(safeName, "marvis", this.getSkillTemplate(), false);
      return existing;
    }

    const palette = PROJECT_PALETTE;
    const chosenColor =
      color ?? palette[Math.floor(Math.random() * palette.length)] ?? DEFAULT_PROJECT_COLOR;
    const code = await this.allocateCode();

    const fmLines = [
      "---",
      "kind: project",
      "status: active",
      `color: "${chosenColor}"`,
      `created: ${todayISO()}`,
    ];
    if (code) fmLines.push(`code: ${code}`);
    fmLines.push("---");
    const body = [
      ...fmLines,
      "",
      `# ${safeName}`,
      "",
      "## Goals",
      "",
      "## Notes",
      "",
    ].join("\n");

    const created = await this.app.vault.create(filePath, body);
    await this.writeSkillFile(safeName, "marvis", this.getSkillTemplate(), false);
    return created;
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

  async deleteProject(project: Project): Promise<void> {
    const folderPath = this.projectFolder(project.name);
    const folder = this.app.vault.getAbstractFileByPath(folderPath);
    if (!folder) return;
    await this.app.fileManager.trashFile(folder);
  }

  async openInNewLeaf(project: Project, modeOverride?: OpenMode): Promise<void> {
    const file = this.getFile(project);
    if (!file) return;
    await openOrFocusFile(
      this.app,
      file,
      modeOverride ?? this.getOpenMode(),
      this.sidebarCache
    );
  }
}
