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

const DAY_WIDTHS: Record<Zoom, number> = { day: 64, week: 36, month: 16 };

interface Bar {
  id: string;
  path: string;
  kind: "task" | "milestone";
  label: string;
  startISO: string;
  endISO: string;
  color: string;
  priorityLabel?: string;
  priorityColor?: string;
}

export const TimelineRoot: React.FC = () => {
  const { store, settings, taskService, milestoneService } = usePlugin();
  const tasksMap = store((s) => s.tasks);
  const projectsMap = store((s) => s.projects);
  const milestonesMap = store((s) => s.milestones);
  const filter = store((s) => s.filter);

  const [zoom, setZoom] = React.useState<Zoom>("week");
  const [groupBy, setGroupBy] = React.useState<GroupBy>("project");

  const allTasks = React.useMemo(() => Object.values(tasksMap), [tasksMap]);
  const filteredTasks = React.useMemo(() => applyFilter(allTasks, filter), [allTasks, filter]);
  const datedTasks = React.useMemo(
    () =>
      filteredTasks.filter((t) => {
        if (t.due || t.start) return true;
        const m = lookupMilestone(t.milestone, milestonesMap);
        return !!(m && (m.due || m.start));
      }),
    [filteredTasks, milestonesMap]
  );

  const allMilestones = React.useMemo(() => Object.values(milestonesMap), [milestonesMap]);
  const filteredMilestones = React.useMemo(() => {
    return allMilestones.filter((m) => {
      if (!m.due && !m.start) return false;
      if (filter.projects.length && (!m.project || !filter.projects.includes(m.project)))
        return false;
      if (filter.milestones.length && !filter.milestones.includes(m.name)) return false;
      return true;
    });
  }, [allMilestones, filter]);

  const rows = React.useMemo(
    () =>
      buildRows(
        groupBy,
        datedTasks,
        filteredMilestones,
        projectsMap,
        milestonesMap,
        settings.priorities
      ),
    [groupBy, datedTasks, filteredMilestones, projectsMap, milestonesMap, settings.priorities]
  );

  const dateSpan = React.useMemo(() => {
    if (groupBy === "project") return computeRangeFromBars(rows);
    return computeRangeFromBars(rows);
  }, [rows, groupBy]);
  const { from, to } = dateSpan;
  const days = React.useMemo(() => buildDays(from, to), [from, to]);
  const [dayWidth, setDayWidth] = React.useState(DAY_WIDTHS[zoom]);
  React.useEffect(() => {
    setDayWidth(DAY_WIDTHS[zoom]);
  }, [zoom]);
  const headerRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const factor = Math.exp(-e.deltaY * 0.005);
      setDayWidth((w) => Math.max(4, Math.min(240, w * factor)));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const containerRef = React.useRef<HTMLDivElement>(null);
  const [draft, setDraft] = React.useState<DraftBar | null>(null);

  const onPointerStart = (
    e: React.PointerEvent,
    bar: Bar,
    mode: "move" | "resize-start" | "resize-end"
  ) => {
    if (e.button !== 0) return;
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const startX = e.clientX;
    const start = parseDate(bar.startISO) ?? new Date();
    const end = parseDate(bar.endISO) ?? new Date();
    const initial: DraftBar = {
      barPath: bar.path,
      barKind: bar.kind,
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
      if (bar.kind === "task") {
        const task = tasksMap[bar.path];
        if (!task) return;
        if (mode === "move" || mode === "resize-start") {
          await taskService.setStart(task, finalDraft.startISO);
        }
        if (mode === "move" || mode === "resize-end") {
          await taskService.setDue(task, finalDraft.endISO);
        }
      } else {
        const milestone = milestonesMap[bar.path];
        if (!milestone) return;
        if (mode === "move" || mode === "resize-start") {
          await milestoneService.setStart(milestone, finalDraft.startISO);
        }
        if (mode === "move" || mode === "resize-end") {
          await milestoneService.setDue(milestone, finalDraft.endISO);
        }
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

  const scrollRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (!scrollRef.current || todayIdx < 0) return;
    const targetX = todayIdx * dayWidth - 80;
    scrollRef.current.scrollLeft = Math.max(0, targetX);
  }, [zoom, todayIdx, dayWidth]);

  const scrollToToday = () => {
    if (!scrollRef.current || todayIdx < 0) return;
    scrollRef.current.scrollTo({
      left: Math.max(0, todayIdx * dayWidth - 80),
      behavior: "smooth",
    });
  };

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
      <span className="kp-toolbar__sep" />
      <button className="kp-btn kp-btn--ghost" onClick={scrollToToday}>
        Today
      </button>
    </>
  );

  return (
    <div className="kp-view kp-view--timeline">
      <FilterBar activeView="timeline" toolbar={toolbar} />

      <div className="kp-tl__scroll" ref={scrollRef}>
        <div className="kp-tl__container" ref={containerRef}>
          <div className="kp-tl__sidebar" style={{ width: SIDEBAR_WIDTH }}>
            <div className="kp-tl__sidebar-head" style={{ height: HEADER_HEIGHT }}>
              {groupBy === "project" ? "Project" : "Milestone"}
            </div>
            {rows.map((row) => (
              <div
                key={row.id}
                className="kp-tl__sidebar-row"
                style={{
                  height: Math.max(row.bars.length, 1) * ROW_HEIGHT + 4,
                  borderLeftColor: row.color,
                }}
              >
                <div className="kp-tl__sidebar-label">{row.label}</div>
                <div className="kp-tl__sidebar-count">{row.bars.length}</div>
              </div>
            ))}
          </div>

          <div className="kp-tl__chart" style={{ width: totalWidth }}>
            <div
              ref={headerRef}
              className="kp-tl__header"
              style={{ height: HEADER_HEIGHT, width: totalWidth }}
            >
              {renderHeader(days, dayWidth, dayWidth < 24 ? "month" : dayWidth < 48 ? "week" : "day")}
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
                    height: Math.max(row.bars.length, 1) * ROW_HEIGHT + 4,
                    top: rowsBefore(rows, rowIdx),
                  }}
                >
                  {row.bars.map((bar, barIdx) => {
                    const isDrafting = draft && draft.barPath === bar.path;
                    const startISO = isDrafting ? draft!.startISO : bar.startISO;
                    const endISO = isDrafting ? draft!.endISO : bar.endISO;
                    const startDate = parseDate(startISO)!;
                    const endDate = parseDate(endISO)!;
                    const startIdx = dayIndex(days, startDate);
                    const endIdx = dayIndex(days, endDate);
                    const left = startIdx * dayWidth;
                    const width = Math.max((endIdx - startIdx + 1) * dayWidth, dayWidth);
                    const top = barIdx * ROW_HEIGHT + 2;
                    const isNarrow = width < 56;
                    const isMilestone = bar.kind === "milestone";
                    return (
                      <div
                        key={bar.id}
                        className={`kp-tl__bar ${isNarrow ? "kp-tl__bar--narrow" : ""} ${
                          isMilestone ? "kp-tl__bar--milestone" : ""
                        }`}
                        style={{
                          left,
                          width,
                          top,
                          height: ROW_HEIGHT - 6,
                          background: `color-mix(in oklab, ${bar.color} 18%, transparent)`,
                          borderColor: bar.color,
                        }}
                        onPointerDown={(e) => onPointerStart(e, bar, "move")}
                        onClick={(e) => {
                          if (e.detail !== 2) return;
                          const overrideMode =
                            e.metaKey || e.ctrlKey ? "tab" : undefined;
                          if (bar.kind === "task") {
                            const t = tasksMap[bar.path];
                            if (t) void taskService.openInNewLeaf(t, overrideMode);
                          } else {
                            const m = milestonesMap[bar.path];
                            if (m) void milestoneService.openInNewLeaf(m, overrideMode);
                          }
                        }}
                      >
                        <div
                          className="kp-tl__bar-handle kp-tl__bar-handle--start"
                          onPointerDown={(e) => {
                            e.stopPropagation();
                            onPointerStart(e, bar, "resize-start");
                          }}
                        />
                        <span className="kp-tl__bar-label">
                          <Icon
                            name={isMilestone ? "flag" : "check"}
                            size={12}
                            className="kp-tl__bar-icon"
                          />
                          {bar.label}
                        </span>
                        {bar.priorityLabel && (
                          <span
                            className="kp-tl__bar-pri"
                            style={{ color: bar.priorityColor }}
                          >
                            {bar.priorityLabel}
                          </span>
                        )}
                        <div
                          className="kp-tl__bar-handle kp-tl__bar-handle--end"
                          onPointerDown={(e) => {
                            e.stopPropagation();
                            onPointerStart(e, bar, "resize-end");
                          }}
                        />
                      </div>
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
  barPath: string;
  barKind: "task" | "milestone";
  mode: "move" | "resize-start" | "resize-end";
  startISO: string;
  endISO: string;
  pointerStartX: number;
}

interface Row {
  id: string;
  label: string;
  color: string;
  bars: Bar[];
}

function buildRows(
  groupBy: GroupBy,
  tasks: Task[],
  milestones: Milestone[],
  projectsMap: Record<string, Project>,
  milestonesMap: Record<string, Milestone>,
  priorities: { id: string; label: string; color: string }[]
): Row[] {
  const milestoneByName = new Map<string, Milestone>();
  for (const m of Object.values(milestonesMap)) milestoneByName.set(m.name, m);
  if (groupBy === "project") {
    const byProject = new Map<string, Task[]>();
    for (const t of tasks) {
      const key = t.project ?? "Unassigned";
      if (!byProject.has(key)) byProject.set(key, []);
      byProject.get(key)!.push(t);
    }
    return Array.from(byProject.entries()).map(([name, list]) => {
      const project = Object.values(projectsMap).find((p) => p.name === name);
      const color = project?.color ?? "#3b82f6";
      const sorted = list.slice().sort((a, b) => (a.due ?? "").localeCompare(b.due ?? ""));
      return {
        id: `project:${name}`,
        label: name,
        color,
        bars: sorted.map((t) => taskToBar(t, color, priorities, milestoneByName)),
      };
    });
  }
  // milestone mode: rows = project, bars = milestones
  const byProject = new Map<string, Milestone[]>();
  for (const m of milestones) {
    const key = m.project ?? "Unassigned";
    if (!byProject.has(key)) byProject.set(key, []);
    byProject.get(key)!.push(m);
  }
  return Array.from(byProject.entries()).map(([name, list]) => {
    const project = Object.values(projectsMap).find((p) => p.name === name);
    const color = project?.color ?? "#8b5cf6";
    const sorted = list.slice().sort((a, b) => (a.due ?? "").localeCompare(b.due ?? ""));
    return {
      id: `milestone-row:${name}`,
      label: name,
      color,
      bars: sorted.map((m) => milestoneToBar(m, color)),
    };
  });
}

function lookupMilestone(
  ref: string | undefined,
  milestonesMap: Record<string, Milestone>
): Milestone | undefined {
  if (!ref) return undefined;
  const last = ref.split("/").pop()!.replace(/\.md$/i, "");
  return Object.values(milestonesMap).find((m) => m.name === last);
}

function taskToBar(
  t: Task,
  projectColor: string,
  priorities: { id: string; label: string; color: string }[],
  milestoneByName: Map<string, Milestone>
): Bar {
  const last = t.milestone?.split("/").pop()?.replace(/\.md$/i, "");
  const m = last ? milestoneByName.get(last) : undefined;
  const start = t.start ?? t.due ?? m?.start ?? m?.due!;
  const end = t.due ?? t.start ?? m?.due ?? m?.start!;
  const pri = t.priority ? priorities.find((p) => p.id === t.priority) : undefined;
  return {
    id: t.id,
    path: t.path,
    kind: "task",
    label: t.title,
    startISO: start,
    endISO: end,
    color: projectColor,
    priorityLabel: pri?.label,
    priorityColor: pri?.color,
  };
}

function milestoneToBar(m: Milestone, color: string): Bar {
  const start = m.start ?? m.due!;
  const end = m.due ?? m.start!;
  return {
    id: m.id,
    path: m.path,
    kind: "milestone",
    label: m.title,
    startISO: start,
    endISO: end,
    color,
  };
}

function rowsBefore(rows: Row[], idx: number): number {
  let total = 0;
  for (let i = 0; i < idx; i++) total += Math.max(rows[i].bars.length, 1) * ROW_HEIGHT + 4;
  return total;
}

function computeRangeFromBars(rows: Row[]): { from: Date; to: Date } {
  const today = startOfDay(new Date());
  let from = addDays(today, -60);
  let to = addDays(today, 180);
  for (const row of rows) {
    for (const b of row.bars) {
      const s = parseDate(b.startISO);
      const e = parseDate(b.endISO);
      if (s && s < from) from = addDays(s, -7);
      if (e && e > to) to = addDays(e, 14);
    }
  }
  return { from, to };
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

  if (zoom === "month") {
    return (
      <div className="kp-tl__header-months kp-tl__header-months--solo">
        {monthBands.map((b, i) => (
          <div key={i} className="kp-tl__header-month" style={{ left: b.left, width: b.width }}>
            {b.label}
          </div>
        ))}
      </div>
    );
  }

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
            {format(d, zoom === "day" ? "d EEE" : "d")}
          </div>
        ))}
      </div>
    </>
  );
}
