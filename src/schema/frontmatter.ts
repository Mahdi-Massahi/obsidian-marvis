import { App, TFile } from "obsidian";
import type { Task, Project, Milestone, Log, Event, Habit, HabitFrequency, HabitState, Kind } from "./types";
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
  if (
    k === "task" ||
    k === "project" ||
    k === "milestone" ||
    k === "log" ||
    k === "event" ||
    k === "habit"
  )
    return k;
  return null;
}

export function asHabitFrequency(value: unknown): HabitFrequency {
  const s = asString(value)?.toLowerCase().trim();
  if (s === "daily" || s === "weekly" || s === "monthly") return s;
  return "daily";
}

export function asHabitState(value: unknown): HabitState {
  const s = asString(value)?.toLowerCase().trim();
  if (s === "active" || s === "paused" || s === "archived") return s;
  return "active";
}

export function asDateTime(value: unknown): string | undefined {
  if (!value) return undefined;
  if (value instanceof Date) {
    return formatDateTimeISO(value);
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    // YYYY-MM-DD-HH-mm[-ss] or YYYY-MM-DDTHH:mm[:ss] or YYYY-MM-DD HH:mm[:ss]
    const compact = trimmed.match(
      /^(\d{4})-(\d{2})-(\d{2})[-T ](\d{2})[-:](\d{2})(?:[-:](\d{2}))?/
    );
    if (compact) {
      const ss = compact[6] ?? "00";
      return `${compact[1]}-${compact[2]}-${compact[3]}T${compact[4]}:${compact[5]}:${ss}`;
    }
    const parsed = new Date(trimmed);
    if (!Number.isNaN(parsed.getTime())) return formatDateTimeISO(parsed);
  }
  return undefined;
}

export function formatDateTimeISO(date: Date): string {
  const y = date.getFullYear();
  const mo = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const h = String(date.getHours()).padStart(2, "0");
  const mi = String(date.getMinutes()).padStart(2, "0");
  const s = String(date.getSeconds()).padStart(2, "0");
  return `${y}-${mo}-${d}T${h}:${mi}:${s}`;
}

export function formatLogFilename(date: Date): string {
  const y = date.getFullYear();
  const mo = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const h = String(date.getHours()).padStart(2, "0");
  const mi = String(date.getMinutes()).padStart(2, "0");
  const s = String(date.getSeconds()).padStart(2, "0");
  return `${y}-${mo}-${d}-${h}-${mi}-${s}`;
}

export function filenameToTimestamp(name: string): string | undefined {
  // New: YYYY-MM-DD-HH-mm-ss; legacy: YYYY-MM-DD-HH-mm.
  const withSec = name.match(/^(\d{4})-(\d{2})-(\d{2})-(\d{2})-(\d{2})-(\d{2})$/);
  if (withSec) {
    return `${withSec[1]}-${withSec[2]}-${withSec[3]}T${withSec[4]}:${withSec[5]}:${withSec[6]}`;
  }
  const noSec = name.match(/^(\d{4})-(\d{2})-(\d{2})-(\d{2})-(\d{2})$/);
  if (noSec) return `${noSec[1]}-${noSec[2]}-${noSec[3]}T${noSec[4]}:${noSec[5]}:00`;
  return undefined;
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
    code: asString(fm["code"]),
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
    code: asString(fm["code"]),
  };
}

export function parseLog(file: TFile, fm: Record<string, unknown>): Log {
  const base = fileBaseName(file.path);
  const ts = asDateTime(fm["timestamp"]) ?? filenameToTimestamp(base) ?? formatDateTimeISO(new Date());
  return {
    id: file.path,
    path: file.path,
    name: base,
    project: stripWikilink(fm["project"]),
    habit: stripWikilink(fm["habit"]),
    timestamp: ts,
    tags: asTags(fm["tags"]),
    created: asDate(fm["created"]),
    code: asString(fm["code"]),
  };
}

export function parseEvent(file: TFile, fm: Record<string, unknown>): Event {
  const base = fileBaseName(file.path);
  const date = asDate(fm["date"]) ?? extractDateFromFilename(base) ?? formatDateISO(new Date());
  return {
    id: file.path,
    path: file.path,
    name: base,
    project: stripWikilink(fm["project"]),
    milestone: stripWikilink(fm["milestone"]),
    title: asString(fm["title"]) ?? humanizeFromFilename(base),
    date,
    time: asTimeOfDay(fm["time"]),
    endTime: asTimeOfDay(fm["endTime"]),
    recurrence: asString(fm["recurrence"]),
    priority: asString(fm["priority"]),
    tags: asTags(fm["tags"]),
    extId: asString(fm["extId"]),
    source: asString(fm["source"]),
    responseStatus: asResponseStatus(fm["responseStatus"]),
    extHash: asString(fm["extHash"]),
    created: asDate(fm["created"]),
    code: asString(fm["code"]),
    archived: asBool(fm["archived"], false) || file.path.includes("/archive/"),
  };
}

function asResponseStatus(raw: unknown): import("./types").ResponseStatus | undefined {
  if (typeof raw !== "string") return undefined;
  const s = raw.toLowerCase();
  if (s === "accepted" || s === "needsaction" || s === "tentative" || s === "declined" || s === "unknown") {
    return s === "needsaction" ? "needsAction" : (s);
  }
  return undefined;
}

function extractDateFromFilename(base: string): string | undefined {
  const m = base.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : undefined;
}

function humanizeFromFilename(base: string): string {
  const stripped = base.replace(/^\d{4}-\d{2}-\d{2}-?/, "");
  return stripped.replace(/[-_]+/g, " ").trim() || base;
}

export function asTimeOfDay(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const m = value.trim().match(/^(\d{1,2}):(\d{2})/);
  if (!m) return undefined;
  const h = Math.min(23, Number(m[1]));
  return `${h.toString().padStart(2, "0")}:${m[2]}`;
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
    created: asDate(fm["created"]),
    code: asString(fm["code"]),
  };
}

export function parseHabit(file: TFile, fm: Record<string, unknown>): Habit {
  const stateRaw = asHabitState(fm["state"]);
  const archivedInPath = file.path.includes("/archive/");
  const archived = archivedInPath || asBool(fm["archived"], false) || stateRaw === "archived";
  const state: HabitState = archived ? "archived" : stateRaw;
  const target = Math.max(1, Math.round(asNumber(fm["target"], 1)));
  return {
    id: file.path,
    path: file.path,
    name: fileBaseName(file.path),
    title: asString(fm["title"]) ?? fileBaseName(file.path),
    project: stripWikilink(fm["project"]) ?? "",
    milestone: stripWikilink(fm["milestone"]),
    frequency: asHabitFrequency(fm["frequency"]),
    target,
    goal: asString(fm["goal"]),
    state,
    archived,
    tags: asTags(fm["tags"]),
    created: asDate(fm["created"]),
    order: asNumber(fm["order"], 0),
    code: asString(fm["code"]),
  };
}

export async function updateFrontmatter(
  app: App,
  file: TFile,
  updater: (fm: Record<string, unknown>) => void
): Promise<void> {
  await app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
    updater(fm);
  });
}
