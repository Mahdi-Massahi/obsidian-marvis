import { App, normalizePath, TFile } from "obsidian";
import {
  todayISO,
  toWikilink,
  updateFrontmatter,
} from "../schema/frontmatter";
import type { ProjectService } from "./projectService";
import type { Event } from "../schema/types";
import { openOrFocusFile, OpenMode, SidebarLeafCache } from "../utils/openFile";

export const DEFAULT_EVENT_PROJECT = "_project";

export interface CreateEventInput {
  title: string;
  date: string;             // YYYY-MM-DD
  time?: string;            // HH:mm
  endTime?: string;         // HH:mm
  recurrence?: string;      // RRULE string
  tags?: string[];
  body?: string;
  project?: string;
  milestone?: string;
  extId?: string;
  source?: string;
}

export class EventService {
  constructor(
    private app: App,
    private projects: ProjectService,
    private getOpenMode: () => OpenMode = () => "sidebar",
    private sidebarCache?: SidebarLeafCache,
    private allocateCode: () => Promise<string | undefined> = async () => undefined
  ) {}

  eventFolder(projectName: string): string {
    return normalizePath(`${this.projects.projectFolder(projectName)}/events`);
  }

  attachmentsFolder(projectName: string): string {
    return normalizePath(`${this.eventFolder(projectName)}/attachments`);
  }

  private sanitizeFileName(name: string): string {
    return name
      .replace(/[\\/:*?"<>|#^[\]]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 60) || "Event";
  }

  private async uniquePath(folder: string, base: string): Promise<string> {
    let candidate = normalizePath(`${folder}/${base}.md`);
    let n = 2;
    while (this.app.vault.getAbstractFileByPath(candidate)) {
      candidate = normalizePath(`${folder}/${base} ${n}.md`);
      n += 1;
    }
    return candidate;
  }

  async createEvent(input: CreateEventInput): Promise<TFile> {
    if (!input.title.trim()) throw new Error("Title required for event");
    if (!input.date) throw new Error("Date required for event");

    const projectName = input.project ?? DEFAULT_EVENT_PROJECT;
    await this.projects.createProject(projectName);
    const folder = this.eventFolder(projectName);
    await this.projects.ensureFolder(folder);

    const baseName = `${input.date}-${this.sanitizeFileName(input.title)}`;
    const path = await this.uniquePath(folder, baseName);

    const code = await this.allocateCode();
    const fmLines: string[] = [
      "---",
      "kind: event",
      `project: "${toWikilink(projectName)}"`,
      `title: ${JSON.stringify(input.title)}`,
      `date: ${input.date}`,
    ];
    if (input.time) fmLines.push(`time: "${input.time}"`);
    if (input.endTime) fmLines.push(`endTime: "${input.endTime}"`);
    if (input.recurrence) fmLines.push(`recurrence: ${JSON.stringify(input.recurrence)}`);
    if (input.milestone) fmLines.push(`milestone: "${toWikilink(input.milestone)}"`);
    if (input.tags && input.tags.length) {
      fmLines.push(`tags: [${input.tags.map((t) => JSON.stringify(t)).join(", ")}]`);
    }
    if (input.extId) fmLines.push(`extId: ${JSON.stringify(input.extId)}`);
    if (input.source) fmLines.push(`source: ${JSON.stringify(input.source)}`);
    if (code) fmLines.push(`code: ${code}`);
    fmLines.push(`created: ${todayISO()}`, "---", "", input.body ?? "", "");

    return await this.app.vault.create(path, fmLines.join("\n"));
  }

  private getFile(event: Event): TFile | null {
    const file = this.app.vault.getAbstractFileByPath(event.path);
    return file instanceof TFile ? file : null;
  }

  async updateField(event: Event, key: string, value: unknown): Promise<void> {
    const file = this.getFile(event);
    if (!file) return;
    await updateFrontmatter(this.app, file, (fm) => {
      if (value == null || value === "") delete fm[key];
      else fm[key] = value;
    });
  }

  async setTags(event: Event, tags: string[]): Promise<void> {
    await this.updateField(event, "tags", tags);
  }

  async addTags(event: Event, newTags: string[]): Promise<void> {
    const merged = Array.from(new Set([...event.tags, ...newTags]));
    await this.setTags(event, merged);
  }

  async setDate(event: Event, isoDate: string): Promise<void> {
    const file = this.getFile(event);
    if (!file) return;
    await updateFrontmatter(this.app, file, (fm) => {
      fm["date"] = isoDate;
    });
    const projectName = event.project ?? DEFAULT_EVENT_PROJECT;
    const baseName = `${isoDate}-${this.sanitizeFileName(event.title)}`;
    const folder = this.eventFolder(projectName);
    let newPath = normalizePath(`${folder}/${baseName}.md`);
    if (newPath === file.path) return;
    let n = 2;
    while (
      this.app.vault.getAbstractFileByPath(newPath) &&
      newPath !== file.path
    ) {
      newPath = normalizePath(`${folder}/${baseName} ${n}.md`);
      n += 1;
    }
    if (newPath !== file.path) {
      await this.app.fileManager.renameFile(file, newPath);
    }
  }

  async setRecurrence(event: Event, rrule: string | null): Promise<void> {
    await this.updateField(event, "recurrence", rrule);
  }

  async setProject(event: Event, projectName: string): Promise<void> {
    const file = this.getFile(event);
    if (!file) return;
    const newFolder = this.eventFolder(projectName);
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

  async archive(event: Event): Promise<void> {
    const file = this.getFile(event);
    if (!file) return;
    const projectName = event.project ?? DEFAULT_EVENT_PROJECT;
    const archiveFolder = normalizePath(
      `${this.projects.projectFolder(projectName)}/archive`
    );
    await this.projects.ensureFolder(archiveFolder);
    const newPath = normalizePath(`${archiveFolder}/${file.name}`);
    await this.app.fileManager.renameFile(file, newPath);
  }

  async deleteEvent(event: Event): Promise<void> {
    const file = this.getFile(event);
    if (!file) return;
    await this.app.fileManager.trashFile(file);
  }

  async openInNewLeaf(event: Event, modeOverride?: OpenMode): Promise<void> {
    const file = this.getFile(event);
    if (!file) return;
    await openOrFocusFile(
      this.app,
      file,
      modeOverride ?? this.getOpenMode(),
      this.sidebarCache
    );
  }
}
