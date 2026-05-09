import * as React from "react";
import { addDays, format, isSameDay, isSameMonth, parseDate, fmtMonth, monthGrid, fmtISO, startOfDay } from "../utils/dates";
import {
  DndContext,
  DragEndEvent,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { usePersistedViewState, usePlugin } from "./context";
import { FilterBar } from "./shared/FilterBar";
import { applyFilter } from "../filter/filterEngine";
import { Icon } from "./shared/Icon";
import type { Event, Log, Task } from "../schema/types";
import {
  eventIconName,
  expandOccurrences,
  responseStatusClass,
  responseStatusLabel,
} from "../utils/recurrence";

export const CalendarRoot: React.FC = () => {
  const { store, settings, taskService, logService, openQuickCreate } = usePlugin();
  const tasksMap = store((s) => s.tasks);
  const logsMap = store((s) => s.logs);
  const eventsMap = store((s) => s.events);
  const filter = store((s) => s.filter);
  const projectsMap = store((s) => s.projects);
  const allTasks = React.useMemo(() => Object.values(tasksMap), [tasksMap]);
  const filtered = React.useMemo(() => applyFilter(allTasks, filter), [allTasks, filter]);

  const filteredLogs = React.useMemo(() => {
    if (!filter.includeLogs) return [];
    return Object.values(logsMap).filter((l) => {
      if (filter.projects.length && (!l.project || !filter.projects.includes(l.project)))
        return false;
      if (filter.tags.length) {
        const tagSet = new Set(l.tags);
        if (!filter.tags.every((t) => tagSet.has(t))) return false;
      }
      if (filter.search.trim()) {
        const q = filter.search.trim().toLowerCase();
        const haystack = `${l.tags.join(" ")} ${l.project ?? ""} ${l.body ?? ""} ${
          l.excerpt ?? ""
        }`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [logsMap, filter]);

  const [cursor, setCursor] = React.useState(() => {
    const d = new Date();
    d.setDate(1);
    return d;
  });
  const [mode, setMode] = usePersistedViewState("calendarMode");

  const weeks = React.useMemo(
    () => monthGrid(cursor, settings.weekStartsOn),
    [cursor, settings.weekStartsOn]
  );

  const days: Date[] =
    mode === "month"
      ? weeks.flat()
      : mode === "week"
      ? visibleWeek(cursor, settings.weekStartsOn)
      : [startOfDay(cursor)];

  const filteredEvents = React.useMemo(() => {
    if (!filter.includeEvents) return [];
    return Object.values(eventsMap).filter((ev) => {
      if (filter.projects.length && (!ev.project || !filter.projects.includes(ev.project)))
        return false;
      if (filter.milestones.length && (!ev.milestone || !filter.milestones.includes(ev.milestone)))
        return false;
      if (filter.priorities.length && (!ev.priority || !filter.priorities.includes(ev.priority)))
        return false;
      if (filter.tags.length) {
        const tagSet = new Set(ev.tags);
        if (!filter.tags.every((t) => tagSet.has(t))) return false;
      }
      if (filter.search.trim()) {
        const q = filter.search.trim().toLowerCase();
        const haystack = `${ev.title} ${ev.tags.join(" ")} ${ev.project ?? ""} ${
          ev.body ?? ""
        }`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [eventsMap, filter]);

  const eventsByDay = React.useMemo(() => {
    const m = new Map<string, EventOccurrence[]>();
    if (days.length === 0) return m;
    const rangeStart = new Date(days[0]);
    rangeStart.setHours(0, 0, 0, 0);
    const rangeEnd = new Date(days[days.length - 1]);
    rangeEnd.setHours(23, 59, 59, 999);
    for (const ev of filteredEvents) {
      const occurrences = expandOccurrences(ev, rangeStart, rangeEnd);
      for (const occ of occurrences) {
        const key = fmtISO(occ);
        if (!m.has(key)) m.set(key, []);
        m.get(key)!.push({ event: ev, date: occ });
      }
    }
    for (const list of m.values()) {
      list.sort((a, b) => {
        const ta = a.event.time ?? "";
        const tb = b.event.time ?? "";
        return ta.localeCompare(tb);
      });
    }
    return m;
  }, [filteredEvents, days]);

  const tasksByDay = React.useMemo(() => {
    const m = new Map<string, Task[]>();
    for (const t of filtered) {
      if (!t.due) continue;
      const key = t.due;
      if (!m.has(key)) m.set(key, []);
      m.get(key)!.push(t);
    }
    return m;
  }, [filtered]);

  const logsByDay = React.useMemo(() => {
    const m = new Map<string, Log[]>();
    for (const l of filteredLogs) {
      const key = l.timestamp.slice(0, 10);
      if (!m.has(key)) m.set(key, []);
      m.get(key)!.push(l);
    }
    for (const list of m.values()) {
      list.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    }
    return m;
  }, [filteredLogs]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const onDragEnd = async (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over) return;
    const overId = over.id as string;
    if (!overId.startsWith("day:")) return;
    const targetDate = overId.slice(4);
    const activeId = active.id as string;
    if (activeId.startsWith("log:")) {
      const path = activeId.slice(4);
      const log = filteredLogs.find((l) => l.path === path);
      if (!log) return;
      if (log.timestamp.slice(0, 10) === targetDate) return;
      const time = log.timestamp.slice(11) || "00:00:00";
      const [h, m, s] = time.split(":").map((n) => parseInt(n, 10) || 0);
      const newDate = new Date(`${targetDate}T00:00`);
      newDate.setHours(h, m, s ?? 0, 0);
      await logService.setTimestamp(log, newDate);
      return;
    }
    const task = filtered.find((t) => t.id === activeId);
    if (!task) return;
    if (task.due === targetDate) return;
    await taskService.setDue(task, targetDate);
  };

  const move = (delta: number) => {
    const next = new Date(cursor);
    if (mode === "month") next.setMonth(next.getMonth() + delta);
    else if (mode === "week") next.setDate(next.getDate() + delta * 7);
    else next.setDate(next.getDate() + delta);
    setCursor(next);
  };

  const weekdayHeaders = React.useMemo(() => {
    const start = settings.weekStartsOn;
    const labels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    return Array.from({ length: 7 }, (_, i) => labels[(start + i) % 7]);
  }, [settings.weekStartsOn]);

  const toolbar = (
    <>
      <div className="kp-segmented">
        {(["day", "week", "month"] as const).map((m) => (
          <button
            key={m}
            className={`kp-segmented__btn ${mode === m ? "is-active" : ""}`}
            onClick={() => {
              // Cursor was set to the 1st of the month on mount, which is
              // fine for month/week but means day view lands on day 1 instead
              // of today. Snap to today whenever the user enters day mode.
              if (m === "day" && mode !== "day") setCursor(new Date());
              setMode(m);
            }}
            title={m}
          >
            <Icon
              name={m === "month" ? "calendarMonth" : m === "week" ? "calendarWeek" : "calendarDay"}
              size={13}
            />
            <span>{m}</span>
          </button>
        ))}
      </div>
      <button className="kp-btn kp-btn--ghost" onClick={() => move(-1)} title="Previous">
        <Icon name="chevronLeft" size={14} />
      </button>
      <button
        className="kp-btn kp-btn--ghost"
        onClick={() => setCursor(mode === "month" ? firstOfMonth(new Date()) : new Date())}
      >
        Today
      </button>
      <button className="kp-btn kp-btn--ghost" onClick={() => move(1)} title="Next">
        <Icon name="chevronRight" size={14} />
      </button>
    </>
  );

  return (
    <div className="kp-view kp-view--calendar">
      <FilterBar activeView="calendar" toolbar={toolbar} />

      <div className="kp-cal__titlerow">
        <span className="kp-cal__title">
          {mode === "month"
            ? fmtMonth(cursor)
            : mode === "week"
            ? `Week of ${format(days[0], "MMM d, yyyy")}`
            : format(days[0], "EEE, MMM d, yyyy")}
        </span>
      </div>

      {mode === "day" ? (
        (() => {
          const iso = fmtISO(days[0]);
          return (
            <DayView
              date={days[0]}
              iso={iso}
              tasks={tasksByDay.get(iso) ?? []}
              logs={logsByDay.get(iso) ?? []}
              events={eventsByDay.get(iso) ?? []}
              projectsMap={projectsMap}
              onCreate={() => openQuickCreate({ due: iso })}
            />
          );
        })()
      ) : (
        <>
          <div className="kp-cal__weekheader">
            {weekdayHeaders.map((d) => (
              <div key={d} className="kp-cal__weekday">
                {d}
              </div>
            ))}
          </div>

          <DndContext sensors={sensors} onDragEnd={onDragEnd}>
            <div className={`kp-cal__grid ${mode === "week" ? "kp-cal__grid--week" : ""}`}>
              {days.map((day) => {
                const iso = fmtISO(day);
                const tasks = tasksByDay.get(iso) ?? [];
                const logs = logsByDay.get(iso) ?? [];
                const events = eventsByDay.get(iso) ?? [];
                return (
                  <DayCell
                    key={iso}
                    date={day}
                    iso={iso}
                    tasks={tasks}
                    logs={logs}
                    events={events}
                    inMonth={isSameMonth(day, cursor)}
                    onCreate={() => openQuickCreate({ due: iso })}
                    projectsMap={projectsMap}
                  />
                );
              })}
            </div>
          </DndContext>
        </>
      )}
    </div>
  );
};

function visibleWeek(cursor: Date, weekStartsOn: 0 | 1): Date[] {
  const day = cursor.getDay();
  const offset = (day - weekStartsOn + 7) % 7;
  const start = addDays(cursor, -offset);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

function firstOfMonth(d: Date): Date {
  const r = new Date(d);
  r.setDate(1);
  return r;
}

interface EventOccurrence {
  event: Event;
  date: Date;
}

interface DayCellProps {
  date: Date;
  iso: string;
  tasks: Task[];
  logs: Log[];
  events: EventOccurrence[];
  inMonth: boolean;
  onCreate: () => void;
  projectsMap: Record<string, import("../schema/types").Project>;
}

const DayCell: React.FC<DayCellProps> = ({
  date,
  iso,
  tasks,
  logs,
  events,
  inMonth,
  onCreate,
  projectsMap,
}) => {
  const { setNodeRef, isOver } = useDroppable({ id: `day:${iso}` });
  const today = isSameDay(date, new Date());
  return (
    <div
      ref={setNodeRef}
      className={`kp-cal__cell ${inMonth ? "" : "kp-cal__cell--out"} ${today ? "kp-cal__cell--today" : ""} ${
        isOver ? "is-over" : ""
      }`}
      onDoubleClick={onCreate}
    >
      <div className="kp-cal__cell-head">
        <span className="kp-cal__date">{date.getDate()}</span>
      </div>
      <div className="kp-cal__chips">
        {events.map((occ, i) => (
          <EventCalChip
            key={`${occ.event.id}-${i}`}
            event={occ.event}
            date={occ.date}
            projectsMap={projectsMap}
          />
        ))}
        {tasks.map((task) => (
          <CalChip key={task.id} task={task} projectsMap={projectsMap} />
        ))}
        {logs.map((log) => (
          <LogCalChip key={log.id} log={log} projectsMap={projectsMap} />
        ))}
      </div>
    </div>
  );
};

const HOUR_HEIGHT = 56;

interface TimedLayout {
  occ: EventOccurrence;
  startMin: number;
  endMin: number;
  col: number;
  totalCols: number;
}

// Pack overlapping events into columns so concurrent events render side-by-side
// instead of stacking on top of each other. Standard sweep-by-start algorithm:
// events sharing any minute form a cluster; within the cluster, each event takes
// the leftmost free column, and the cluster's column count drives the slot width.
function layoutTimedEvents(events: EventOccurrence[]): TimedLayout[] {
  const items = events
    .map((occ) => {
      const startMin = parseTimeToMin(occ.event.time) ?? 0;
      const rawEnd = parseTimeToMin(occ.event.endTime) ?? startMin + 30;
      return { occ, startMin, endMin: Math.max(rawEnd, startMin + 1) };
    })
    .sort((a, b) => a.startMin - b.startMin || b.endMin - a.endMin);

  const out: TimedLayout[] = [];
  let cluster: TimedLayout[] = [];
  let clusterEnd = -1;
  let columns: number[] = [];

  const flush = () => {
    const total = columns.length;
    for (const item of cluster) item.totalCols = total;
    out.push(...cluster);
    cluster = [];
    columns = [];
    clusterEnd = -1;
  };

  for (const it of items) {
    if (cluster.length > 0 && it.startMin >= clusterEnd) flush();
    let col = columns.findIndex((end) => end <= it.startMin);
    if (col === -1) {
      col = columns.length;
      columns.push(it.endMin);
    } else {
      columns[col] = it.endMin;
    }
    cluster.push({
      occ: it.occ,
      startMin: it.startMin,
      endMin: it.endMin,
      col,
      totalCols: 0,
    });
    clusterEnd = Math.max(clusterEnd, it.endMin);
  }
  if (cluster.length > 0) flush();
  return out;
}

interface DayViewProps {
  date: Date;
  iso: string;
  tasks: Task[];
  logs: Log[];
  events: EventOccurrence[];
  projectsMap: Record<string, import("../schema/types").Project>;
  onCreate: () => void;
}

const DayView: React.FC<DayViewProps> = ({
  date,
  tasks,
  logs,
  events,
  projectsMap,
  onCreate,
}) => {
  const allDayEvents = events.filter((o) => !o.event.time);
  const timedEvents = events.filter((o) => o.event.time);
  const timedLayout = React.useMemo(
    () => layoutTimedEvents(timedEvents),
    [timedEvents]
  );
  const isToday = isSameDay(date, new Date());

  const [now, setNow] = React.useState(() => new Date());
  React.useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(id);
  }, []);
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const nowTop = (nowMinutes / 60) * HOUR_HEIGHT;

  const gridRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (!gridRef.current) return;
    const target = isToday ? Math.max(0, nowTop - 80) : 8 * HOUR_HEIGHT;
    gridRef.current.scrollTop = target;
    // Only scroll on first mount per date
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date.toDateString()]);

  return (
    <div className="kp-cal__day" onDoubleClick={onCreate}>
      <div className="kp-cal__day-allday">
        <div className="kp-cal__day-allday-label">All-day</div>
        <div className="kp-cal__day-allday-items">
          {allDayEvents.length === 0 && tasks.length === 0 && logs.length === 0 && (
            <span className="kp-cal__day-empty">—</span>
          )}
          {allDayEvents.map((occ, i) => (
            <EventCalChip
              key={`${occ.event.id}-${i}`}
              event={occ.event}
              date={occ.date}
              projectsMap={projectsMap}
            />
          ))}
          {tasks.map((task) => (
            <CalChip key={task.id} task={task} projectsMap={projectsMap} />
          ))}
          {logs
            .filter((l) => !l.timestamp.includes("T"))
            .map((log) => (
              <LogCalChip key={log.id} log={log} projectsMap={projectsMap} />
            ))}
        </div>
      </div>
      <div className="kp-cal__day-grid" ref={gridRef}>
        <div
          className="kp-cal__day-grid-inner"
          style={{ height: HOUR_HEIGHT * 24 }}
        >
          {Array.from({ length: 24 }, (_, h) => (
            <div key={h} className="kp-cal__day-hour" style={{ top: h * HOUR_HEIGHT, height: HOUR_HEIGHT }}>
              <span className="kp-cal__day-hour-label">
                {String(h).padStart(2, "0")}:00
              </span>
            </div>
          ))}
          {timedLayout.map((item, i) => (
            <DayTimedEvent
              key={`${item.occ.event.id}-${i}`}
              event={item.occ.event}
              projectsMap={projectsMap}
              col={item.col}
              totalCols={item.totalCols}
            />
          ))}
          {logs
            .filter((l) => l.timestamp.includes("T"))
            .map((log) => (
              <DayTimedLog key={log.id} log={log} projectsMap={projectsMap} />
            ))}
          {isToday && nowTop >= 0 && nowTop <= HOUR_HEIGHT * 24 && (
            <div className="kp-cal__day-now" style={{ top: nowTop }} />
          )}
        </div>
      </div>
    </div>
  );
};

const DayTimedEvent: React.FC<{
  event: Event;
  projectsMap: Record<string, import("../schema/types").Project>;
  col: number;
  totalCols: number;
}> = ({ event, projectsMap, col, totalCols }) => {
  const { eventService, settings } = usePlugin();
  const project = event.project
    ? Object.values(projectsMap).find((p) => p.name === event.project)
    : undefined;
  const priority = event.priority
    ? settings.priorities.find((p) => p.id === event.priority)
    : undefined;
  const startMin = parseTimeToMin(event.time) ?? 0;
  const endMin = parseTimeToMin(event.endTime) ?? startMin + 30;
  const top = (startMin / 60) * HOUR_HEIGHT;
  const height = Math.max(20, ((endMin - startMin) / 60) * HOUR_HEIGHT);
  const color = project?.color ?? "var(--kp-accent)";
  const timeLabel = event.endTime ? `${event.time}–${event.endTime}` : event.time!;
  const respClass = responseStatusClass(event);
  const respLabel = responseStatusLabel(event);
  // CSS sets `left: 60px; right: 12px;`. When events overlap we slice that
  // available width into N equal columns so they sit side-by-side.
  const overlap = totalCols > 1;
  const positionStyle: React.CSSProperties = overlap
    ? {
        left: `calc(60px + ${col} * (100% - 72px) / ${totalCols})`,
        width: `calc((100% - 72px) / ${totalCols} - 2px)`,
        right: "auto",
      }
    : {};
  return (
    <div
      className={`kp-cal__day-event ${respClass}`.trim()}
      style={{
        top,
        height,
        borderColor: color,
        background: `color-mix(in oklab, ${color} 18%, var(--kp-bg))`,
        ...positionStyle,
      }}
      title={respLabel ? `${respLabel} · ${timeLabel} · ${event.title}` : `${timeLabel} · ${event.title}`}
      onClick={(e) => {
        e.stopPropagation();
        const overrideMode = e.metaKey || e.ctrlKey ? "tab" : undefined;
        void eventService.openInNewLeaf(event, overrideMode);
      }}
    >
      <Icon name={eventIconName(event)} size={11} className="kp-cal__day-event-icon" />
      <span className="kp-cal__day-event-time">{timeLabel}</span>
      <span className="kp-cal__day-event-title">{event.title}</span>
      {priority && (
        <span className="kp-cal__chip-pri" style={{ color: priority.color }}>
          {priority.label}
        </span>
      )}
    </div>
  );
};

const DayTimedLog: React.FC<{
  log: Log;
  projectsMap: Record<string, import("../schema/types").Project>;
}> = ({ log, projectsMap }) => {
  const { logService } = usePlugin();
  const project = log.project
    ? Object.values(projectsMap).find((p) => p.name === log.project)
    : undefined;
  const time = log.timestamp.length >= 16 ? log.timestamp.slice(11, 16) : "00:00";
  const startMin = parseTimeToMin(time) ?? 0;
  const top = (startMin / 60) * HOUR_HEIGHT;
  const color = project?.color ?? "var(--background-modifier-border)";
  const label = log.excerpt ?? `Log @ ${time}`;
  return (
    <div
      className="kp-cal__day-log"
      style={{ top, borderColor: color }}
      title={label}
      onClick={(e) => {
        e.stopPropagation();
        const overrideMode = e.metaKey || e.ctrlKey ? "tab" : undefined;
        void logService.openInNewLeaf(log, overrideMode);
      }}
    >
      <Icon name="notebook" size={11} className="kp-cal__day-event-icon" />
      <span className="kp-cal__day-event-time">{time}</span>
      <span className="kp-cal__day-event-title">{label}</span>
    </div>
  );
};

function parseTimeToMin(t: string | undefined): number | null {
  if (!t) return null;
  const m = t.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

const EventCalChip: React.FC<{
  event: Event;
  date: Date;
  projectsMap: Record<string, import("../schema/types").Project>;
}> = ({ event, projectsMap }) => {
  const { eventService, settings } = usePlugin();
  const project = event.project
    ? Object.values(projectsMap).find((p) => p.name === event.project)
    : undefined;
  const priority = event.priority
    ? settings.priorities.find((p) => p.id === event.priority)
    : undefined;
  const isAllDay = !event.time;
  const timeLabel = event.time
    ? event.endTime
      ? `${event.time}–${event.endTime}`
      : event.time
    : "";
  const label = timeLabel ? `${timeLabel} · ${event.title}` : event.title;
  const respClass = responseStatusClass(event);
  const respLabel = responseStatusLabel(event);
  const style: React.CSSProperties = {
    borderColor: project?.color ?? "var(--background-modifier-border)",
  };
  return (
    <div
      className={`kp-cal__chip kp-cal__chip--event ${
        timeLabel ? "kp-cal__chip--stacked" : ""
      } ${isAllDay ? "kp-cal__chip--allday" : ""} ${respClass}`.trim()}
      style={style}
      title={respLabel ? `${respLabel} · ${label}` : label}
      onClick={(e) => {
        if (e.defaultPrevented) return;
        if ((e.target as HTMLElement).closest("[data-no-open]")) return;
        e.stopPropagation();
        const overrideMode = e.metaKey || e.ctrlKey ? "tab" : undefined;
        void eventService.openInNewLeaf(event, overrideMode);
      }}
    >
      <Icon name={eventIconName(event)} size={11} className="kp-cal__chip-icon" />
      <div className="kp-cal__chip-stack">
        {timeLabel && <span className="kp-cal__chip-time">{timeLabel}</span>}
        <span className="kp-cal__chip-title">{event.title}</span>
      </div>
      {priority && (
        <span className="kp-cal__chip-pri" style={{ color: priority.color }}>
          {priority.label}
        </span>
      )}
    </div>
  );
};

const LogCalChip: React.FC<{
  log: Log;
  projectsMap: Record<string, import("../schema/types").Project>;
}> = ({ log, projectsMap }) => {
  const { logService } = usePlugin();
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `log:${log.path}`,
  });
  const project = log.project
    ? Object.values(projectsMap).find((p) => p.name === log.project)
    : undefined;
  const time = log.timestamp.length >= 16 ? log.timestamp.slice(11, 16) : "";
  const label = log.excerpt ?? (time ? `Log @ ${time}` : "Log");
  const style: React.CSSProperties = {
    transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
    borderColor: project?.color ?? "var(--background-modifier-border)",
    opacity: isDragging ? 0.4 : 1,
  };
  return (
    <div
      ref={setNodeRef}
      className={`kp-cal__chip kp-cal__chip--log ${time ? "kp-cal__chip--stacked" : ""}`.trim()}
      style={style}
      title={label}
      onClick={(e) => {
        if (e.defaultPrevented) return;
        if ((e.target as HTMLElement).closest("[data-no-open]")) return;
        e.stopPropagation();
        const overrideMode = e.metaKey || e.ctrlKey ? "tab" : undefined;
        void logService.openInNewLeaf(log, overrideMode);
      }}
      {...attributes}
      {...listeners}
    >
      <Icon name="notebook" size={11} className="kp-cal__chip-icon" />
      <div className="kp-cal__chip-stack">
        {time && <span className="kp-cal__chip-time">{time}</span>}
        <span className="kp-cal__chip-title">{log.excerpt ?? "Log"}</span>
      </div>
    </div>
  );
};

const CalChip: React.FC<{
  task: Task;
  projectsMap: Record<string, import("../schema/types").Project>;
}> = ({ task, projectsMap }) => {
  const { taskService, settings } = usePlugin();
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: task.id });
  const project = task.project ? Object.values(projectsMap).find((p) => p.name === task.project) : undefined;
  const priority = task.priority
    ? settings.priorities.find((p) => p.id === task.priority)
    : undefined;
  const style: React.CSSProperties = {
    transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
    borderColor: project?.color ?? "var(--background-modifier-border)",
    opacity: isDragging ? 0.4 : 1,
  };
  return (
    <div
      ref={setNodeRef}
      className="kp-cal__chip"
      style={style}
      title={task.title}
      onClick={(e) => {
        if (e.defaultPrevented) return;
        if ((e.target as HTMLElement).closest("[data-no-open]")) return;
        e.stopPropagation();
        const overrideMode = e.metaKey || e.ctrlKey ? "tab" : undefined;
        void taskService.openInNewLeaf(task, overrideMode);
      }}
      {...attributes}
      {...listeners}
    >
      <Icon name="check" size={11} className="kp-cal__chip-icon" />
      <div className="kp-cal__chip-row">
        <span className="kp-cal__chip-title">{task.title}</span>
        {priority && (
          <span className="kp-cal__chip-pri" style={{ color: priority.color }}>
            {priority.label}
          </span>
        )}
      </div>
    </div>
  );
};
