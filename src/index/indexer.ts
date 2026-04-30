import { App, EventRef, TAbstractFile, TFile, TFolder } from "obsidian";
import {
  getKind,
  parseMilestone,
  parseProject,
  parseTask,
} from "../schema/frontmatter";
import type { PlannerStore } from "./store";

export class Indexer {
  private app: App;
  private store: PlannerStore;
  private getRoot: () => string;
  private refs: EventRef[] = [];

  constructor(app: App, store: PlannerStore, getRoot: () => string) {
    this.app = app;
    this.store = store;
    this.getRoot = getRoot;
  }

  start(): void {
    this.reindex();
    this.refs.push(
      this.app.metadataCache.on("changed", (file) => {
        if (file instanceof TFile) this.handleFile(file);
      })
    );
    this.refs.push(
      this.app.vault.on("create", (file) => {
        if (file instanceof TFile) this.handleFile(file);
      })
    );
    this.refs.push(
      this.app.vault.on("delete", (file) => {
        this.store.getState().removeByPath(file.path);
      })
    );
    this.refs.push(
      this.app.vault.on("rename", (file, oldPath) => {
        this.store.getState().removeByPath(oldPath);
        if (file instanceof TFile) this.handleFile(file);
      })
    );
  }

  stop(): void {
    for (const ref of this.refs) this.app.metadataCache.offref(ref);
    this.refs = [];
  }

  reindex(): void {
    const root = this.getRoot();
    const folder = this.app.vault.getAbstractFileByPath(root);
    const tasks: ReturnType<typeof parseTask>[] = [];
    const projects: ReturnType<typeof parseProject>[] = [];
    const milestones: ReturnType<typeof parseMilestone>[] = [];

    if (folder instanceof TFolder) {
      this.walk(folder, (file) => {
        const fm = this.app.metadataCache.getFileCache(file)?.frontmatter ?? null;
        const kind = getKind(fm);
        if (!kind) return;
        if (kind === "task") tasks.push(parseTask(file, fm!));
        else if (kind === "project") projects.push(parseProject(file, fm!));
        else if (kind === "milestone") milestones.push(parseMilestone(file, fm!));
      });
    }

    const state = this.store.getState();
    state.setTasks(tasks);
    state.setProjects(projects);
    state.setMilestones(milestones);
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
    if (kind === "task") state.upsertTask(parseTask(file, fm!));
    else if (kind === "project") state.upsertProject(parseProject(file, fm!));
    else if (kind === "milestone") state.upsertMilestone(parseMilestone(file, fm!));
  }

  private walk(folder: TFolder, visit: (file: TFile) => void): void {
    for (const child of folder.children) {
      if (child instanceof TFile && child.extension === "md") visit(child);
      else if (child instanceof TFolder) this.walk(child, visit);
      else if ((child as TAbstractFile) && (child as TFolder).children) {
        this.walk(child as TFolder, visit);
      }
    }
  }
}
