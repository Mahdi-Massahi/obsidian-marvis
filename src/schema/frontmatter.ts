import { App, TFile } from "obsidian";
import type { Task, Project, Milestone, Kind } from "./types";
import { DEFAULT_PROJECT_COLOR } from "./types";

export const WIKILINK_RE = /^\[\[(.+?)(?:\|.+?)?\]\]$/;

export function stripWikilink(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const m = trimmed.match(WIKILINK_RE);
  if (m) return m[1].trim();
  return trimmed;
}

export function toWikilink(name: string): string {
  return `[[${name}]]`;
}

export function asString(value: unknown): string | undefined {
  if (value == null) return undefined;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return undefined;
}

export function asNumber(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

export function asBool(value: unknown, fallback = false): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const v = value.toLowerCase().trim();
    if (v === "true" || v === "yes" || v === "1") return true;
    if (v === "false" || v === "no" || v === "0") return false;
  }
  return fallback;
}

export function asTags(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((v) => (typeof v === "string" ? v.replace(/^#/, "").trim() : ""))
      .filter((v) => v.length > 0);
  }
  if (typeof value === "string") {
    return value
      .split(/[, ]+/)
      .map((v) => v.replace(/^#/, "").trim())
      .filter((v) => v.length > 0);
  }
  return [];
}

export function asDate(value: unknown): string | undefined {
  if (!value) return undefined;
  if (value instanceof Date) {
    return formatDateISO(value);
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    const m = trimmed.match(/^(\d{4}-\d{2}-\d{2})/);
    if (m) return m[1];
    const parsed = new Date(trimmed);
    if (!Number.isNaN(parsed.getTime())) return formatDateISO(parsed);
  }
  return undefined;
}

export function formatDateISO(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function todayISO(): string {
  return formatDateISO(new Date());
}

export function getKind(fm: Record<string, unknown> | null | undefined): Kind | null {
  if (!fm) return null;
  const k = asString(fm["kind"]);
  if (k === "task" || k === "project" || k === "milestone") return k;
  return null;
}

export function fileBaseName(path: string): string {
  const slash = path.lastIndexOf("/");
  const base = slash >= 0 ? path.slice(slash + 1) : path;
  return base.replace(/\.md$/i, "");
}

export function parseTask(file: TFile, fm: Record<string, unknown>): Task {
  return {
    id: file.path,
    path: file.path,
    name: fileBaseName(file.path),
    title: asString(fm["title"]) ?? fileBaseName(file.path),
    project: stripWikilink(fm["project"]),
    milestone: stripWikilink(fm["milestone"]),
    status: asString(fm["status"]) ?? "backlog",
    priority: asString(fm["priority"]),
    due: asDate(fm["due"]),
    start: asDate(fm["start"]),
    tags: asTags(fm["tags"]),
    created: asDate(fm["created"]),
    order: asNumber(fm["order"], 0),
    parent: stripWikilink(fm["parent"]),
    recurrence: asString(fm["recurrence"]),
    archived: asBool(fm["archived"], false) || file.path.includes("/archive/"),
  };
}

export function parseProject(file: TFile, fm: Record<string, unknown>): Project {
  const folder = file.parent?.path ?? "";
  // The project's identifying name is the parent folder, not the `_project.md`
  // file. Tasks reference their project by folder name via wikilinks.
  const folderName = file.parent?.name ?? fileBaseName(file.path);
  return {
    id: file.path,
    path: file.path,
    name: folderName,
    title: asString(fm["title"]) ?? folderName,
    status: (asString(fm["status"]) as Project["status"]) ?? "active",
    color: asString(fm["color"]) ?? DEFAULT_PROJECT_COLOR,
    created: asDate(fm["created"]),
    folder,
  };
}

export function parseMilestone(file: TFile, fm: Record<string, unknown>): Milestone {
  return {
    id: file.path,
    path: file.path,
    name: fileBaseName(file.path),
    title: asString(fm["title"]) ?? fileBaseName(file.path),
    project: stripWikilink(fm["project"]),
    start: asDate(fm["start"]),
    due: asDate(fm["due"]) ?? asDate(fm["end"]),
    status: (asString(fm["status"]) as Milestone["status"]) ?? "planned",
  };
}

export async function updateFrontmatter(
  app: App,
  file: TFile,
  updater: (fm: Record<string, unknown>) => void
): Promise<void> {
  await app.fileManager.processFrontMatter(file, (fm) => {
    updater(fm);
  });
}
