import * as React from "react";
import { Notice } from "obsidian";
import { usePlugin } from "./context";
import { selectLogList } from "../index/store";
import type { Habit, Log } from "../schema/types";
import { HABIT_FREQUENCY_LABEL } from "../schema/types";
import { applyHabitFilter } from "../filter/filterEngine";
import {
  bonusTickDays,
  completionCounts,
  computeStreak,
  dayCounts,
  pastDays,
  periodKey,
} from "../utils/habits";
import { FilterBar } from "./shared/FilterBar";
import { Icon } from "./shared/Icon";
import { fmtISO } from "../utils/dates";
import { addDays, format, getISOWeek, isSameMonth, isSameDay, startOfDay } from "date-fns";

type Mode = "today" | "review";

export const HabitsRoot: React.FC = () => {
  const { store, openCreateMenu } = usePlugin();
  const habitsMap = store((s) => s.habits);
  const filter = store((s) => s.filter);
  const allHabits = React.useMemo(
    () =>
      Object.values(habitsMap).sort((a, b) => {
        if (a.archived !== b.archived) return a.archived ? 1 : -1;
        return a.order - b.order || a.title.localeCompare(b.title);
      }),
    [habitsMap]
  );
  const habits = React.useMemo(() => applyHabitFilter(allHabits, filter), [allHabits, filter]);

  const [mode, setMode] = React.useState<Mode>("today");
  const today = React.useMemo(() => startOfDay(new Date()), []);
  const [cursor, setCursor] = React.useState<Date>(() => startOfDay(new Date()));
  const moveCursor = React.useCallback((delta: number) => setCursor((c) => addDays(c, delta)), []);
  const jumpToToday = React.useCallback(() => setCursor(today), [today]);

  const onNavKeyDown = (e: React.KeyboardEvent<HTMLElement>) => {
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      moveCursor(-1);
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      moveCursor(1);
    }
  };

  const toolbar = (
    <>
      <div className="kp-viewswitcher">
        <button
          className={`kp-viewswitcher__btn ${mode === "today" ? "is-active" : ""}`}
          onClick={() => setMode("today")}
          title="Today"
        >
          <Icon name="check" size={13} />
          <span>Today</span>
        </button>
        <button
          className={`kp-viewswitcher__btn ${mode === "review" ? "is-active" : ""}`}
          onClick={() => setMode("review")}
          title="Review"
        >
          <Icon name="table" size={13} />
          <span>Review</span>
        </button>
      </div>
      {mode === "today" && (
        <>
          <button
            className="kp-btn kp-btn--ghost"
            onClick={() => moveCursor(-1)}
            onKeyDown={onNavKeyDown}
            title="Previous day"
            aria-label="Previous day"
          >
            <Icon name="chevronLeft" size={14} />
          </button>
          <button
            className="kp-btn kp-btn--ghost"
            onClick={jumpToToday}
            onKeyDown={onNavKeyDown}
            title="Jump to today"
          >
            Today
          </button>
          <button
            className="kp-btn kp-btn--ghost"
            onClick={() => moveCursor(1)}
            onKeyDown={onNavKeyDown}
            title="Next day"
            aria-label="Next day"
          >
            <Icon name="chevronRight" size={14} />
          </button>
        </>
      )}
    </>
  );

  return (
    <div className="kp-view kp-view--habits">
      <FilterBar activeView="habits" toolbar={toolbar} />
      {habits.length === 0 ? (
        <EmptyState onCreate={openCreateMenu} />
      ) : mode === "today" ? (
        <TodayMode habits={habits} cursor={cursor} today={today} />
      ) : (
        <ReviewMode habits={habits} />
      )}
    </div>
  );
};

const EmptyState: React.FC<{ onCreate: () => void }> = ({ onCreate }) => (
  <div className="kp-habits__empty">
    <p>No habits yet — create one from the new menu.</p>
    <button className="kp-btn kp-btn--cta" onClick={onCreate}>
      New habit
    </button>
  </div>
);

// ----- Today view -----

interface TodayModeProps {
  habits: Habit[];
  cursor: Date;
  today: Date;
}

const TodayMode: React.FC<TodayModeProps> = ({ habits, cursor, today }) => {
  const { store } = usePlugin();
  const logs = store(selectLogList);
  return (
    <div className="kp-habits__today">
      <div className="kp-habits__datebar">
        <span className="kp-habits__daylabel">{format(cursor, "EEEE, MMMM d, yyyy")}</span>
      </div>
      {habits.map((h) => (
        <TodayRow key={h.path} habit={h} logs={logs} when={cursor} today={today} />
      ))}
    </div>
  );
};

const TodayRow: React.FC<{ habit: Habit; logs: Log[]; when: Date; today: Date }> = ({
  habit,
  logs,
  when,
  today,
}) => {
  const { habitService, store } = usePlugin();
  const projectsMap = store((s) => s.projects);
  const project = Object.values(projectsMap).find((p) => p.name === habit.project);
  const isCursorToday = isSameDay(when, today);
  const counts = React.useMemo(() => completionCounts(habit, logs), [habit, logs]);
  // Streak is "as of now," not "as of cursor day" — looking back at a past day
  // shouldn't change the live streak readout.
  const streak = React.useMemo(() => computeStreak(habit, counts, today), [habit, counts, today]);
  const periodCount = counts.get(periodKey(when, habit.frequency)) ?? 0;
  const progress = periodCount / habit.target;
  const intensity = progressIntensity(progress);

  const cadence = `${habit.target}× ${HABIT_FREQUENCY_LABEL[habit.frequency].toLowerCase()}`;
  const periodLabel =
    habit.frequency === "daily"
      ? isCursorToday
        ? "today"
        : "this day"
      : habit.frequency === "weekly"
      ? "this week"
      : "this month";
  const dayLabel = isCursorToday ? "today" : "on this day";

  const accent = project?.color ?? "var(--background-modifier-border)";
  const rowStyle: React.CSSProperties = {
    ["--kp-card-stripe" as string]: accent,
    ["--kp-card-border" as string]: accent,
  };

  const addTick = async () => {
    try {
      await habitService.logCompletion(habit, logs, when);
    } catch (e) {
      console.error(e);
      const msg = e instanceof Error ? e.message : String(e);
      new Notice(`Failed to mark habit: ${msg}`);
    }
  };

  const open = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest("[data-no-open]")) return;
    const overrideMode = e.metaKey || e.ctrlKey ? "tab" : undefined;
    void habitService.openInNewLeaf(habit, overrideMode);
  };

  // Render one green check per completed tick. The "+" button at the end of
  // the row is the primary action — it always adds a tick on the cursor day.
  // Undo is not available from the Today row by design (use the Review grid
  // or open the log file directly).

  return (
    <div
      className={`kp-today-row kp-progress-${intensity} ${
        habit.state === "paused" ? "is-paused" : ""
      }`}
      style={rowStyle}
      onClick={open}
    >
      <button
        type="button"
        className="kp-tick-action"
        data-no-open
        aria-label="Mark done"
        title={`Mark done ${dayLabel}${periodCount >= habit.target ? " (bonus)" : ""}`}
        onClick={(e) => {
          e.stopPropagation();
          void addTick();
        }}
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M20 6 9 17l-5-5" />
        </svg>
      </button>

      <div className="kp-today-row__main">
        {habit.code && <span className="kp-code">{habit.code}</span>}
        <span className="kp-today-row__name">{habit.title}</span>
        {habit.goal && (
          <span className="kp-today-row__goal" title={habit.goal}>
            · {habit.goal}
          </span>
        )}
      </div>

      <div className="kp-today-row__pips" data-no-open onClick={(e) => e.stopPropagation()}>
        {Array.from({ length: Math.max(habit.target, periodCount) }).map((_, i) => {
          const isBonus = i >= habit.target;
          const isDone = i < periodCount;
          const variant = isBonus ? "is-bonus" : isDone ? "is-done" : "is-pending";
          const label = isBonus
            ? `Bonus tick ${i - habit.target + 1}`
            : isDone
            ? `Tick ${i + 1} of ${habit.target}`
            : `Pending ${i + 1} of ${habit.target}`;
          return (
            <span key={i} className={`kp-tick ${variant}`} aria-label={label}>
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="3.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                <path d="M20 6 9 17l-5-5" />
              </svg>
            </span>
          );
        })}
      </div>

      <span
        className="kp-chip kp-chip--frequency kp-today-row__cadencepill"
        title={`${periodCount} of ${habit.target} ${periodLabel}`}
      >
        <span className="kp-chip__label">{cadence}</span>
      </span>

      <div
        className={`kp-today-row__streak ${
          isCursorToday && streak.current > 0 ? "is-hot" : ""
        } ${isCursorToday ? "" : "is-stale"}`}
        title={
          isCursorToday
            ? "Current / longest streak"
            : "Streak is only meaningful for today"
        }
      >
        <Icon name="flame" size={12} />
        <span>{isCursorToday ? streak.current : "?"}</span>
        <span className="kp-habit-row__streak-sep">/</span>
        <span>{isCursorToday ? streak.longest : "x"}</span>
      </div>
    </div>
  );
};

// ----- Review view -----

const ReviewMode: React.FC<{ habits: Habit[] }> = ({ habits }) => {
  const { store, settings } = usePlugin();
  const logs = store(selectLogList);
  const days = React.useMemo(() => pastDays(new Date(), settings.habitReviewDays), [settings.habitReviewDays]);
  const monthHeaders = React.useMemo(() => buildMonthHeaders(days), [days]);
  const weekHeaders = React.useMemo(() => buildWeekHeaders(days), [days]);
  const scrollRef = React.useRef<HTMLDivElement | null>(null);

  // Anchor the scroll position to the right edge (today) on mount and whenever
  // the column count changes — the grid is laid out chronologically with today
  // at the far right, and the most recent days are what the user wants to see
  // first.
  React.useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollLeft = el.scrollWidth;
  }, [days.length, habits.length]);

  return (
    <div className="kp-habits__review">
      <div className="kp-review">
        {/* Left: fixed sidebar with habit names. Doesn't scroll. */}
        <div className="kp-review__sidebar">
          <div className="kp-review__corner" />
          {habits.map((habit) => (
            <ReviewRowhead key={habit.path} habit={habit} />
          ))}
        </div>

        {/* Right: horizontally scrolling grid of headers + day cells. */}
        <div className="kp-review__scroll" ref={scrollRef}>
          <div
            className="kp-review__grid"
            style={{ ["--kp-review-cols" as string]: days.length }}
          >
            {monthHeaders.map((h) => (
              <div
                key={`m-${h.start}`}
                className="kp-review__monthhead"
                style={{ gridColumn: `${h.start + 1} / span ${h.span}` }}
              >
                {h.label}
              </div>
            ))}

            {weekHeaders.map((h) => (
              <div
                key={`w-${h.start}`}
                className="kp-review__weekhead"
                style={{ gridColumn: `${h.start + 1} / span ${h.span}` }}
              >
                {h.label}
              </div>
            ))}

            {days.map((d, i) => {
              const today = isSameDay(d, new Date());
              return (
                <div
                  key={`d-${i}`}
                  className={`kp-review__dayhead ${today ? "is-today" : ""}`}
                  title={fmtISO(d)}
                  style={{ gridColumn: i + 1 }}
                >
                  {d.getDate()}
                </div>
              );
            })}

            {habits.map((habit) => (
              <ReviewCells key={habit.path} habit={habit} days={days} logs={logs} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

const ReviewRowhead: React.FC<{ habit: Habit }> = ({ habit }) => {
  const { habitService, store } = usePlugin();
  const projectsMap = store((s) => s.projects);
  const project = Object.values(projectsMap).find((p) => p.name === habit.project);
  const accent = project?.color ?? "var(--background-modifier-border)";
  const cadence = `${habit.target}× ${HABIT_FREQUENCY_LABEL[habit.frequency].toLowerCase()}`;
  return (
    <div
      className="kp-review__rowhead"
      style={{ ["--kp-card-stripe" as string]: accent }}
      onClick={(e) =>
        void habitService.openInNewLeaf(habit, e.metaKey || e.ctrlKey ? "tab" : undefined)
      }
    >
      {habit.code && <span className="kp-code">{habit.code}</span>}
      <span className="kp-review__rowtitle">{habit.title}</span>
      <span className="kp-review__rowcadence">{cadence}</span>
    </div>
  );
};

const ReviewCells: React.FC<{ habit: Habit; days: Date[]; logs: Log[] }> = ({
  habit,
  days,
  logs,
}) => {
  const dayMap = React.useMemo(() => dayCounts(habit, logs), [habit, logs]);
  const periodMap = React.useMemo(() => completionCounts(habit, logs), [habit, logs]);
  const bonusDays = React.useMemo(() => bonusTickDays(habit, logs), [habit, logs]);

  return (
    <>
      {days.map((d, i) => {
        const iso = fmtISO(d);
        const dayCount = dayMap.get(iso) ?? 0;
        // Backdrop tint comes from the period's aggregate progress so weekly /
        // monthly cells in the same week / month share a goal-met indicator.
        // Daily habits use the day's own progress.
        let progress: number;
        if (habit.frequency === "daily") {
          progress = dayCount / habit.target;
        } else {
          const periodTotal = periodMap.get(periodKey(d, habit.frequency)) ?? 0;
          progress = periodTotal / habit.target;
        }
        const intensity = progressIntensity(progress);
        const hasTick = dayCount > 0;
        const isBonus = hasTick && bonusDays.has(iso);
        const today = isSameDay(d, new Date());
        const variant = !hasTick ? "is-empty" : isBonus ? "is-bonus" : "is-done";
        return (
          <div
            key={`c-${habit.path}-${iso}`}
            className={`kp-review__cell kp-progress-${intensity} ${variant} ${
              today ? "is-today" : ""
            }`}
            title={`${iso} — ${dayCount}× (target ${habit.target} per ${HABIT_FREQUENCY_LABEL[
              habit.frequency
            ].toLowerCase()})`}
            data-col={i + 1}
          >
            <span className="kp-review__cellbg" aria-hidden />
            {hasTick && (
              <svg
                className="kp-review__cellcheck"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="3.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                <path d="M20 6 9 17l-5-5" />
              </svg>
            )}
          </div>
        );
      })}
    </>
  );
};

// ----- helpers -----

type Intensity = "0" | "1" | "2" | "3" | "4";

function progressIntensity(progress: number): Intensity {
  if (progress <= 0) return "0";
  if (progress < 0.5) return "1";
  if (progress < 1) return "2";
  if (progress < 1.5) return "3";
  return "4";
}

interface HeaderSpan {
  label: string;
  start: number; // zero-based column index
  span: number;
}

function buildMonthHeaders(days: Date[]): HeaderSpan[] {
  const out: HeaderSpan[] = [];
  if (days.length === 0) return out;
  let runStart = 0;
  for (let i = 1; i <= days.length; i++) {
    const same = i < days.length && isSameMonth(days[i], days[runStart]);
    if (!same) {
      const d = days[runStart];
      out.push({
        label: d.toLocaleDateString(undefined, { month: "short", year: "2-digit" }),
        start: runStart,
        span: i - runStart,
      });
      runStart = i;
    }
  }
  return out;
}

function buildWeekHeaders(days: Date[]): HeaderSpan[] {
  const out: HeaderSpan[] = [];
  if (days.length === 0) return out;
  const weekOf = (d: Date) => `${d.getFullYear()}-${getISOWeek(d)}`;
  let runStart = 0;
  for (let i = 1; i <= days.length; i++) {
    const same = i < days.length && weekOf(days[i]) === weekOf(days[runStart]);
    if (!same) {
      out.push({
        label: `W${getISOWeek(days[runStart])}`,
        start: runStart,
        span: i - runStart,
      });
      runStart = i;
    }
  }
  return out;
}
