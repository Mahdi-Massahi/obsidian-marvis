import { App, normalizePath, TFile } from "obsidian";
import {
  todayISO,
  toWikilink,
  updateFrontmatter,
} from "../schema/frontmatter";
import type { ProjectService } from "./projectService";
import type { Event, ResponseStatus } from "../schema/types";
import { openOrFocusFile, OpenMode, SidebarLeafCache } from "../utils/openFile";

export const DEFAULT_EVENT_PROJECT = "_project";

function findFrontmatterEnd(text: string): number {
  if (!text.startsWith("---")) return -1;
  const second = text.indexOf("\n---", 3);
  if (second < 0) return -1;
  // Move past the closing fence and its newline.
  const afterFence = second + 4;
  const newline = text.indexOf("\n", afterFence);
  return newline >= 0 ? newline : afterFence;
}

export interface CreateEventInput {
  title: string;
  date: string;             // YYYY-MM-DD
  time?: string;            // HH:mm
  endTime?: string;         // HH:mm
  recurrence?: string;      // RRULE string
  priority?: string;
  tags?: string[];
  body?: string;
  project?: string;
  milestone?: string;
  extId?: string;
  source?: string;
  responseStatus?: ResponseStatus;
  extHash?: string;
}

export class EventService {
  constructor(
    private app: App,
    private projects: ProjectService,
    private getOpenMode: () => OpenMode = () => "sidebar",
    private sidebarCache?: SidebarLeafCache,
    private allocateCode: () => Promise<string | undefined> = () => Promise.resolve(undefined)
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

  private uniquePath(folder: string, base: string): string {
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
    const path = this.uniquePath(folder, baseName);

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
    if (input.priority) fmLines.push(`priority: ${input.priority}`);
    if (input.milestone) fmLines.push(`milestone: "${toWikilink(input.milestone)}"`);
    if (input.tags && input.tags.length) {
      fmLines.push(`tags: [${input.tags.map((t) => JSON.stringify(t)).join(", ")}]`);
    }
    if (input.extId) fmLines.push(`extId: ${JSON.stringify(input.extId)}`);
    if (input.source) fmLines.push(`source: ${JSON.stringify(input.source)}`);
    if (input.responseStatus) fmLines.push(`responseStatus: ${input.responseStatus}`);
    if (input.extHash) fmLines.push(`extHash: ${JSON.stringify(input.extHash)}`);
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

  async setPriority(event: Event, priority: string | undefined): Promise<void> {
    await this.updateField(event, "priority", priority);
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

  async setRemoteFields(
    event: Event,
    patch: {
      title?: string;
      date?: string;
      time?: string | null;
      endTime?: string | null;
      recurrence?: string | null;
      description?: string | null;
      responseStatus?: ResponseStatus | null;
      extHash?: string | null;
    }
  ): Promise<void> {
    const file = this.getFile(event);
    if (!file) return;
    const newDate = patch.date ?? event.date;
    const newTitle = patch.title ?? event.title;
    await updateFrontmatter(this.app, file, (fm) => {
      if (patch.title !== undefined) fm["title"] = patch.title;
      if (patch.date !== undefined) fm["date"] = patch.date;
      if (patch.time !== undefined) {
        if (patch.time === null || patch.time === "") delete fm["time"];
        else fm["time"] = patch.time;
      }
      if (patch.endTime !== undefined) {
        if (patch.endTime === null || patch.endTime === "") delete fm["endTime"];
        else fm["endTime"] = patch.endTime;
      }
      if (patch.recurrence !== undefined) {
        if (patch.recurrence === null || patch.recurrence === "") delete fm["recurrence"];
        else fm["recurrence"] = patch.recurrence;
      }
      if (patch.responseStatus !== undefined) {
        if (patch.responseStatus === null) delete fm["responseStatus"];
        else fm["responseStatus"] = patch.responseStatus;
      }
      if (patch.extHash !== undefined) {
        if (patch.extHash === null || patch.extHash === "") delete fm["extHash"];
        else fm["extHash"] = patch.extHash;
      }
    });
    // Rename the file if date or title changed.
    const projectName = event.project ?? DEFAULT_EVENT_PROJECT;
    const folder = this.eventFolder(projectName);
    const baseName = `${newDate}-${this.sanitizeFileName(newTitle)}`;
    let newPath = normalizePath(`${folder}/${baseName}.md`);
    if (newPath !== file.path) {
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
    if (patch.description !== undefined) {
      const refreshed = this.app.vault.getAbstractFileByPath(newPath !== file.path ? newPath : file.path);
      if (refreshed instanceof TFile) {
        const original = await this.app.vault.read(refreshed);
        const fmEnd = findFrontmatterEnd(original);
        if (fmEnd >= 0) {
          const head = original.slice(0, fmEnd);
          const newBody = (patch.description ?? "").trimEnd();
          await this.app.vault.modify(refreshed, `${head}\n${newBody}\n`);
        }
      }
    }
  }

  findByExtId(source: string, extId: string, allEvents: Event[]): Event | undefined {
    return allEvents.find((e) => e.source === source && e.extId === extId);
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
