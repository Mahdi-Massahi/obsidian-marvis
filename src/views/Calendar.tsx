import * as React from "react";
import { addDays, format, isSameDay, isSameMonth, parseDate, fmtMonth, monthGrid, fmtISO } from "../utils/dates";
import {
  DndContext,
  DragEndEvent,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { usePlugin } from "./context";
import { FilterBar } from "./shared/FilterBar";
import { applyFilter } from "../filter/filterEngine";
import { Icon } from "./shared/Icon";
import type { Log, Task } from "../schema/types";

export const CalendarRoot: React.FC = () => {
  const { store, settings, taskService, logService, openQuickCreate } = usePlugin();
  const tasksMap = store((s) => s.tasks);
  const logsMap = store((s) => s.logs);
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
  const [mode, setMode] = React.useState<"month" | "week">("month");

  const weeks = React.useMemo(
    () => monthGrid(cursor, settings.weekStartsOn),
    [cursor, settings.weekStartsOn]
  );

  const days: Date[] = mode === "month" ? weeks.flat() : visibleWeek(cursor, settings.weekStartsOn);

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
    else next.setDate(next.getDate() + delta * 7);
    setCursor(next);
  };

  const weekdayHeaders = React.useMemo(() => {
    const start = settings.weekStartsOn;
    const labels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    return Array.from({ length: 7 }, (_, i) => labels[(start + i) % 7]);
  }, [settings.weekStartsOn]);

  const toolbar = (
    <>
      <button className="kp-btn kp-btn--ghost" onClick={() => move(-1)} title="Previous">
        <Icon name="chevronLeft" size={14} />
      </button>
      <button className="kp-btn kp-btn--ghost" onClick={() => move(1)} title="Next">
        <Icon name="chevronRight" size={14} />
      </button>
      <button
        className="kp-btn kp-btn--ghost"
        onClick={() => setCursor(mode === "month" ? firstOfMonth(new Date()) : new Date())}
      >
        Today
      </button>
      <span className="kp-cal__title">
        {mode === "month" ? fmtMonth(cursor) : `Week of ${format(days[0], "MMM d, yyyy")}`}
      </span>
      <span className="kp-toolbar__sep" />
      {(["month", "week"] as const).map((m) => (
        <button
          key={m}
          className={`kp-btn kp-btn--ghost ${mode === m ? "is-active" : ""}`}
          onClick={() => setMode(m)}
        >
          <Icon name="calendar" size={13} />
          <span>{m}</span>
        </button>
      ))}
    </>
  );

  return (
    <div className="kp-view kp-view--calendar">
      <FilterBar activeView="calendar" toolbar={toolbar} />

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
            return (
              <DayCell
                key={iso}
                date={day}
                iso={iso}
                tasks={tasks}
                logs={logs}
                inMonth={isSameMonth(day, cursor)}
                onCreate={() => openQuickCreate({ due: iso })}
                projectsMap={projectsMap}
              />
            );
          })}
        </div>
      </DndContext>
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

interface DayCellProps {
  date: Date;
  iso: string;
  tasks: Task[];
  logs: Log[];
  inMonth: boolean;
  onCreate: () => void;
  projectsMap: Record<string, import("../schema/types").Project>;
}

const DayCell: React.FC<DayCellProps> = ({
  date,
  iso,
  tasks,
  logs,
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
      className="kp-cal__chip kp-cal__chip--log"
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
      <span className="kp-cal__chip-title">{label}</span>
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
      <span className="kp-cal__chip-title">{task.title}</span>
      {priority && (
        <span className="kp-cal__chip-pri" style={{ color: priority.color }}>
          {priority.label}
        </span>
      )}
    </div>
  );
};
