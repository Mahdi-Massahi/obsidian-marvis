import { App, EventRef, TFile, TFolder } from "obsidian";
import {
  getKind,
  parseEvent,
  parseHabit,
  parseLog,
  parseMilestone,
  parseProject,
  parseTask,
} from "../schema/frontmatter";
import type { PlannerStore } from "./store";

// Coalesce bursts of vault events (Apple Calendar sync, iCloud bursts, vault
// reload) into a single flush. Each flush triggers ~one React render across
// subscribed views; without this, hundreds of cascading renders per second
// freeze the UI on real-world syncs.
const FLUSH_DELAY_MS = 60;

export class Indexer {
  private app: App;
  private store: PlannerStore;
  private getRoot: () => string;
  private refs: EventRef[] = [];

  private pendingChanges = new Map<string, TFile>();
  private pendingDeletes = new Set<string>();
  private flushHandle: number | null = null;

  constructor(app: App, store: PlannerStore, getRoot: () => string) {
    this.app = app;
    this.store = store;
    this.getRoot = getRoot;
  }

  start(): void {
    void this.reindex();
    this.refs.push(
      this.app.metadataCache.on("changed", (file) => {
        if (file instanceof TFile) this.queueChange(file);
      })
    );
    this.refs.push(
      this.app.vault.on("create", (file) => {
        if (file instanceof TFile) this.queueChange(file);
      })
    );
    this.refs.push(
      this.app.vault.on("delete", (file) => {
        this.queueDelete(file.path);
      })
    );
    this.refs.push(
      this.app.vault.on("rename", (file, oldPath) => {
        this.queueDelete(oldPath);
        if (file instanceof TFile) this.queueChange(file);
      })
    );
  }

  stop(): void {
    for (const ref of this.refs) this.app.metadataCache.offref(ref);
    this.refs = [];
    if (this.flushHandle !== null) {
      window.clearTimeout(this.flushHandle);
      this.flushHandle = null;
    }
    this.pendingChanges.clear();
    this.pendingDeletes.clear();
  }

  private queueChange(file: TFile): void {
    this.pendingDeletes.delete(file.path);
    this.pendingChanges.set(file.path, file);
    this.scheduleFlush();
  }

  private queueDelete(path: string): void {
    this.pendingChanges.delete(path);
    this.pendingDeletes.add(path);
    this.scheduleFlush();
  }

  private scheduleFlush(): void {
    if (this.flushHandle !== null) return;
    this.flushHandle = window.setTimeout(() => {
      this.flushHandle = null;
      this.flushPending();
    }, FLUSH_DELAY_MS);
  }

  private flushPending(): void {
    const deletes = this.pendingDeletes;
    const changes = this.pendingChanges;
    if (deletes.size === 0 && changes.size === 0) return;
    this.pendingDeletes = new Set();
    this.pendingChanges = new Map();
    const state = this.store.getState();
    for (const path of deletes) state.removeByPath(path);
    for (const file of changes.values()) this.handleFile(file);
  }

  async reindex(): Promise<void> {
    const root = this.getRoot();
    const folder = this.app.vault.getAbstractFileByPath(root);
    const tasks: ReturnType<typeof parseTask>[] = [];
    const projects: ReturnType<typeof parseProject>[] = [];
    const milestones: ReturnType<typeof parseMilestone>[] = [];
    const logs: ReturnType<typeof parseLog>[] = [];
    const events: ReturnType<typeof parseEvent>[] = [];
    const habits: ReturnType<typeof parseHabit>[] = [];
    // Logs only have a body — no title in frontmatter — so we load their
    // bodies eagerly before the first render to avoid the "Log @ HH:MM" →
    // excerpt flicker on Calendar/Timeline. Tasks/events have a stable title
    // in frontmatter so their body load can stay async.
    const logFiles: TFile[] = [];
    const otherBodyFiles: TFile[] = [];

    if (folder instanceof TFolder) {
      this.walk(folder, (file) => {
        const fm = this.app.metadataCache.getFileCache(file)?.frontmatter ?? null;
        const kind = getKind(fm);
        if (!kind) return;
        if (kind === "task") {
          const t = parseTask(file, fm!);
          t.updated = file.stat.mtime;
          tasks.push(t);
          otherBodyFiles.push(file);
        } else if (kind === "project") projects.push(parseProject(file, fm!));
        else if (kind === "milestone") milestones.push(parseMilestone(file, fm!));
        else if (kind === "log") {
          logs.push(parseLog(file, fm!));
          logFiles.push(file);
        } else if (kind === "event") {
          events.push(parseEvent(file, fm!));
          otherBodyFiles.push(file);
        } else if (kind === "habit") {
          habits.push(parseHabit(file, fm!));
        }
      });
    }

    const state = this.store.getState();
    state.setTasks(tasks);
    state.setProjects(projects);
    state.setMilestones(milestones);
    state.setLogs(logs);
    state.setEvents(events);
    state.setHabits(habits);

    // Eager: log bodies first (small, drives the visible label).
    await this.loadExcerpts(logFiles);
    // Async second pass — load remaining body excerpts.
    void this.loadExcerpts(otherBodyFiles);
  }

  private handleFile(file: TFile): void {
    if (file.extension !== "md") return;
    if (!file.path.startsWith(this.getRoot() + "/") && file.path !== this.getRoot()) {
      this.store.getState().removeByPath(file.path);
      return;
    }
    const fm = this.app.metadataCache.getFileCache(file)?.frontmatter ?? null;
    const kind = getKind(fm);
    const state = this.store.getState();
    if (!kind) {
      state.removeByPath(file.path);
      return;
    }
    if (kind === "task") {
      const task = parseTask(file, fm!);
      task.updated = file.stat.mtime;
      state.upsertTask(task);
      void this.loadExcerptForFile(file);
    } else if (kind === "project") state.upsertProject(parseProject(file, fm!));
    else if (kind === "milestone") state.upsertMilestone(parseMilestone(file, fm!));
    else if (kind === "log") {
      const log = parseLog(file, fm!);
      state.upsertLog(log);
      void this.loadExcerptForFile(file);
    } else if (kind === "event") {
      const event = parseEvent(file, fm!);
      state.upsertEvent(event);
      void this.loadExcerptForFile(file);
    } else if (kind === "habit") {
      state.upsertHabit(parseHabit(file, fm!));
    }
  }

  private async loadExcerpts(files: TFile[]): Promise<void> {
    for (const file of files) {
      await this.loadExcerptForFile(file);
    }
  }

  private async loadExcerptForFile(file: TFile): Promise<void> {
    const { excerpt, body } = await this.readBody(file);
    const state = this.store.getState();
    const existingTask = state.tasks[file.path];
    if (existingTask) {
      if (existingTask.excerpt === excerpt && existingTask.body === body) return;
      state.upsertTask({ ...existingTask, excerpt, body });
      return;
    }
    const existingLog = state.logs[file.path];
    if (existingLog) {
      if (existingLog.excerpt === excerpt && existingLog.body === body) return;
      state.upsertLog({ ...existingLog, excerpt, body });
      return;
    }
    const existingEvent = state.events[file.path];
    if (existingEvent) {
      if (existingEvent.excerpt === excerpt && existingEvent.body === body) return;
      state.upsertEvent({ ...existingEvent, excerpt, body });
    }
  }

  private async readBody(
    file: TFile
  ): Promise<{ excerpt?: string; body?: string }> {
    try {
      const content = await this.app.vault.cachedRead(file);
      const fmMatch = content.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
      const rawBody = fmMatch ? content.slice(fmMatch[0].length) : content;
      const body = rawBody.trim() ? rawBody.trim().slice(0, 8000) : undefined;
      let excerpt: string | undefined;
      for (const rawLine of rawBody.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line) continue;
        if (line.startsWith("#")) continue;
        const cleaned = line
          .replace(/^[-*+>]\s+/, "")
          .replace(/^\[[ x]\]\s+/i, "")
          .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
          .replace(/[*_`~]/g, "")
          .trim();
        if (!cleaned) continue;
        excerpt = cleaned.slice(0, 200);
        break;
      }
      return { excerpt, body };
    } catch {
      return {};
    }
  }

  private walk(folder: TFolder, visit: (file: TFile) => void): void {
    for (const child of folder.children) {
      if (child instanceof TFile && child.extension === "md") visit(child);
      else if (child instanceof TFolder) {
        if (child.name === "skills") continue;
        if (child.name === "_chats") continue;
        this.walk(child, visit);
      }
    }
  }
}
