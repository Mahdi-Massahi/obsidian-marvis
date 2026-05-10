import { Platform } from "obsidian";
import {
  CalendarProvider,
  RemoteCalendar,
  RemoteEvent,
  RemoteResponseStatus,
  TokenSet,
} from "./types";

// Apple Calendar lives behind Node built-ins (`child_process`, `os`, `fs`,
// `path`). Importing those at the top of the module would crash on Obsidian
// Mobile, where Capacitor has no Node runtime — and that crash takes the
// whole plugin bundle down. Instead we lazy-require them inside the methods
// that actually run (all gated by `isAvailable()`), so this file is safe to
// import on every platform.

interface NodeBindings {
  execFileAsync: (cmd: string, args: string[], opts?: { maxBuffer?: number }) =>
    Promise<{ stdout: string; stderr: string }>;
  existsSync: (p: string) => boolean;
  calendarDb: string;
}

let cachedNode: NodeBindings | null = null;

function loadNode(): NodeBindings {
  if (cachedNode) return cachedNode;
  // Use indirect `require` so esbuild leaves the calls intact (these modules
  // are in the `external` list) and they're only executed at runtime on
  // platforms where they exist. The `globalThis` access is deliberate — we
  // need Node's runtime require, not anything DOM-related.
  // eslint-disable-next-line obsidianmd/prefer-active-doc
  const req: NodeJS.Require = (globalThis as unknown as { require: NodeJS.Require }).require;
  if (typeof req !== "function") {
    throw new Error("Apple Calendar provider requires desktop Obsidian.");
  }
  const cp = req("child_process") as typeof import("child_process");
  const util = req("util") as typeof import("util");
  const os = req("os") as typeof import("os");
  const path = req("path") as typeof import("path");
  const fs = req("fs") as typeof import("fs");
  cachedNode = {
    execFileAsync: util.promisify(cp.execFile),
    existsSync: fs.existsSync,
    // Calendar.app's local store. We read with -readonly so concurrent use
    // by Calendar.app itself is safe (the DB uses WAL mode).
    calendarDb: path.join(
      os.homedir(),
      "Library/Group Containers/group.com.apple.calendar/Calendar.sqlitedb"
    ),
  };
  return cachedNode;
}

// Apple's CFAbsoluteTime epoch: 2001-01-01T00:00:00Z. SQLite REAL columns
// store seconds since that. Add this to convert to Unix epoch seconds.
const CF_EPOCH_OFFSET = 978307200;

const SYNTHETIC_ACCOUNT = {
  id: "local-macos",
  displayName: "macOS Calendar",
};

const SYNTHETIC_TOKEN: TokenSet = {
  accessToken: "macos-local",
  expiresAt: Number.MAX_SAFE_INTEGER,
  account: SYNTHETIC_ACCOUNT,
};

export const macCalendarProvider: CalendarProvider = {
  id: "macos",
  label: "Apple Calendar",

  isAvailable(): boolean {
    if (!Platform.isDesktopApp) return false;
    // Don't trip over the lazy require on non-desktop / non-darwin: only ask
    // the platform if the desktop guard already passed. The `globalThis`
    // access here is to Node's `process`, not the DOM.
    // eslint-disable-next-line obsidianmd/prefer-active-doc
    const p = (globalThis as unknown as { process?: { platform?: string } }).process;
    return p?.platform === "darwin";
  },

  async connect(): Promise<TokenSet> {
    const node = loadNode();
    if (!node.existsSync(node.calendarDb)) {
      throw new Error(
        "Calendar.app database not found. Open Calendar.app once so macOS provisions it, then retry."
      );
    }
    // Probe — fails with a useful error if the DB exists but isn't readable.
    await runSqlite<{ n: number }>("SELECT 1 AS n");
    return SYNTHETIC_TOKEN;
  },

  async listCalendars(): Promise<RemoteCalendar[]> {
    const rows = await runSqlite<{
      UUID: string;
      title: string | null;
      color: string | null;
      type: string | null;
      self_identity_email: string | null;
      owner_identity_email: string | null;
    }>(
      `SELECT UUID, title, color, type, self_identity_email, owner_identity_email
       FROM Calendar
       WHERE UUID IS NOT NULL AND UUID <> ''
         AND title IS NOT NULL
         AND (type IS NULL OR type NOT IN ('birthdays'))
       ORDER BY title COLLATE NOCASE`
    );
    return rows.map((r) => ({
      id: r.UUID,
      displayName: r.title ?? "(unnamed)",
      color: normalizeHexColor(r.color),
      account: r.self_identity_email ?? r.owner_identity_email ?? undefined,
    }));
  },

  async listEvents(
    _token: TokenSet,
    calendarId: string,
    rangeStart: Date,
    rangeEnd: Date
  ): Promise<RemoteEvent[]> {
    const startCf = (rangeStart.getTime() / 1000) - CF_EPOCH_OFFSET;
    const endCf = (rangeEnd.getTime() / 1000) - CF_EPOCH_OFFSET;
    const escapedUuid = calendarId.replace(/'/g, "''");
    const rows = await runSqlite<RawRow>(
      `SELECT
         ci.UUID AS uuid,
         ci.summary AS summary,
         ci.start_date AS start_cf,
         ci.end_date AS end_cf,
         ci.start_tz AS start_tz,
         ci.all_day AS all_day,
         ci.description AS description,
         ci.has_recurrences AS has_recurrences,
         ci.invitation_status AS invitation_status,
         ci.status AS status,
         ci.hidden AS hidden,
         r.frequency AS rec_frequency,
         r.interval AS rec_interval,
         r.count AS rec_count,
         r.end_date AS rec_end_cf,
         r.specifier AS rec_specifier
       FROM CalendarItem ci
       JOIN Calendar c ON c.ROWID = ci.calendar_id
       LEFT JOIN Recurrence r ON r.owner_id = ci.ROWID
       WHERE c.UUID = '${escapedUuid}'
         AND (ci.hidden IS NULL OR ci.hidden = 0)
         AND ci.summary IS NOT NULL
         AND (
           (ci.start_date BETWEEN ${startCf} AND ${endCf})
           OR ci.has_recurrences = 1
         )`
    );

    const out: RemoteEvent[] = [];
    for (const row of rows) {
      const mapped = mapRowToEvent(row, calendarId);
      if (mapped) out.push(mapped);
    }
    return out;
  },
};

interface RawRow {
  uuid: string;
  summary: string | null;
  start_cf: number | null;
  end_cf: number | null;
  start_tz: string | null;
  all_day: number | null;
  description: string | null;
  has_recurrences: number | null;
  invitation_status: number | null;
  status: number | null;
  hidden: number | null;
  rec_frequency: number | null;
  rec_interval: number | null;
  rec_count: number | null;
  rec_end_cf: number | null;
  rec_specifier: string | null;
}

function mapRowToEvent(row: RawRow, calendarId: string): RemoteEvent | null {
  if (!row.uuid || !row.summary || row.start_cf == null) return null;
  const start = new Date((row.start_cf + CF_EPOCH_OFFSET) * 1000);
  const end = row.end_cf != null ? new Date((row.end_cf + CF_EPOCH_OFFSET) * 1000) : undefined;
  const allDay = row.all_day === 1;

  const date = formatLocalDate(start);
  let time: string | undefined;
  let endTime: string | undefined;
  if (!allDay) {
    time = formatLocalTime(start);
    if (end && formatLocalDate(end) === date) {
      endTime = formatLocalTime(end);
    }
  }

  const recurrence =
    row.has_recurrences === 1 && row.rec_frequency != null
      ? appleRecurrenceToRRule({
          frequency: row.rec_frequency,
          interval: row.rec_interval ?? 1,
          count: row.rec_count ?? 0,
          endCf: row.rec_end_cf ?? null,
          specifier: row.rec_specifier ?? "",
        })
      : undefined;

  const description = row.description?.trim() || undefined;

  return {
    extId: row.uuid,
    source: `macos:${calendarId}`,
    title: row.summary,
    date,
    time,
    endTime,
    recurrence,
    description,
    isCancelled: row.status === 3,
    responseStatus: mapInvitationStatus(row.invitation_status ?? 0),
  };
}

// Apple's CalendarItem.invitation_status — the meaning of each integer is
// undocumented; the mapping below is derived empirically. If a known-state
// event shows the wrong cue, look up its row and adjust the cases.
//   0 → user organized or explicitly accepted
//   1 → pending response
//   2 → accepted
//   3 → not yet responded (treated as needs-action so the user notices it)
//   4 → tentative
function mapInvitationStatus(code: number): RemoteResponseStatus {
  switch (code) {
    case 0:
    case 2:
      return "accepted";
    case 1:
    case 3:
      return "needsAction";
    case 4:
      return "tentative";
    default:
      return "unknown";
  }
}

interface AppleRecurrence {
  frequency: number;
  interval: number;
  count: number;
  endCf: number | null;
  specifier: string;
}

const FREQ_TO_RRULE: Record<number, string> = {
  1: "DAILY",
  2: "WEEKLY",
  3: "MONTHLY",
  4: "YEARLY",
};

function appleRecurrenceToRRule(rec: AppleRecurrence): string | undefined {
  const freq = FREQ_TO_RRULE[rec.frequency];
  if (!freq) return undefined;
  const parts: string[] = [`FREQ=${freq}`];
  if (rec.interval && rec.interval > 1) parts.push(`INTERVAL=${rec.interval}`);

  // Specifier format examples:
  //   D=0WE,0TH       → BYDAY=WE,TH
  //   D=1MO           → BYDAY=1MO    (first Monday)
  //   D=-1FR          → BYDAY=-1FR   (last Friday)
  //   M=6             → BYMONTH=6
  //   MD=15           → BYMONTHDAY=15
  // Multiple tokens are separated by `;`.
  for (const token of rec.specifier.split(";")) {
    const [k, v] = token.split("=");
    if (!k || !v) continue;
    if (k === "D") {
      const days = v
        .split(",")
        .map((d) => d.trim())
        .map((d) => (d.startsWith("0") ? d.slice(1) : d))
        .filter(Boolean);
      if (days.length) parts.push(`BYDAY=${days.join(",")}`);
    } else if (k === "M") {
      parts.push(`BYMONTH=${v}`);
    } else if (k === "MD") {
      parts.push(`BYMONTHDAY=${v}`);
    }
  }

  if (rec.count && rec.count > 0) {
    parts.push(`COUNT=${rec.count}`);
  } else if (rec.endCf) {
    const until = new Date((rec.endCf + CF_EPOCH_OFFSET) * 1000);
    parts.push(`UNTIL=${formatRRuleUntil(until)}`);
  }

  return parts.join(";");
}

function formatRRuleUntil(d: Date): string {
  // RFC 5545 UNTIL in UTC: YYYYMMDDTHHMMSSZ
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  const ss = String(d.getUTCSeconds()).padStart(2, "0");
  return `${y}${m}${day}T${hh}${mm}${ss}Z`;
}

function normalizeHexColor(raw: string | null): string | undefined {
  if (!raw) return undefined;
  // Apple stores 8-digit ARGB-ish strings in some calendars (e.g. "#FF2968FF").
  // Trim trailing alpha so the swatch renders consistently.
  const m = raw.match(/^#([0-9A-Fa-f]{6})/);
  if (m) return `#${m[1]}`;
  return raw;
}

function formatLocalDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatLocalTime(d: Date): string {
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  return `${h}:${m}`;
}

async function runSqlite<T>(sql: string): Promise<T[]> {
  const node = loadNode();
  try {
    const { stdout } = await node.execFileAsync(
      "sqlite3",
      ["-readonly", "-json", node.calendarDb, sql],
      { maxBuffer: 64 * 1024 * 1024 }
    );
    const trimmed = stdout.trim();
    if (!trimmed) return [];
    return JSON.parse(trimmed) as T[];
  } catch (err) {
    const e = err as { stderr?: string; message?: string };
    const stderr = (e.stderr ?? "").toString();
    if (stderr.includes("authorization denied") || stderr.includes("operation not permitted")) {
      throw new Error(
        "macOS denied access to Calendar's database. " +
          "If Obsidian was just installed, restart it; if the issue persists, " +
          "grant Obsidian Full Disk Access in System Settings → Privacy & Security."
      );
    }
    if (stderr.trim()) throw new Error(`Calendar DB read failed: ${stderr.trim()}`);
    throw new Error(e.message ?? "sqlite3 failed");
  }
}
