import type KanbanPlusPlugin from "../../main";
import type { EventService } from "../eventService";
import type { ProjectService } from "../projectService";
import {
  CalendarProvider,
  ConnectPresenter,
  ProviderId,
  RemoteCalendar,
  RemoteEvent,
  TokenSet,
} from "./types";

export interface SyncResultDetails {
  created: string[];
  updated: string[];
  archived: string[];
  failed: string[];
}

export interface SyncResult {
  created: number;
  updated: number;
  archived: number;
  failed: number;
  details: SyncResultDetails;
}

function newDetails(): SyncResultDetails {
  return { created: [], updated: [], archived: [], failed: [] };
}

const REFRESH_BUFFER_MS = 60_000;
const PAST_DAYS = 30;
const FUTURE_DAYS = 540;

export class CalendarSyncEngine {
  constructor(
    private plugin: KanbanPlusPlugin,
    private events: EventService,
    private projects: ProjectService
  ) {}

  async connect(
    provider: CalendarProvider,
    presenter: ConnectPresenter,
    signal?: AbortSignal
  ): Promise<TokenSet> {
    const token = await provider.connect(presenter, signal);
    await this.persistToken(provider.id, token);
    try {
      const calendars = await provider.listCalendars(token);
      await this.persistCalendars(provider.id, calendars);
    } catch (err) {
      console.warn("Marvis: failed to fetch calendar list after connect", err);
    }
    return token;
  }

  async disconnect(provider: CalendarProvider): Promise<void> {
    const block = this.providerBlock(provider.id);
    if (!block) return;
    block.token = undefined;
    block.availableCalendars = [];
    block.selectedCalendars = [];
    await this.plugin.saveSettings();
  }

  async refreshCalendars(provider: CalendarProvider): Promise<RemoteCalendar[]> {
    const token = await this.requireFreshToken(provider);
    const list = await provider.listCalendars(token);
    await this.persistCalendars(provider.id, list);
    return list;
  }

  async syncCalendar(
    provider: CalendarProvider,
    calendarId: string,
    onProgress?: (done: number, total: number) => void
  ): Promise<SyncResult> {
    const result: SyncResult = {
      created: 0,
      updated: 0,
      archived: 0,
      failed: 0,
      details: newDetails(),
    };
    const block = this.providerBlock(provider.id);
    if (!block?.token) throw new Error(`${provider.label} is not connected.`);
    const selected = block.selectedCalendars.find((c) => c.id === calendarId);
    if (!selected) throw new Error("Calendar is not selected for sync.");

    const token = await this.requireFreshToken(provider);
    const now = new Date();
    const rangeStart = addDays(now, -PAST_DAYS);
    const rangeEnd = addDays(now, FUTURE_DAYS);
    const remote = await provider.listEvents(token, calendarId, rangeStart, rangeEnd);

    const sourceTag = `${provider.id}:${calendarId}`;
    const local = Object.values(this.plugin.store.getState().events).filter(
      // Already-archived files would be moved on every sync because they're
      // never in the remote pull — and that double-archive shows up in the
      // result modal as a phantom "archived" entry. Drop them here.
      (e) => e.source === sourceTag && e.extId && !e.path.includes("/archive/")
    );
    const localByExtId = new Map(local.map((e) => [e.extId as string, e]));
    const remoteByExtId = new Set(remote.map((r) => r.extId));

    await this.projects.createProject(selected.projectName);

    // Compute the canonical signature once per remote event so we can both
    // (a) skip events whose signature matches what we wrote last sync and
    // (b) write that signature back when something genuinely changed.
    const remoteSigByExtId = new Map<string, string>();
    for (const r of remote) remoteSigByExtId.set(r.extId, this.computeRemoteSig(r));

    const localToArchive = local.filter((e) => {
      if (remoteByExtId.has(e.extId as string)) return false;
      const localStart = new Date(e.date + "T00:00:00");
      return localStart >= rangeStart && localStart <= rangeEnd;
    });
    const total = remote.length + localToArchive.length;
    let done = 0;
    onProgress?.(done, total);

    for (const remoteEvent of remote) {
      try {
        const existing = localByExtId.get(remoteEvent.extId);
        if (remoteEvent.isCancelled) {
          if (existing) {
            await this.events.archive(existing);
            result.archived += 1;
            result.details.archived.push(existing.title || remoteEvent.title);
          }
          continue;
        }
        const remoteSig = remoteSigByExtId.get(remoteEvent.extId)!;
        if (!existing) {
          await this.events.createEvent({
            title: remoteEvent.title,
            date: remoteEvent.date,
            time: remoteEvent.time,
            endTime: remoteEvent.endTime,
            recurrence: remoteEvent.recurrence,
            body: remoteEvent.description,
            project: selected.projectName,
            tags: ["external"],
            extId: remoteEvent.extId,
            source: remoteEvent.source,
            responseStatus: remoteEvent.responseStatus,
            extHash: remoteSig,
          });
          result.created += 1;
          result.details.created.push(remoteEvent.title);
        } else if (existing.extHash === remoteSig) {
          // Fast path: signature matches what we wrote last sync, nothing to
          // do. Skips the body diff entirely on subsequent syncs.
        } else if (this.hasChanged(existing, remoteEvent)) {
          // Body is the user's notes — never overwrite it on update sync.
          // On initial create we seed it with the remote description, then
          // it's theirs. If the remote description changes later, the hash
          // flips and we update everything else, but the body is left alone.
          await this.events.setRemoteFields(existing, {
            title: remoteEvent.title,
            date: remoteEvent.date,
            time: remoteEvent.time,
            endTime: remoteEvent.endTime,
            recurrence: remoteEvent.recurrence,
            responseStatus: remoteEvent.responseStatus ?? null,
            extHash: remoteSig,
          });
          result.updated += 1;
          result.details.updated.push(remoteEvent.title);
        } else {
          // Hash mismatch but no field actually differs (e.g. backfill from a
          // pre-hash version of this code). Write the hash silently so
          // subsequent syncs hit the fast path.
          await this.events.setRemoteFields(existing, { extHash: remoteSig });
        }
      } catch (err) {
        console.error("Marvis calendar sync: event failed", remoteEvent.extId, err);
        result.failed += 1;
        result.details.failed.push(remoteEvent.title || remoteEvent.extId);
      }
      done += 1;
      onProgress?.(done, total);
    }

    // Apple Calendar reflects deletions immediately, so anything we have
    // locally that's not in the current pull (and within the window) was
    // removed upstream — archive it.
    for (const localEvent of localToArchive) {
      try {
        await this.events.archive(localEvent);
        result.archived += 1;
        result.details.archived.push(localEvent.title || localEvent.name);
      } catch (err) {
        console.error("Marvis calendar sync: archive failed", localEvent.path, err);
        result.failed += 1;
        result.details.failed.push(localEvent.title || localEvent.name);
      }
      done += 1;
      onProgress?.(done, total);
    }

    selected.lastSyncedAt = Date.now();
    selected.lastResult = result;
    await this.plugin.saveSettings();
    return result;
  }

  async syncAllSelected(
    provider: CalendarProvider,
    onProgress?: (done: number, total: number) => void
  ): Promise<SyncResult> {
    const totals: SyncResult = {
      created: 0,
      updated: 0,
      archived: 0,
      failed: 0,
      details: newDetails(),
    };
    const block = this.providerBlock(provider.id);
    if (!block) return totals;
    // Aggregate progress across calendars: each `syncCalendar` reports its own
    // 0..local-total range; we offset by the running total of items finished
    // in earlier calendars and a rough estimate of the calendars not yet
    // started so the bar advances monotonically.
    const calendarCount = block.selectedCalendars.length;
    let calendarsDone = 0;
    let priorDone = 0;
    let priorTotal = 0;
    for (const cal of block.selectedCalendars) {
      const remainingCalendars = calendarCount - calendarsDone;
      const reportInner = (d: number, t: number) => {
        // Estimate total = priorTotal + (this cal's t) + (others' average so far).
        const avgPerCal = calendarsDone > 0 ? priorTotal / calendarsDone : t || 1;
        const total = priorDone + t + Math.max(0, remainingCalendars - 1) * avgPerCal;
        onProgress?.(priorDone + d, Math.max(total, priorDone + d));
      };
      try {
        const r = await this.syncCalendar(provider, cal.id, reportInner);
        priorTotal += r.created + r.updated + r.archived + r.failed;
        priorDone += r.created + r.updated + r.archived + r.failed;
        totals.created += r.created;
        totals.updated += r.updated;
        totals.archived += r.archived;
        totals.failed += r.failed;
        totals.details.created.push(...r.details.created);
        totals.details.updated.push(...r.details.updated);
        totals.details.archived.push(...r.details.archived);
        totals.details.failed.push(...r.details.failed);
      } catch (err) {
        console.error("Marvis calendar sync: calendar failed", cal.id, err);
        totals.failed += 1;
        totals.details.failed.push(`${cal.displayName}: ${err instanceof Error ? err.message : String(err)}`);
      }
      calendarsDone += 1;
    }
    onProgress?.(priorDone, priorDone);
    return totals;
  }

  private async requireFreshToken(provider: CalendarProvider): Promise<TokenSet> {
    const block = this.providerBlock(provider.id);
    const token = block?.token;
    if (!token) throw new Error(`${provider.label} is not connected.`);
    if (token.expiresAt > Date.now() + REFRESH_BUFFER_MS) return token;
    if (!provider.refreshAccessToken || !token.refreshToken) {
      throw new Error("Session expired and provider can't refresh. Reconnect.");
    }
    const fresh = await provider.refreshAccessToken(token.refreshToken);
    await this.persistToken(provider.id, fresh);
    return fresh;
  }

  private hasChanged(
    local: { title: string; date: string; time?: string; endTime?: string; recurrence?: string; responseStatus?: string; body?: string },
    remote: RemoteEvent
  ): boolean {
    const diffs: Array<[string, string, string]> = [];
    const cmp = (field: string, l: string, r: string) => {
      if (l !== r) diffs.push([field, l, r]);
    };
    cmp("title", local.title ?? "", remote.title ?? "");
    cmp("date", local.date ?? "", remote.date ?? "");
    cmp("time", this.normalizeTime(local.time), this.normalizeTime(remote.time));
    cmp("endTime", this.normalizeTime(local.endTime), this.normalizeTime(remote.endTime));
    cmp("recurrence", this.normalizeRRule(local.recurrence), this.normalizeRRule(remote.recurrence));
    cmp("responseStatus", local.responseStatus ?? "", remote.responseStatus ?? "");
    cmp("body", this.normalizeBody(local.body), this.normalizeBody(remote.description, true));
    if (diffs.length === 0) return false;
    console.debug(
      `Marvis calendar sync: "${remote.title}" changed —`,
      diffs.map(([f, l, r]) => `${f}: ${JSON.stringify(l)} → ${JSON.stringify(r)}`).join("; ")
    );
    return true;
  }

  /** Normalize "09:00" / "09:00:00" / undefined to a single canonical form. */
  private normalizeTime(value: string | undefined | null): string {
    if (!value) return "";
    const m = value.trim().match(/^(\d{1,2}):(\d{2})/);
    if (!m) return value.trim();
    return `${m[1].padStart(2, "0")}:${m[2]}`;
  }

  /** Strip an RRULE: prefix and surrounding whitespace so transport quirks
   *  don't make every sync think the recurrence changed. */
  private normalizeRRule(value: string | undefined | null): string {
    if (!value) return "";
    return value
      .replace(/^RRULE:/i, "")
      .replace(/\s+/g, "")
      .toUpperCase()
      .trim();
  }

  /** Canonical signature of a remote event. Subsequent syncs compare this to
   *  the locally-stored `extHash` and short-circuit when they match — no body
   *  diff, no file write. */
  private computeRemoteSig(r: RemoteEvent): string {
    const parts = [
      r.title ?? "",
      r.date ?? "",
      this.normalizeTime(r.time),
      this.normalizeTime(r.endTime),
      this.normalizeRRule(r.recurrence),
      r.responseStatus ?? "",
      this.normalizeBody(r.description, true),
    ];
    return djb2(parts.join(""));
  }

  /**
   * Normalize event bodies so the diff doesn't trip on transport-only
   * differences. The indexer caps stored bodies at 8000 chars and trims
   * surrounding whitespace; mirror that on the remote side. Apple Calendar
   * also sends CRLF — collapse to LF so the strings match.
   */
  private normalizeBody(value: string | undefined | null, applyIndexerCap = false): string {
    if (!value) return "";
    let s = value.replace(/\r\n/g, "\n").trim();
    if (applyIndexerCap) s = s.slice(0, 8000);
    return s;
  }

  private providerBlock(id: ProviderId) {
    const sync = this.plugin.settings.calendarSync;
    if (!sync) return undefined;
    return id === "macos" ? sync.macos : undefined;
  }

  private async persistToken(id: ProviderId, token: TokenSet): Promise<void> {
    const block = this.providerBlock(id);
    if (!block) return;
    block.token = token;
    await this.plugin.saveSettings();
  }

  private async persistCalendars(id: ProviderId, list: RemoteCalendar[]): Promise<void> {
    const block = this.providerBlock(id);
    if (!block) return;
    block.availableCalendars = list;
    block.selectedCalendars = block.selectedCalendars.filter((c) =>
      list.some((r) => r.id === c.id)
    );
    await this.plugin.saveSettings();
  }
}

function addDays(d: Date, n: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + n);
  return out;
}

/** Tiny deterministic string hash (djb2). 32-bit unsigned hex. Plenty for
 *  collision-avoidance across one user's calendar. */
function djb2(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h) ^ s.charCodeAt(i);
  }
  return (h >>> 0).toString(16);
}
