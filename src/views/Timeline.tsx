import * as React from "react";
import { addDays, fmtISO, format, isSameDay, parseDate, startOfDay } from "../utils/dates";
import { usePlugin } from "./context";
import { FilterBar } from "./shared/FilterBar";
import { applyFilter } from "../filter/filterEngine";
import { Icon, IconName } from "./shared/Icon";
import type { Milestone, Project, Task } from "../schema/types";

type Zoom = "day" | "week" | "month";
type GroupBy = "project" | "milestone";

const ROW_HEIGHT = 36;
const HEADER_HEIGHT = 48;
const SIDEBAR_WIDTH = 200;

const DAY_WIDTHS: Record<Zoom, number> = { day: 36, week: 18, month: 8 };

export const TimelineRoot: React.FC = () => {
  const { store, settings, taskService } = usePlugin();
  const tasksMap = store((s) => s.tasks);
  const projectsMap = store((s) => s.projects);
  const milestonesMap = store((s) => s.milestones);
  const filter = store((s) => s.filter);

  const [zoom, setZoom] = React.useState<Zoom>("week");
  const [groupBy, setGroupBy] = React.useState<GroupBy>("project");

  const allTasks = React.useMemo(() => Object.values(tasksMap), [tasksMap]);
  const filtered = React.useMemo(() => applyFilter(allTasks, filter), [allTasks, filter]);
  const datedTasks = React.useMemo(() => filtered.filter((t) => t.due || t.start), [filtered]);

  const { from, to } = React.useMemo(() => computeRange(datedTasks), [datedTasks]);
  const days = React.useMemo(() => buildDays(from, to), [from, to]);
  const dayWidth = DAY_WIDTHS[zoom];

  const rows = React.useMemo(
    () => buildRows(datedTasks, groupBy, projectsMap, milestonesMap),
    [datedTasks, groupBy, projectsMap, milestonesMap]
  );

  const containerRef = React.useRef<HTMLDivElement>(null);
  const [draft, setDraft] = React.useState<DraftBar | null>(null);

  const onPointerStart = (
    e: React.PointerEvent,
    task: Task,
    mode: "move" | "resize-start" | "resize-end"
  ) => {
    if (e.button !== 0) return;
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const startX = e.clientX;
    const start = parseDate(task.start) ?? parseDate(task.due) ?? new Date();
    const end = parseDate(task.due) ?? parseDate(task.start) ?? new Date();
    const initial: DraftBar = {
      taskPath: task.path,
      mode,
      startISO: fmtISO(start),
      endISO: fmtISO(end),
      pointerStartX: startX,
    };
    setDraft(initial);

    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      const days = Math.round(dx / dayWidth);
      const next: DraftBar = { ...initial };
      if (mode === "move") {
        next.startISO = fmtISO(addDays(start, days));
        next.endISO = fmtISO(addDays(end, days));
      } else if (mode === "resize-start") {
        const cand = addDays(start, days);
        if (cand <= end) next.startISO = fmtISO(cand);
      } else if (mode === "resize-end") {
        const cand = addDays(end, days);
        if (cand >= start) next.endISO = fmtISO(cand);
      }
      setDraft(next);
    };
    const onUp = async () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      const finalDraft = currentDraftRef.current;
      setDraft(null);
      if (!finalDraft) return;
      if (mode === "move" || mode === "resize-start") {
        await taskService.setStart(task, finalDraft.startISO);
      }
      if (mode === "move" || mode === "resize-end") {
        await taskService.setDue(task, finalDraft.endISO);
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const currentDraftRef = React.useRef<DraftBar | null>(null);
  React.useEffect(() => {
    currentDraftRef.current = draft;
  }, [draft]);

  const totalWidth = days.length * dayWidth;
  const today = startOfDay(new Date());
  const todayIdx = days.findIndex((d) => isSameDay(d, today));

  const groupIcon: Record<GroupBy, IconName> = {
    project: "folder",
    milestone: "flag",
  };
  const toolbar = (
    <>
      {(["project", "milestone"] as GroupBy[]).map((g) => (
        <button
          key={g}
          className={`kp-btn kp-btn--ghost ${groupBy === g ? "is-active" : ""}`}
          onClick={() => setGroupBy(g)}
        >
          <Icon name={groupIcon[g]} size={13} />
          <span>{g}</span>
        </button>
      ))}
      <span className="kp-toolbar__sep" />
      <span className="kp-toolbar__label">
        <Icon name="zoom" size={13} /> Zoom
      </span>
      {(["day", "week", "month"] as Zoom[]).map((z) => (
        <button
          key={z}
          className={`kp-btn kp-btn--ghost ${zoom === z ? "is-active" : ""}`}
          onClick={() => setZoom(z)}
        >
          {z}
        </button>
      ))}
    </>
  );

  return (
    <div className="kp-view kp-view--timeline">
      <FilterBar activeView="timeline" toolbar={toolbar} />

      <div className="kp-tl__scroll">
        <div className="kp-tl__container" ref={containerRef}>
          <div className="kp-tl__sidebar" style={{ width: SIDEBAR_WIDTH }}>
            <div className="kp-tl__sidebar-head" style={{ height: HEADER_HEIGHT }}>
              {groupBy === "project" ? "Project" : "Milestone"}
            </div>
            {rows.map((row) => (
              <div
                key={row.id}
                className="kp-tl__sidebar-row"
                style={{ height: row.tasks.length * ROW_HEIGHT + 4, borderLeftColor: row.color }}
              >
                <div className="kp-tl__sidebar-label">{row.label}</div>
                <div className="kp-tl__sidebar-count">{row.tasks.length}</div>
              </div>
            ))}
          </div>

          <div className="kp-tl__chart" style={{ width: totalWidth }}>
            <div className="kp-tl__header" style={{ height: HEADER_HEIGHT, width: totalWidth }}>
              {renderHeader(days, dayWidth, zoom)}
            </div>

            <div className="kp-tl__grid" style={{ width: totalWidth }}>
              {days.map((d, i) => (
                <div
                  key={i}
                  className={`kp-tl__day-col ${isWeekend(d) ? "kp-tl__day-col--weekend" : ""}`}
                  style={{ left: i * dayWidth, width: dayWidth }}
                />
              ))}
              {todayIdx >= 0 && (
                <div className="kp-tl__today" style={{ left: todayIdx * dayWidth + dayWidth / 2 }} />
              )}

              {rows.map((row, rowIdx) => (
                <div
                  key={row.id}
                  className="kp-tl__row"
                  style={{
                    height: row.tasks.length * ROW_HEIGHT + 4,
                    top: rowsBefore(rows, rowIdx),
                  }}
                >
                  {row.tasks.map((task, taskIdx) => {
                    const isDrafting = draft && draft.taskPath === task.path;
                    const startISO = isDrafting ? draft!.startISO : task.start ?? task.due!;
                    const endISO = isDrafting ? draft!.endISO : task.due ?? task.start!;
                    const startDate = parseDate(startISO)!;
                    const endDate = parseDate(endISO)!;
                    const startIdx = dayIndex(days, startDate);
                    const endIdx = dayIndex(days, endDate);
                    const left = startIdx * dayWidth;
                    const width = Math.max((endIdx - startIdx + 1) * dayWidth, dayWidth);
                    const top = taskIdx * ROW_HEIGHT + 2;
                    return (
                      <div
                        key={task.id}
                        className="kp-tl__bar"
                        style={{
                          left,
                          width,
                          top,
                          height: ROW_HEIGHT - 6,
                          background: row.color,
                        }}
                        onPointerDown={(e) => onPointerStart(e, task, "move")}
                        onClick={(e) => {
                          if (e.detail === 2) void taskService.openInNewLeaf(task);
                        }}
                      >
                        <div
                          className="kp-tl__bar-handle kp-tl__bar-handle--start"
                          onPointerDown={(e) => {
                            e.stopPropagation();
                            onPointerStart(e, task, "resize-start");
                          }}
                        />
                        <span className="kp-tl__bar-label">{task.title}</span>
                        <div
                          className="kp-tl__bar-handle kp-tl__bar-handle--end"
                          onPointerDown={(e) => {
                            e.stopPropagation();
                            onPointerStart(e, task, "resize-end");
                          }}
                        />
                      </div>
                    );
                  })}
                  {row.milestones?.map((m) => {
                    const date = parseDate(m.due);
                    if (!date) return null;
                    const idx = dayIndex(days, date);
                    return (
                      <div
                        key={m.id}
                        className="kp-tl__milestone"
                        style={{ left: idx * dayWidth + dayWidth / 2 - 6 }}
                        title={m.title}
                      />
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

interface DraftBar {
  taskPath: string;
  mode: "move" | "resize-start" | "resize-end";
  startISO: string;
  endISO: string;
  pointerStartX: number;
}

interface Row {
  id: string;
  label: string;
  color: string;
  tasks: Task[];
  milestones?: Milestone[];
}

function buildRows(
  tasks: Task[],
  groupBy: GroupBy,
  projectsMap: Record<string, Project>,
  milestonesMap: Record<string, Milestone>
): Row[] {
  if (groupBy === "project") {
    const byProject = new Map<string, Task[]>();
    for (const t of tasks) {
      const key = t.project ?? "Unassigned";
      if (!byProject.has(key)) byProject.set(key, []);
      byProject.get(key)!.push(t);
    }
    return Array.from(byProject.entries()).map(([name, list]) => {
      const project = Object.values(projectsMap).find((p) => p.name === name);
      const milestones = Object.values(milestonesMap).filter((m) => m.project === name);
      return {
        id: name,
        label: name,
        color: project?.color ?? "#3b82f6",
        tasks: list.slice().sort((a, b) => (a.due ?? "").localeCompare(b.due ?? "")),
        milestones,
      };
    });
  }
  const byMilestone = new Map<string, Task[]>();
  byMilestone.set("__unassigned", []);
  for (const t of tasks) {
    const key = t.milestone ?? "__unassigned";
    if (!byMilestone.has(key)) byMilestone.set(key, []);
    byMilestone.get(key)!.push(t);
  }
  return Array.from(byMilestone.entries()).map(([name, list]) => {
    const milestone = Object.values(milestonesMap).find((m) => m.name === name);
    const project = milestone?.project
      ? Object.values(projectsMap).find((p) => p.name === milestone.project)
      : undefined;
    return {
      id: name,
      label: name === "__unassigned" ? "Unassigned" : name,
      color: project?.color ?? "#8b5cf6",
      tasks: list.slice().sort((a, b) => (a.due ?? "").localeCompare(b.due ?? "")),
    };
  });
}

function rowsBefore(rows: Row[], idx: number): number {
  let total = 0;
  for (let i = 0; i < idx; i++) total += rows[i].tasks.length * ROW_HEIGHT + 4;
  return total;
}

function computeRange(tasks: Task[]): { from: Date; to: Date } {
  const today = startOfDay(new Date());
  if (tasks.length === 0) {
    return { from: addDays(today, -7), to: addDays(today, 30) };
  }
  let min = today;
  let max = today;
  for (const t of tasks) {
    const s = parseDate(t.start) ?? parseDate(t.due);
    const e = parseDate(t.due) ?? parseDate(t.start);
    if (s && s < min) min = s;
    if (e && e > max) max = e;
  }
  return { from: addDays(min, -3), to: addDays(max, 7) };
}

function buildDays(from: Date, to: Date): Date[] {
  const out: Date[] = [];
  let cur = startOfDay(from);
  const end = startOfDay(to);
  while (cur <= end) {
    out.push(cur);
    cur = addDays(cur, 1);
  }
  return out;
}

function dayIndex(days: Date[], target: Date): number {
  const t = startOfDay(target).getTime();
  for (let i = 0; i < days.length; i++) if (days[i].getTime() === t) return i;
  if (t < days[0].getTime()) return 0;
  return days.length - 1;
}

function isWeekend(d: Date): boolean {
  const day = d.getDay();
  return day === 0 || day === 6;
}

function renderHeader(days: Date[], dayWidth: number, zoom: Zoom): React.ReactNode {
  const monthBands: { label: string; left: number; width: number }[] = [];
  let currentMonth = -1;
  let bandStart = 0;
  days.forEach((d, i) => {
    if (d.getMonth() !== currentMonth) {
      if (currentMonth !== -1) {
        monthBands.push({
          label: format(days[bandStart], "MMM yyyy"),
          left: bandStart * dayWidth,
          width: (i - bandStart) * dayWidth,
        });
      }
      currentMonth = d.getMonth();
      bandStart = i;
    }
  });
  monthBands.push({
    label: format(days[bandStart], "MMM yyyy"),
    left: bandStart * dayWidth,
    width: (days.length - bandStart) * dayWidth,
  });

  const showDayLabels = zoom !== "month";

  return (
    <>
      <div className="kp-tl__header-months">
        {monthBands.map((b, i) => (
          <div key={i} className="kp-tl__header-month" style={{ left: b.left, width: b.width }}>
            {b.label}
          </div>
        ))}
      </div>
      <div className="kp-tl__header-days">
        {days.map((d, i) => (
          <div
            key={i}
            className={`kp-tl__header-day ${isWeekend(d) ? "kp-tl__header-day--weekend" : ""}`}
            style={{ left: i * dayWidth, width: dayWidth }}
          >
            {showDayLabels ? format(d, zoom === "day" ? "d EEE" : "d") : ""}
          </div>
        ))}
      </div>
    </>
  );
}
