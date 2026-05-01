import { App, normalizePath, TFile } from "obsidian";
import {
  formatDateTimeISO,
  formatLogFilename,
  todayISO,
  toWikilink,
  updateFrontmatter,
} from "../schema/frontmatter";
import type { ProjectService } from "./projectService";
import type { Log } from "../schema/types";
import { openOrFocusFile, OpenMode, SidebarLeafCache } from "../utils/openFile";

export class LogService {
  constructor(
    private app: App,
    private projects: ProjectService,
    private getOpenMode: () => OpenMode = () => "sidebar",
    private sidebarCache?: SidebarLeafCache
  ) {}

  logFolder(projectName: string): string {
    return normalizePath(`${this.projects.projectFolder(projectName)}/logs`);
  }

  logFilePath(projectName: string, filename: string): string {
    return normalizePath(`${this.logFolder(projectName)}/${filename}.md`);
  }

  async createLog(
    projectName: string,
    options: { timestamp?: Date; tags?: string[]; body?: string } = {}
  ): Promise<TFile> {
    if (!projectName.trim()) throw new Error("Project required for log");
    const ts = options.timestamp ?? new Date();
    const filename = formatLogFilename(ts);

    await this.projects.ensureFolder(this.logFolder(projectName));

    let path = this.logFilePath(projectName, filename);
    let suffix = 0;
    while (this.app.vault.getAbstractFileByPath(path)) {
      suffix += 1;
      path = this.logFilePath(projectName, `${filename}-${suffix}`);
    }

    const fmLines: string[] = [
      "---",
      "kind: log",
      `project: "${toWikilink(projectName)}"`,
      `timestamp: ${formatDateTimeISO(ts)}`,
    ];
    if (options.tags && options.tags.length) {
      fmLines.push(`tags: [${options.tags.join(", ")}]`);
    }
    fmLines.push(`created: ${todayISO()}`, "---", "", options.body ?? "", "");

    return await this.app.vault.create(path, fmLines.join("\n"));
  }

  private getFile(log: Log): TFile | null {
    const file = this.app.vault.getAbstractFileByPath(log.path);
    return file instanceof TFile ? file : null;
  }

  async updateField(log: Log, key: string, value: unknown): Promise<void> {
    const file = this.getFile(log);
    if (!file) return;
    await updateFrontmatter(this.app, file, (fm) => {
      if (value == null || value === "") delete fm[key];
      else fm[key] = value;
    });
  }

  async setTags(log: Log, tags: string[]): Promise<void> {
    await this.updateField(log, "tags", tags);
  }

  async setTimestamp(log: Log, ts: Date): Promise<void> {
    const file = this.getFile(log);
    if (!file) return;
    const isoTs = formatDateTimeISO(ts);
    await updateFrontmatter(this.app, file, (fm) => {
      fm["timestamp"] = isoTs;
    });
    // Rename the file to match the new timestamp.
    const projectName = log.project;
    if (!projectName) return;
    const filename = formatLogFilename(ts);
    let newPath = this.logFilePath(projectName, filename);
    if (newPath === file.path) return;
    let suffix = 0;
    while (
      this.app.vault.getAbstractFileByPath(newPath) &&
      newPath !== file.path
    ) {
      suffix += 1;
      newPath = this.logFilePath(projectName, `${filename}-${suffix}`);
    }
    if (newPath !== file.path) {
      await this.app.fileManager.renameFile(file, newPath);
    }
  }

  async setProject(log: Log, projectName: string): Promise<void> {
    const file = this.getFile(log);
    if (!file) return;
    const newFolder = this.logFolder(projectName);
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

  async archive(log: Log): Promise<void> {
    const file = this.getFile(log);
    if (!file || !log.project) return;
    const archiveFolder = normalizePath(
      `${this.projects.projectFolder(log.project)}/archive`
    );
    await this.projects.ensureFolder(archiveFolder);
    const newPath = normalizePath(`${archiveFolder}/${file.name}`);
    await this.app.fileManager.renameFile(file, newPath);
  }

  async openInNewLeaf(log: Log, modeOverride?: OpenMode): Promise<void> {
    const file = this.getFile(log);
    if (!file) return;
    await openOrFocusFile(
      this.app,
      file,
      modeOverride ?? this.getOpenMode(),
      this.sidebarCache
    );
  }
}
