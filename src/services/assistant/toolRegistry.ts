import { App, Notice, TFile } from "obsidian";
import type KanbanPlusPlugin from "../../main";
import type { Event, Log, Milestone, Project, Task } from "../../schema/types";
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
  handler: (args: Record<string, unknown>, ctx: ToolCtx) => Promise<unknown>;
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
      response: { ok: true, summary, data: data as Record<string, unknown> },
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
  return String(v);
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
  name: "list_projects",
  description: "List all known projects with status, color, and folder.",
  parameters: {
    type: "object",
    properties: {
      includeArchived: { type: "boolean" },
    },
  },
  write: false,
  handler: async (args, ctx) => {
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
  handler: async (args, ctx) => {
    const limit = typeof args.limit === "number" ? args.limit : 50;
    const out = tasks(ctx).filter((t) => {
      if (!args.includeArchived && t.archived) return false;
      if (args.project && t.project !== args.project) return false;
      if (args.milestone && t.milestone !== args.milestone) return false;
      if (args.status && t.status !== args.status) return false;
      if (args.priority && t.priority !== args.priority) return false;
      if (args.tag && !t.tags.includes(String(args.tag))) return false;
      if (args.dueBefore && (!t.due || t.due > String(args.dueBefore))) return false;
      if (args.dueAfter && (!t.due || t.due < String(args.dueAfter))) return false;
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
  handler: async (args, ctx) =>
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
  handler: async (args, ctx) =>
    events(ctx)
      .filter((e) => {
        if (args.project && e.project !== args.project) return false;
        return inDateRange(
          e.date,
          args.startISO ? String(args.startISO) : undefined,
          args.endISO ? String(args.endISO) : undefined
        );
      })
      .map((e) => ({
        title: e.title,
        date: e.date,
        time: e.time,
        endTime: e.endTime,
        recurrence: e.recurrence,
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
  handler: async (args, ctx) => {
    const limit = typeof args.limit === "number" ? args.limit : 50;
    const start = args.startISO ? String(args.startISO) : undefined;
    const end = args.endISO ? String(args.endISO) : undefined;
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
  handler: async (args, ctx) => {
    const q = String(args.query ?? "").toLowerCase().trim();
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
  handler: async (args, ctx) => {
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
  handler: async (args, ctx) => {
    const path = String(args.path ?? "");
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
    const parts = [String(args.title ?? "")];
    if (args.project) parts.push(`in ${args.project}`);
    if (args.due) parts.push(`due ${args.due}`);
    if (args.priority) parts.push(`priority ${args.priority}`);
    return `Create task "${parts.join(" — ")}"`;
  },
  handler: async (args, ctx) => {
    const file = await ctx.plugin.taskService.createTask({
      title: String(args.title),
      project: args.project ? String(args.project) : undefined,
      milestone: args.milestone ? String(args.milestone) : undefined,
      status: args.status ? String(args.status) : undefined,
      priority: args.priority ? String(args.priority) : undefined,
      due: args.due ? String(args.due) : undefined,
      start: args.start ? String(args.start) : undefined,
      tags: Array.isArray(args.tags) ? (args.tags as unknown[]).map(String) : undefined,
      body: args.body ? String(args.body) : undefined,
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
    return `Update ${args.path}: ${fields || "(no fields)"}`;
  },
  handler: async (args, ctx) => {
    const path = String(args.path);
    const task = ctx.plugin.store.getState().tasks[path];
    if (!task) throw new Error(`No task at ${path}`);
    if (args.status !== undefined) await ctx.plugin.taskService.setStatus(task, String(args.status));
    if (args.priority !== undefined) await ctx.plugin.taskService.setPriority(task, String(args.priority));
    if (args.due !== undefined) await ctx.plugin.taskService.setDue(task, args.due ? String(args.due) : undefined);
    if (args.start !== undefined) await ctx.plugin.taskService.setStart(task, args.start ? String(args.start) : undefined);
    if (args.milestone !== undefined) {
      await ctx.plugin.taskService.setMilestone(task, args.milestone ? String(args.milestone) : undefined);
    }
    if (args.project !== undefined) {
      await ctx.plugin.taskService.setProject(task, String(args.project));
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
    `Create milestone "${args.title}" in ${args.project}` +
    (args.due ? ` (due ${args.due})` : ""),
  handler: async (args, ctx) => {
    const file = await ctx.plugin.milestoneService.createMilestone(
      String(args.project),
      String(args.title),
      { due: args.due ? String(args.due) : undefined }
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
    `Create project "${args.name}"` + (args.color ? ` (color ${args.color})` : ""),
  handler: async (args, ctx) => {
    const file = await ctx.plugin.projectService.createProject(
      String(args.name),
      args.color ? String(args.color) : undefined
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
    const body = String(args.body ?? "").trim();
    const head = body ? body.slice(0, 60) : "(empty)";
    return `Log to ${args.project}: ${head}${body.length > 60 ? "…" : ""}`;
  },
  handler: async (args, ctx) => {
    const ts = args.timestamp ? new Date(String(args.timestamp)) : new Date();
    const file = await ctx.plugin.logService.createLog(String(args.project), {
      timestamp: isNaN(ts.getTime()) ? new Date() : ts,
      body: args.body ? String(args.body) : undefined,
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
    const parts = [`Event "${args.title}" on ${args.dateISO}`];
    if (args.time) parts.push(`at ${args.time}`);
    if (args.project) parts.push(`in ${args.project}`);
    if (args.recurrence) parts.push(`(${args.recurrence})`);
    return parts.join(" ");
  },
  handler: async (args, ctx) => {
    const file = await ctx.plugin.eventService.createEvent({
      title: String(args.title),
      date: String(args.dateISO),
      time: args.time ? String(args.time) : undefined,
      endTime: args.endTime ? String(args.endTime) : undefined,
      recurrence: args.recurrence ? String(args.recurrence) : undefined,
      project: args.project ? String(args.project) : undefined,
      tags: Array.isArray(args.tags) ? (args.tags as unknown[]).map(String) : undefined,
      body: args.body ? String(args.body) : undefined,
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
  preview: (args) => `Archive ${args.path}`,
  handler: async (args, ctx) => {
    const path = String(args.path);
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
