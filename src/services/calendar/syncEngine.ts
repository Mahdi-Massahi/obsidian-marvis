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

export interface SyncResult {
  created: number;
  updated: number;
  archived: number;
  failed: number;
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

  async syncCalendar(provider: CalendarProvider, calendarId: string): Promise<SyncResult> {
    const result: SyncResult = { created: 0, updated: 0, archived: 0, failed: 0 };
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
      (e) => e.source === sourceTag && e.extId
    );
    const localByExtId = new Map(local.map((e) => [e.extId as string, e]));
    const remoteByExtId = new Set(remote.map((r) => r.extId));

    await this.projects.createProject(selected.projectName);

    for (const remoteEvent of remote) {
      try {
        const existing = localByExtId.get(remoteEvent.extId);
        if (remoteEvent.isCancelled) {
          if (existing) {
            await this.events.archive(existing);
            result.archived += 1;
          }
          continue;
        }
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
          });
          result.created += 1;
        } else if (this.hasChanged(existing, remoteEvent)) {
          await this.events.setRemoteFields(existing, {
            title: remoteEvent.title,
            date: remoteEvent.date,
            time: remoteEvent.time,
            endTime: remoteEvent.endTime,
            recurrence: remoteEvent.recurrence,
            description: remoteEvent.description,
            responseStatus: remoteEvent.responseStatus ?? null,
          });
          result.updated += 1;
        }
      } catch (err) {
        console.error("Marvis calendar sync: event failed", remoteEvent.extId, err);
        result.failed += 1;
      }
    }

    // Apple Calendar reflects deletions immediately, so anything we have
    // locally that's not in the current pull (and within the window) was
    // removed upstream — archive it.
    for (const localEvent of local) {
      if (remoteByExtId.has(localEvent.extId as string)) continue;
      const localStart = new Date(localEvent.date + "T00:00:00");
      if (localStart < rangeStart || localStart > rangeEnd) continue;
      try {
        await this.events.archive(localEvent);
        result.archived += 1;
      } catch (err) {
        console.error("Marvis calendar sync: archive failed", localEvent.path, err);
        result.failed += 1;
      }
    }

    selected.lastSyncedAt = Date.now();
    selected.lastResult = result;
    await this.plugin.saveSettings();
    return result;
  }

  async syncAllSelected(provider: CalendarProvider): Promise<SyncResult> {
    const totals: SyncResult = { created: 0, updated: 0, archived: 0, failed: 0 };
    const block = this.providerBlock(provider.id);
    if (!block) return totals;
    for (const cal of block.selectedCalendars) {
      try {
        const r = await this.syncCalendar(provider, cal.id);
        totals.created += r.created;
        totals.updated += r.updated;
        totals.archived += r.archived;
        totals.failed += r.failed;
      } catch (err) {
        console.error("Marvis calendar sync: calendar failed", cal.id, err);
        totals.failed += 1;
      }
    }
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
    local: { title: string; date: string; time?: string; endTime?: string; recurrence?: string; responseStatus?: string },
    remote: RemoteEvent
  ): boolean {
    if (local.title !== remote.title) return true;
    if (local.date !== remote.date) return true;
    if ((local.time ?? "") !== (remote.time ?? "")) return true;
    if ((local.endTime ?? "") !== (remote.endTime ?? "")) return true;
    if ((local.recurrence ?? "") !== (remote.recurrence ?? "")) return true;
    if ((local.responseStatus ?? "") !== (remote.responseStatus ?? "")) return true;
    return false;
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
