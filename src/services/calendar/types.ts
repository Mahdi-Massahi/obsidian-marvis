// Provider-agnostic shapes for external calendar sync.
// Each `CalendarProvider` (Apple Calendar today; OAuth providers later)
// exposes the same interface so the sync engine and settings UI don't
// depend on the underlying mechanism.

export interface RemoteAccount {
  id: string;
  displayName: string;
  email?: string;
}

export interface TokenSet {
  accessToken: string;          // synthetic for non-OAuth providers
  refreshToken?: string;
  expiresAt: number;            // unix ms (Number.MAX_SAFE_INTEGER for non-expiring)
  account: RemoteAccount;
}

export interface RemoteCalendar {
  id: string;                   // stable identifier (UID for Apple Calendar)
  displayName: string;
  isPrimary?: boolean;
  color?: string;
  account?: string;             // email of the account this calendar belongs to
}

export type RemoteResponseStatus =
  | "accepted"
  | "needsAction"
  | "tentative"
  | "declined"
  | "unknown";

export interface RemoteEvent {
  extId: string;
  source: string;               // "macos:<calendarId>"
  title: string;
  date: string;                 // YYYY-MM-DD start
  time?: string;                // HH:mm
  endTime?: string;             // HH:mm
  recurrence?: string;          // RRULE
  description?: string;
  isCancelled?: boolean;
  updatedAt?: string;
  responseStatus?: RemoteResponseStatus;
}

export type ProviderId = "macos";

export interface ConnectPresenter {
  showStatus?(text: string): void;
}

export interface CalendarProvider {
  id: ProviderId;
  label: string;
  isAvailable(): boolean;
  connect(presenter: ConnectPresenter, signal?: AbortSignal): Promise<TokenSet>;
  refreshAccessToken?(refreshToken: string): Promise<TokenSet>;
  listCalendars(token: TokenSet): Promise<RemoteCalendar[]>;
  listEvents(
    token: TokenSet,
    calendarId: string,
    rangeStart: Date,
    rangeEnd: Date
  ): Promise<RemoteEvent[]>;
}
