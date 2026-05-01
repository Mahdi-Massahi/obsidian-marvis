import { App, normalizePath, TFile } from "obsidian";
import { todayISO, toWikilink, updateFrontmatter } from "../schema/frontmatter";
import type { ProjectService } from "./projectService";
import type { Milestone } from "../schema/types";
import { openOrFocusFile, OpenMode, SidebarLeafCache } from "../utils/openFile";

export class MilestoneService {
  constructor(
    private app: App,
    private projects: ProjectService,
    private getOpenMode: () => OpenMode = () => "sidebar",
    private sidebarCache?: SidebarLeafCache
  ) {}

  milestoneFolder(projectName: string): string {
    return normalizePath(`${this.projects.projectFolder(projectName)}/milestones`);
  }

  milestoneFilePath(projectName: string, name: string): string {
    return normalizePath(`${this.milestoneFolder(projectName)}/${name}.md`);
  }

  async createMilestone(
    projectName: string,
    name: string,
    options: { due?: string } = {}
  ): Promise<TFile> {
    const safeName = name.trim();
    if (!safeName) throw new Error("Milestone name required");

    await this.projects.ensureFolder(this.milestoneFolder(projectName));
    const path = this.milestoneFilePath(projectName, safeName);
    const existing = this.app.vault.getAbstractFileByPath(path);
    if (existing instanceof TFile) return existing;

    const fmLines: string[] = [
      "---",
      "kind: milestone",
      `project: "${toWikilink(projectName)}"`,
      "status: planned",
      `created: ${todayISO()}`,
    ];
    if (options.due) fmLines.push(`due: ${options.due}`);
    fmLines.push("---", "", "## Goals", "", "## Scope", "", "## Notes", "");

    return await this.app.vault.create(path, fmLines.join("\n"));
  }

  private getFile(milestone: Milestone): TFile | null {
    const file = this.app.vault.getAbstractFileByPath(milestone.path);
    return file instanceof TFile ? file : null;
  }

  async updateField(milestone: Milestone, key: string, value: unknown): Promise<void> {
    const file = this.getFile(milestone);
    if (!file) return;
    await updateFrontmatter(this.app, file, (fm) => {
      if (value == null || value === "") delete fm[key];
      else fm[key] = value;
    });
  }

  async setStatus(milestone: Milestone, status: Milestone["status"]): Promise<void> {
    await this.updateField(milestone, "status", status);
  }

  async setDue(milestone: Milestone, due: string | undefined): Promise<void> {
    await this.updateField(milestone, "due", due);
  }

  async setStart(milestone: Milestone, start: string | undefined): Promise<void> {
    await this.updateField(milestone, "start", start);
  }

  async setProject(milestone: Milestone, projectName: string): Promise<void> {
    const file = this.getFile(milestone);
    if (!file) return;
    const newFolder = this.milestoneFolder(projectName);
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

  async openInNewLeaf(milestone: Milestone, modeOverride?: OpenMode): Promise<void> {
    const file = this.getFile(milestone);
    if (!file) return;
    await openOrFocusFile(
      this.app,
      file,
      modeOverride ?? this.getOpenMode(),
      this.sidebarCache
    );
  }
}
