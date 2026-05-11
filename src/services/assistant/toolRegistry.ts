import { App, Notice, TFile } from "obsidian";
import type KanbanPlusPlugin from "../../main";
import type { Event, Log, Milestone, Project, Task } from "../../schema/types";
import { stripWikilink } from "../../schema/frontmatter";
import {
  AssistantConfirmModal,
  ContextSection,
} from "../../views/shared/AssistantConfirmModal";

export interface FunctionCall {
  id?: string;
  name: string;
  args: Record<string, unknown>;
}

export interface FunctionResponseItem {
  id?: string;
  name: string;
  response: Record<string, unknown>;
}

export interface ToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  write: boolean;
  preview?: (args: Record<string, unknown>) => string;
  handler: (args: Record<string, unknown>, ctx: ToolCtx) => unknown;
}

export interface ToolCtx {
  app: App;
  plugin: KanbanPlusPlugin;
}

export interface DispatchOptions {
  onPropose?: (call: FunctionCall, preview: string) => void;
  onResolve?: (call: FunctionCall, summary: string, ok: boolean) => void;
}

const TOOLS: ToolDef[] = [];

function register(def: ToolDef): void {
  TOOLS.push(def);
}

export function buildFunctionDeclarations(): Array<{
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}> {
  return TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    parameters: t.parameters,
  }));
}

export async function dispatch(
  call: FunctionCall,
  ctx: ToolCtx,
  opts: DispatchOptions = {}
): Promise<FunctionResponseItem> {
  const def = TOOLS.find((t) => t.name === call.name);
  if (!def) {
    return {
      id: call.id,
      name: call.name,
      response: { ok: false, error: `Unknown tool: ${call.name}` },
    };
  }
  const args = call.args ?? {};
  const previewText = def.preview ? def.preview(args) : describeArgs(args);
  if (def.write) {
    opts.onPropose?.(call, previewText);
    const context = buildContext(def.name, args, ctx);
    const accepted = await confirmWrite(ctx.app, def.name, previewText, args, context);
    if (!accepted) {
      const summary = "Declined by user";
      opts.onResolve?.(call, summary, false);
      return {
        id: call.id,
        name: call.name,
        response: { ok: false, declined: true, summary },
      };
    }
  }
  try {
    const data = await def.handler(args, ctx);
    const summary = summarizeResult(def.name, args, data);
    opts.onResolve?.(call, summary, true);
    return {
      id: call.id,
      name: call.name,
      response: { ok: true, summary, data: data },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    opts.onResolve?.(call, `Failed: ${msg}`, false);
    return {
      id: call.id,
      name: call.name,
      response: { ok: false, error: msg },
    };
  }
}

function confirmWrite(
  app: App,
  toolName: string,
  preview: string,
  args: Record<string, unknown>,
  context: ContextSection[]
): Promise<boolean> {
  return new Promise((resolve) => {
    const modal = new AssistantConfirmModal(app, {
      title: prettyToolName(toolName),
      preview,
      args,
      toolName,
      context,
      onAccept: () => resolve(true),
      onDecline: () => resolve(false),
    });
    modal.open();
  });
}

// Pull rich context for write tools so the user can see what's actually being
// changed: for `update_task`/`archive_item` we look up the existing item by
// `path` and surface its title/project/status/etc. For `create_*` we surface
// the resolved project info if any.
function buildContext(
  toolName: string,
  args: Record<string, unknown>,
  ctx: ToolCtx
): ContextSection[] {
  const sections: ContextSection[] = [];
  const path = typeof args.path === "string" ? args.path : null;

  if (path) {
    const found = findItemByPath(ctx, path);
    if (found) {
      const item = found.item as unknown as Record<string, unknown>;
      const rows: Array<[string, string]> = [];
      const fields: Array<[string, string]> = [
        ["title", "Title"],
        ["name", "Name"],
        ["project", "Project"],
        ["milestone", "Milestone"],
        ["status", "Status"],
        ["priority", "Priority"],
        ["due", "Due"],
        ["start", "Start"],
        ["timestamp", "Timestamp"],
        ["date", "Date"],
        ["time", "Time"],
        ["recurrence", "Recurrence"],
        ["color", "Color"],
        ["archived", "Archived"],
      ];
      for (const [key, label] of fields) {
        const v = item[key];
        if (v == null || v === "") continue;
        rows.push([label, formatItemValue(v)]);
      }
      const tagsRaw = item.tags;
      if (Array.isArray(tagsRaw) && tagsRaw.length > 0) {
        rows.push(["Tags", (tagsRaw as unknown[]).map(String).join(", ")]);
      }
      const excerpt = typeof item.excerpt === "string" ? item.excerpt : "";
      if (excerpt) rows.push(["Excerpt", excerpt]);
      rows.push(["Path", path]);
      sections.push({ heading: `Current ${found.kind}`, rows });
    }
  }

  if (toolName === "create_task" || toolName === "create_log" || toolName === "create_event" || toolName === "create_milestone") {
    const projectName = typeof args.project === "string" ? args.project : null;
    if (projectName) {
      const project = Object.values(ctx.plugin.store.getState().projects).find(
        (p) => p.name === projectName
      );
      if (project) {
        const rows: Array<[string, string]> = [
          ["Name", project.name],
          ["Status", project.status],
        ];
        if (project.color) rows.push(["Color", project.color]);
        rows.push(["Path", project.path]);
        sections.push({ heading: "Target project", rows });
      } else {
        sections.push({
          heading: "Target project",
          rows: [["Note", `'${projectName}' will be created if it doesn't exist`]],
        });
      }
    }
  }

  return sections;
}

function formatItemValue(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (Array.isArray(v)) return v.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(", ");
  if (typeof v === "object") return JSON.stringify(v);
  if (typeof v === "string") return v;
  return JSON.stringify(v) ?? "";
}

// Safe stringifier for tool arguments (`unknown` from JSON). The model
// occasionally hands us a non-string value where we expected one — fall
// back to JSON instead of leaking '[object Object]' into a log/notice.
function asStr(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return JSON.stringify(v) ?? "";
}

function prettyToolName(name: string): string {
  return name
    .replace(/_/g, " ")
    .replace(/^./, (c) => c.toUpperCase());
}

function describeArgs(args: Record<string, unknown>): string {
  const entries = Object.entries(args).filter(([, v]) => v !== undefined && v !== null);
  if (entries.length === 0) return "no arguments";
  return entries
    .map(([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`)
    .join(", ");
}

function summarizeResult(
  name: string,
  _args: Record<string, unknown>,
  data: unknown
): string {
  if (data && typeof data === "object" && "path" in (data as Record<string, unknown>)) {
    const path = (data as { path: string }).path;
    return `${prettyToolName(name)} → ${path}`;
  }
  if (Array.isArray(data)) return `${prettyToolName(name)} → ${data.length} item(s)`;
  return prettyToolName(name);
}

// ─────────────────────────────────────────────────────────────────────────────
// Read helpers
// ─────────────────────────────────────────────────────────────────────────────

function projects(ctx: ToolCtx): Project[] {
  return Object.values(ctx.plugin.store.getState().projects);
}

function tasks(ctx: ToolCtx): Task[] {
  return Object.values(ctx.plugin.store.getState().tasks);
}

function milestones(ctx: ToolCtx): Milestone[] {
  return Object.values(ctx.plugin.store.getState().milestones);
}

function logs(ctx: ToolCtx): Log[] {
  return Object.values(ctx.plugin.store.getState().logs);
}

function events(ctx: ToolCtx): Event[] {
  return Object.values(ctx.plugin.store.getState().events);
}

function inDateRange(
  iso: string | undefined,
  start: string | undefined,
  end: string | undefined
): boolean {
  if (!iso) return false;
  if (start && iso < start) return false;
  if (end && iso > end) return false;
  return true;
}

function todayString(): string {
  const d = new Date();
  const pad = (n: number) => (n < 10 ? `0${n}` : String(n));
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function findItemByPath(
  ctx: ToolCtx,
  path: string
): { kind: "task" | "log" | "event" | "milestone" | "project"; item: Task | Log | Event | Milestone | Project } | null {
  const s = ctx.plugin.store.getState();
  if (s.tasks[path]) return { kind: "task", item: s.tasks[path] };
  if (s.logs[path]) return { kind: "log", item: s.logs[path] };
  if (s.events[path]) return { kind: "event", item: s.events[path] };
  if (s.milestones[path]) return { kind: "milestone", item: s.milestones[path] };
  if (s.projects[path]) return { kind: "project", item: s.projects[path] };
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Read tools
// ─────────────────────────────────────────────────────────────────────────────

register({
  name: "get_active_file",
  description:
    "Return the file currently focused in Obsidian. Use this to resolve deictic references — 'this task', 'the current note', 'here', 'that log' — into a specific item. If the focused file is a Marvis note (task/log/event/milestone/project), returns its kind plus key fields; for any other file returns kind 'other' with path and basename; returns { active: null } when no file is focused.",
  parameters: { type: "object", properties: {} },
  write: false,
  handler: (_args, ctx) => {
    const file = ctx.app.workspace.getActiveFile();
    if (!file) return { active: null };
    const found = findItemByPath(ctx, file.path);
    if (!found) {
      return { active: { kind: "other", path: file.path, basename: file.basename } };
    }
    const item = found.item as unknown as Record<string, unknown>;
    const out: Record<string, unknown> = {
      kind: found.kind,
      path: file.path,
      basename: file.basename,
    };
    const fields = [
      "title",
      "name",
      "project",
      "milestone",
      "status",
      "priority",
      "due",
      "start",
      "timestamp",
      "date",
      "time",
    ];
    for (const k of fields) {
      const v = item[k];
      if (v != null && v !== "") out[k] = v;
    }
    const tagsRaw = item.tags;
    if (Array.isArray(tagsRaw) && tagsRaw.length > 0) {
      out.tags = (tagsRaw as unknown[]).map(String);
    }
    return { active: out };
  },
});

register({
  name: "list_projects",
  description: "List all known projects with status, color, and folder.",
  parameters: {
    type: "object",
    properties: {
      includeArchived: { type: "boolean" },
    },
  },
  write: false,
  handler: (args, ctx) => {
    const includeArchived = !!args.includeArchived;
    return projects(ctx)
      .filter((p) => includeArchived || p.status !== "archived")
      .map((p) => ({
        name: p.name,
        title: p.title,
        status: p.status,
        color: p.color,
        path: p.path,
      }));
  },
});

register({
  name: "list_tasks",
  description:
    "List tasks. All filters are optional. Returns the matching tasks with their fields.",
  parameters: {
    type: "object",
    properties: {
      project: { type: "string" },
      milestone: { type: "string" },
      status: { type: "string", description: "status id, e.g. 'todo' or 'in-progress'" },
      priority: { type: "string", description: "priority id, e.g. 'high'" },
      tag: { type: "string" },
      dueBefore: { type: "string", description: "ISO date YYYY-MM-DD" },
      dueAfter: { type: "string", description: "ISO date YYYY-MM-DD" },
      includeArchived: { type: "boolean" },
      limit: { type: "number" },
    },
  },
  write: false,
  handler: (args, ctx) => {
    const limit = typeof args.limit === "number" ? args.limit : 50;
    const out = tasks(ctx).filter((t) => {
      if (!args.includeArchived && t.archived) return false;
      if (args.project && t.project !== args.project) return false;
      if (args.milestone && t.milestone !== args.milestone) return false;
      if (args.status && t.status !== args.status) return false;
      if (args.priority && t.priority !== args.priority) return false;
      if (args.tag && !t.tags.includes(asStr(args.tag))) return false;
      if (args.dueBefore && (!t.due || t.due > asStr(args.dueBefore))) return false;
      if (args.dueAfter && (!t.due || t.due < asStr(args.dueAfter))) return false;
      return true;
    });
    return out.slice(0, limit).map((t) => ({
      title: t.title,
      project: t.project,
      milestone: t.milestone,
      status: t.status,
      priority: t.priority,
      due: t.due,
      start: t.start,
      tags: t.tags,
      archived: t.archived,
      path: t.path,
      excerpt: t.excerpt,
    }));
  },
});

register({
  name: "list_milestones",
  description: "List milestones, optionally filtered by project or status.",
  parameters: {
    type: "object",
    properties: {
      project: { type: "string" },
      status: { type: "string" },
    },
  },
  write: false,
  handler: (args, ctx) =>
    milestones(ctx)
      .filter((m) => {
        if (args.project && m.project !== args.project) return false;
        if (args.status && m.status !== args.status) return false;
        return true;
      })
      .map((m) => ({
        name: m.name,
        title: m.title,
        project: m.project,
        status: m.status,
        start: m.start,
        due: m.due,
        path: m.path,
      })),
});

register({
  name: "list_events",
  description: "List events in a date range. Dates are YYYY-MM-DD.",
  parameters: {
    type: "object",
    properties: {
      startISO: { type: "string", description: "YYYY-MM-DD inclusive" },
      endISO: { type: "string", description: "YYYY-MM-DD inclusive" },
      project: { type: "string" },
    },
  },
  write: false,
  handler: (args, ctx) =>
    events(ctx)
      .filter((e) => {
        if (args.project && e.project !== args.project) return false;
        return inDateRange(
          e.date,
          args.startISO ? asStr(args.startISO) : undefined,
          args.endISO ? asStr(args.endISO) : undefined
        );
      })
      .map((e) => ({
        title: e.title,
        date: e.date,
        time: e.time,
        endTime: e.endTime,
        recurrence: e.recurrence,
        priority: e.priority,
        project: e.project,
        responseStatus: e.responseStatus,
        path: e.path,
      })),
});

register({
  name: "list_logs",
  description: "List logs in a date range (timestamps are ISO).",
  parameters: {
    type: "object",
    properties: {
      startISO: { type: "string" },
      endISO: { type: "string" },
      project: { type: "string" },
      limit: { type: "number" },
    },
  },
  write: false,
  handler: (args, ctx) => {
    const limit = typeof args.limit === "number" ? args.limit : 50;
    const start = args.startISO ? asStr(args.startISO) : undefined;
    const end = args.endISO ? asStr(args.endISO) : undefined;
    const out = logs(ctx).filter((l) => {
      if (args.project && l.project !== args.project) return false;
      const day = (l.timestamp ?? "").slice(0, 10);
      return inDateRange(day, start, end);
    });
    out.sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));
    return out.slice(0, limit).map((l) => ({
      timestamp: l.timestamp,
      project: l.project,
      tags: l.tags,
      excerpt: l.excerpt,
      path: l.path,
    }));
  },
});

register({
  name: "search_vault",
  description:
    "Substring search across titles, excerpts, and tags of all known items.",
  parameters: {
    type: "object",
    required: ["query"],
    properties: {
      query: { type: "string" },
      kinds: {
        type: "array",
        items: {
          type: "string",
          enum: ["task", "project", "milestone", "log", "event"],
        },
      },
      limit: { type: "number" },
    },
  },
  write: false,
  handler: (args, ctx) => {
    const q = asStr(args.query).toLowerCase().trim();
    if (!q) return [];
    const limit = typeof args.limit === "number" ? args.limit : 20;
    const wantedRaw = Array.isArray(args.kinds)
      ? (args.kinds as unknown[]).map((x) => String(x))
      : null;
    const wanted = wantedRaw && wantedRaw.length ? new Set(wantedRaw) : null;
    const matches: Array<{ kind: string; title: string; path: string; excerpt?: string }> = [];
    const want = (k: string) => !wanted || wanted.has(k);
    const test = (...fields: Array<string | undefined>) =>
      fields.some((f) => f && f.toLowerCase().includes(q));

    if (want("task")) {
      for (const t of tasks(ctx)) {
        if (test(t.title, t.excerpt, ...(t.tags ?? []))) {
          matches.push({ kind: "task", title: t.title, path: t.path, excerpt: t.excerpt });
        }
      }
    }
    if (want("project")) {
      for (const p of projects(ctx)) {
        if (test(p.name, p.title)) matches.push({ kind: "project", title: p.title, path: p.path });
      }
    }
    if (want("milestone")) {
      for (const m of milestones(ctx)) {
        if (test(m.name, m.title)) matches.push({ kind: "milestone", title: m.title, path: m.path });
      }
    }
    if (want("log")) {
      for (const l of logs(ctx)) {
        if (test(l.timestamp, l.excerpt, ...(l.tags ?? []))) {
          matches.push({ kind: "log", title: l.timestamp, path: l.path, excerpt: l.excerpt });
        }
      }
    }
    if (want("event")) {
      for (const e of events(ctx)) {
        if (test(e.title, e.excerpt, ...(e.tags ?? []))) {
          matches.push({ kind: "event", title: e.title, path: e.path, excerpt: e.excerpt });
        }
      }
    }
    return matches.slice(0, limit);
  },
});

register({
  name: "get_planning_snapshot",
  description:
    "Get a high-level snapshot: tasks due today, overdue tasks, upcoming events, and active projects. " +
    "Use this when the user asks open-ended planning questions like 'what's on my plate' or 'where are we'.",
  parameters: {
    type: "object",
    properties: {
      horizonDays: { type: "number", description: "Days ahead to look. Default 7." },
    },
  },
  write: false,
  handler: (args, ctx) => {
    const horizon = typeof args.horizonDays === "number" ? args.horizonDays : 7;
    const today = todayString();
    const horizonDate = new Date();
    horizonDate.setDate(horizonDate.getDate() + horizon);
    const pad = (n: number) => (n < 10 ? `0${n}` : String(n));
    const horizonISO = `${horizonDate.getFullYear()}-${pad(horizonDate.getMonth() + 1)}-${pad(horizonDate.getDate())}`;

    const allTasks = tasks(ctx).filter((t) => !t.archived);
    const dueToday = allTasks.filter((t) => t.due === today);
    const overdue = allTasks.filter((t) => t.due && t.due < today && t.status !== "done");
    const dueSoon = allTasks.filter(
      (t) => t.due && t.due > today && t.due <= horizonISO && t.status !== "done"
    );
    const inProgress = allTasks.filter((t) => t.status === "in-progress" || t.status === "review");
    const activeProjects = projects(ctx).filter((p) => p.status === "active");
    const upcomingEvents = events(ctx).filter((e) =>
      inDateRange(e.date, today, horizonISO)
    );
    const upcomingMilestones = milestones(ctx).filter(
      (m) => m.due && m.due >= today && m.due <= horizonISO && m.status !== "done"
    );

    return {
      today,
      horizon: horizonISO,
      counts: {
        dueToday: dueToday.length,
        overdue: overdue.length,
        dueSoon: dueSoon.length,
        inProgress: inProgress.length,
        activeProjects: activeProjects.length,
        upcomingEvents: upcomingEvents.length,
        upcomingMilestones: upcomingMilestones.length,
      },
      dueToday: dueToday.map((t) => ({ title: t.title, project: t.project, status: t.status, path: t.path })),
      overdue: overdue.slice(0, 20).map((t) => ({
        title: t.title,
        project: t.project,
        due: t.due,
        path: t.path,
      })),
      dueSoon: dueSoon.slice(0, 20).map((t) => ({
        title: t.title,
        project: t.project,
        due: t.due,
        path: t.path,
      })),
      inProgress: inProgress.slice(0, 20).map((t) => ({
        title: t.title,
        project: t.project,
        path: t.path,
      })),
      activeProjects: activeProjects.map((p) => ({ name: p.name, color: p.color })),
      upcomingEvents: upcomingEvents.slice(0, 20).map((e) => ({
        title: e.title,
        date: e.date,
        time: e.time,
        responseStatus: e.responseStatus,
      })),
      upcomingMilestones: upcomingMilestones.map((m) => ({
        name: m.name,
        project: m.project,
        due: m.due,
      })),
    };
  },
});

register({
  name: "get_item",
  description: "Read an item's title, frontmatter fields, and full body by its path.",
  parameters: {
    type: "object",
    required: ["path"],
    properties: {
      path: { type: "string" },
    },
  },
  write: false,
  handler: (args, ctx) => {
    const path = asStr(args.path);
    const found = findItemByPath(ctx, path);
    if (!found) throw new Error(`No item at path ${path}`);
    return { kind: found.kind, item: found.item };
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// Write tools
// ─────────────────────────────────────────────────────────────────────────────

register({
  name: "create_task",
  description: "Create a new task. project defaults to 'Inbox'.",
  parameters: {
    type: "object",
    required: ["title"],
    properties: {
      title: { type: "string" },
      project: { type: "string" },
      milestone: { type: "string" },
      status: { type: "string" },
      priority: { type: "string" },
      due: { type: "string", description: "YYYY-MM-DD" },
      start: { type: "string", description: "YYYY-MM-DD" },
      tags: { type: "array", items: { type: "string" } },
      body: {
        type: "string",
        description:
          "Markdown body of the task. Capture any notes, context, acceptance criteria, links, or details the user mentioned. Don't leave empty when the user gave content beyond the title.",
      },
    },
  },
  write: true,
  preview: (args) => {
    const parts = [asStr(args.title)];
    if (args.project) parts.push(`in ${asStr(args.project)}`);
    if (args.due) parts.push(`due ${asStr(args.due)}`);
    if (args.priority) parts.push(`priority ${asStr(args.priority)}`);
    return `Create task "${parts.join(" — ")}"`;
  },
  handler: async (args, ctx) => {
    const file = await ctx.plugin.taskService.createTask({
      title: asStr(args.title),
      project: args.project ? asStr(args.project) : undefined,
      milestone: args.milestone ? asStr(args.milestone) : undefined,
      status: args.status ? asStr(args.status) : undefined,
      priority: args.priority ? asStr(args.priority) : undefined,
      due: args.due ? asStr(args.due) : undefined,
      start: args.start ? asStr(args.start) : undefined,
      tags: Array.isArray(args.tags) ? (args.tags as unknown[]).map(String) : undefined,
      body: args.body ? asStr(args.body) : undefined,
    });
    return { path: file.path };
  },
});

register({
  name: "update_task",
  description: "Update fields of an existing task by path.",
  parameters: {
    type: "object",
    required: ["path"],
    properties: {
      path: { type: "string" },
      status: { type: "string" },
      priority: { type: "string" },
      due: { type: "string" },
      start: { type: "string" },
      milestone: { type: "string" },
      project: { type: "string" },
      tags: { type: "array", items: { type: "string" } },
      archived: { type: "boolean" },
    },
  },
  write: true,
  preview: (args) => {
    const fields = Object.entries(args)
      .filter(([k, v]) => k !== "path" && v !== undefined && v !== null)
      .map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`)
      .join(", ");
    return `Update ${asStr(args.path)}: ${fields || "(no fields)"}`;
  },
  handler: async (args, ctx) => {
    const path = asStr(args.path);
    const task = ctx.plugin.store.getState().tasks[path];
    if (!task) throw new Error(`No task at ${path}`);
    if (args.status !== undefined) await ctx.plugin.taskService.setStatus(task, asStr(args.status));
    if (args.priority !== undefined) await ctx.plugin.taskService.setPriority(task, asStr(args.priority));
    if (args.due !== undefined) await ctx.plugin.taskService.setDue(task, args.due ? asStr(args.due) : undefined);
    if (args.start !== undefined) await ctx.plugin.taskService.setStart(task, args.start ? asStr(args.start) : undefined);
    if (args.milestone !== undefined) {
      await ctx.plugin.taskService.setMilestone(task, args.milestone ? asStr(args.milestone) : undefined);
    }
    if (args.project !== undefined) {
      await ctx.plugin.taskService.setProject(task, asStr(args.project));
    }
    if (Array.isArray(args.tags)) {
      await ctx.plugin.taskService.setTags(task, (args.tags as unknown[]).map(String));
    }
    if (args.archived === true) await ctx.plugin.taskService.archive(task);
    if (args.archived === false && task.archived) await ctx.plugin.taskService.unarchive(task);
    return { path };
  },
});

register({
  name: "append_to_note",
  description:
    "Append markdown content to the body of an existing note (task, log, event, milestone, project, or any other vault file). Frontmatter is left untouched — use update_task or similar tools for field changes. The note must already exist; pass `path` as a vault path (e.g. 'Planner/Foo/logs/2026-05-11-09-00-00.md'), a wikilink ('[[My note]]'), or a bare basename and the tool resolves it. If `heading` is given, content is appended at the end of that `## heading` section (created at the end of the body if it doesn't exist yet).",
  parameters: {
    type: "object",
    required: ["path", "content"],
    properties: {
      path: {
        type: "string",
        description:
          "Vault path, wikilink, or bare basename of an existing note.",
      },
      content: {
        type: "string",
        description: "Markdown content to append.",
      },
      heading: {
        type: "string",
        description:
          "Optional level-2 heading to append under (without the leading '## '). Created at the end of the body if missing.",
      },
    },
  },
  write: true,
  preview: (args) => {
    const content = asStr(args.content).trim();
    const preview = content
      ? content.slice(0, 60) + (content.length > 60 ? "…" : "")
      : "(empty)";
    const where = args.heading ? ` under "## ${asStr(args.heading)}"` : "";
    return `Append to ${asStr(args.path)}${where}: ${preview}`;
  },
  handler: async (args, ctx) => {
    const rawPath = asStr(args.path);
    const file = resolveNoteFile(ctx, rawPath);
    if (!file) throw new Error(`No note found for "${rawPath}"`);
    const content = asStr(args.content);
    if (!content.trim()) throw new Error("content cannot be empty");
    const heading = args.heading ? asStr(args.heading).trim() : undefined;

    const original = await ctx.app.vault.read(file);
    const updated = appendToNoteBody(original, content, heading);
    await ctx.app.vault.modify(file, updated);
    return { path: file.path };
  },
});

register({
  name: "create_milestone",
  description: "Create a new milestone in a project.",
  parameters: {
    type: "object",
    required: ["title", "project"],
    properties: {
      title: { type: "string", description: "Milestone name" },
      project: { type: "string" },
      due: { type: "string" },
    },
  },
  write: true,
  preview: (args) =>
    `Create milestone "${asStr(args.title)}" in ${asStr(args.project)}` +
    (args.due ? ` (due ${asStr(args.due)})` : ""),
  handler: async (args, ctx) => {
    const file = await ctx.plugin.milestoneService.createMilestone(
      asStr(args.project),
      asStr(args.title),
      { due: args.due ? asStr(args.due) : undefined }
    );
    return { path: file.path };
  },
});

register({
  name: "create_project",
  description: "Create a new project (if it does not already exist).",
  parameters: {
    type: "object",
    required: ["name"],
    properties: {
      name: { type: "string" },
      color: { type: "string" },
    },
  },
  write: true,
  preview: (args) =>
    `Create project "${asStr(args.name)}"` + (args.color ? ` (color ${asStr(args.color)})` : ""),
  handler: async (args, ctx) => {
    const file = await ctx.plugin.projectService.createProject(
      asStr(args.name),
      args.color ? asStr(args.color) : undefined
    );
    return { path: file.path };
  },
});

register({
  name: "create_log",
  description: "Append a timestamped log entry to a project.",
  parameters: {
    type: "object",
    required: ["project"],
    properties: {
      project: { type: "string" },
      body: {
        type: "string",
        description:
          "Markdown body of the log entry — the actual content. Write what happened, decisions made, or observations the user shared, in the user's voice. This is the main payload of a log; don't leave it empty.",
      },
      tags: { type: "array", items: { type: "string" } },
      timestamp: {
        type: "string",
        description: "ISO datetime; defaults to now",
      },
    },
  },
  write: true,
  preview: (args) => {
    const body = asStr(args.body).trim();
    const head = body ? body.slice(0, 60) : "(empty)";
    return `Log to ${asStr(args.project)}: ${head}${body.length > 60 ? "…" : ""}`;
  },
  handler: async (args, ctx) => {
    const ts = args.timestamp ? new Date(asStr(args.timestamp)) : new Date();
    const file = await ctx.plugin.logService.createLog(asStr(args.project), {
      timestamp: isNaN(ts.getTime()) ? new Date() : ts,
      body: args.body ? asStr(args.body) : undefined,
      tags: Array.isArray(args.tags) ? (args.tags as unknown[]).map(String) : undefined,
    });
    return { path: file.path };
  },
});

register({
  name: "create_event",
  description: "Create a calendar event.",
  parameters: {
    type: "object",
    required: ["title", "dateISO"],
    properties: {
      title: { type: "string" },
      dateISO: { type: "string", description: "YYYY-MM-DD" },
      time: { type: "string", description: "HH:mm" },
      endTime: { type: "string", description: "HH:mm" },
      recurrence: { type: "string", description: "RRULE string (RFC 5545)" },
      priority: { type: "string", description: "priority id, e.g. 'high'" },
      project: { type: "string" },
      tags: { type: "array", items: { type: "string" } },
      body: {
        type: "string",
        description:
          "Markdown body of the event — notes, agenda, location details, attendees, links, or any context the user mentioned. Don't leave empty when the user gave content beyond the title.",
      },
    },
  },
  write: true,
  preview: (args) => {
    const parts = [`Event "${asStr(args.title)}" on ${asStr(args.dateISO)}`];
    if (args.time) parts.push(`at ${asStr(args.time)}`);
    if (args.priority) parts.push(`priority ${asStr(args.priority)}`);
    if (args.project) parts.push(`in ${asStr(args.project)}`);
    if (args.recurrence) parts.push(`(${asStr(args.recurrence)})`);
    return parts.join(" ");
  },
  handler: async (args, ctx) => {
    const file = await ctx.plugin.eventService.createEvent({
      title: asStr(args.title),
      date: asStr(args.dateISO),
      time: args.time ? asStr(args.time) : undefined,
      endTime: args.endTime ? asStr(args.endTime) : undefined,
      recurrence: args.recurrence ? asStr(args.recurrence) : undefined,
      priority: args.priority ? asStr(args.priority) : undefined,
      project: args.project ? asStr(args.project) : undefined,
      tags: Array.isArray(args.tags) ? (args.tags as unknown[]).map(String) : undefined,
      body: args.body ? asStr(args.body) : undefined,
    });
    return { path: file.path };
  },
});

register({
  name: "archive_item",
  description: "Archive a task, milestone, log, or event by path.",
  parameters: {
    type: "object",
    required: ["path"],
    properties: {
      path: { type: "string" },
    },
  },
  write: true,
  preview: (args) => `Archive ${asStr(args.path)}`,
  handler: async (args, ctx) => {
    const path = asStr(args.path);
    const found = findItemByPath(ctx, path);
    if (!found) throw new Error(`No item at ${path}`);
    if (found.kind === "task") await ctx.plugin.taskService.archive(found.item as Task);
    else if (found.kind === "milestone") await ctx.plugin.milestoneService.archive(found.item as Milestone);
    else if (found.kind === "log") await ctx.plugin.logService.archive(found.item as Log);
    else if (found.kind === "event") await ctx.plugin.eventService.archive(found.item as Event);
    else throw new Error(`Cannot archive ${found.kind}`);
    return { path };
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// Note-body mutation helpers (used by append_to_note)
// ─────────────────────────────────────────────────────────────────────────────

function resolveNoteFile(ctx: ToolCtx, raw: string): TFile | null {
  if (!raw) return null;
  const direct = ctx.app.vault.getAbstractFileByPath(raw);
  if (direct instanceof TFile) return direct;
  const stripped = stripWikilink(raw) ?? raw;
  const dest = ctx.app.metadataCache.getFirstLinkpathDest(stripped, "");
  return dest ?? null;
}

function findFrontmatterEnd(text: string): number {
  if (!text.startsWith("---")) return -1;
  const second = text.indexOf("\n---", 3);
  if (second < 0) return -1;
  const afterFence = second + 4;
  const newline = text.indexOf("\n", afterFence);
  return newline >= 0 ? newline : afterFence;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function appendToNoteBody(
  original: string,
  content: string,
  heading: string | undefined
): string {
  const fmEnd = findFrontmatterEnd(original);
  const headPart = fmEnd >= 0 ? original.slice(0, fmEnd) : "";
  const body = fmEnd >= 0 ? original.slice(fmEnd + 1) : original;

  const toAppend = content.trim();
  const bodyTrimmed = body.replace(/\s+$/, "");

  let newBody: string;
  if (!heading) {
    newBody = bodyTrimmed ? `${bodyTrimmed}\n\n${toAppend}` : toAppend;
  } else {
    const headingLine = `## ${heading}`;
    const re = new RegExp(
      `(^|\\n)${escapeRegex(headingLine)}[ \\t]*(?=\\n|$)`
    );
    const m = re.exec(body);
    if (!m) {
      newBody = bodyTrimmed
        ? `${bodyTrimmed}\n\n${headingLine}\n\n${toAppend}`
        : `${headingLine}\n\n${toAppend}`;
    } else {
      const headingStart = m.index + m[1].length;
      const headingEnd = headingStart + headingLine.length;
      const remainder = body.slice(headingEnd);
      const nextHeading = remainder.match(/\n##\s/);
      const sectionEnd =
        headingEnd + (nextHeading?.index ?? remainder.length);
      const before = body.slice(0, sectionEnd).replace(/\s+$/, "");
      const after = body.slice(sectionEnd).replace(/^\s+/, "");
      newBody = after
        ? `${before}\n\n${toAppend}\n\n${after}`
        : `${before}\n\n${toAppend}`;
    }
  }

  return headPart ? `${headPart}\n${newBody}\n` : `${newBody}\n`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Notice helper for handlers (currently unused but available for handlers
// that want to nudge the user)
// ─────────────────────────────────────────────────────────────────────────────
export function notice(text: string): void {
  new Notice(text);
}

// Helps callers know whether a given file path is in the planner tree.
export function isPlannerPath(file: TFile, root: string): boolean {
  return file.path.startsWith(root + "/");
}
