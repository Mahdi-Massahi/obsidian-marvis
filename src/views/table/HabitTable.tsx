import * as React from "react";
import { Notice } from "obsidian";
import { usePlugin } from "../context";
import type { Habit, HabitFrequency, HabitState } from "../../schema/types";
import { HABIT_FREQUENCIES, HABIT_FREQUENCY_LABEL, HABIT_STATES, HABIT_STATE_LABEL } from "../../schema/types";
import { listProjectFolders } from "../../services/taskService";
import { Icon, IconName } from "../shared/Icon";
import { ConfirmModal } from "../shared/ConfirmModal";
import { applyHabitFilter } from "../../filter/filterEngine";
import { completionCounts, computeStreak } from "../../utils/habits";
import { selectLogList } from "../../index/store";

export const HabitTable: React.FC = () => {
  const { store, app, settings, habitService } = usePlugin();
  const habitsMap = store((s) => s.habits);
  const filter = store((s) => s.filter);
  const logs = store(selectLogList);

  const habits = React.useMemo(() => {
    return applyHabitFilter(Object.values(habitsMap), filter).sort((a, b) => {
      if (a.project !== b.project) return a.project.localeCompare(b.project);
      return a.title.localeCompare(b.title);
    });
  }, [habitsMap, filter]);

  const projects = listProjectFolders(app, settings.rootFolder);

  const [selected, setSelected] = React.useState<Set<string>>(new Set());

  const toggleRow = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };

  const allChecked = habits.length > 0 && habits.every((h) => selected.has(h.id));
  const toggleAll = () => {
    if (allChecked) setSelected(new Set());
    else setSelected(new Set(habits.map((h) => h.id)));
  };

  const targets = () => habits.filter((h) => selected.has(h.id));

  const bulkSetFrequency = async (frequency: HabitFrequency) => {
    for (const h of targets()) await habitService.setFrequency(h, frequency);
    setSelected(new Set());
  };

  const bulkSetState = async (state: HabitState) => {
    for (const h of targets()) await habitService.setState(h, state);
    setSelected(new Set());
  };

  const bulkSetProject = async (project: string) => {
    for (const h of targets()) await habitService.setProject(h, project);
    setSelected(new Set());
  };

  const bulkArchive = async () => {
    for (const h of targets()) await habitService.archive(h);
    setSelected(new Set());
  };

  const bulkDelete = () => {
    const items = targets();
    if (items.length === 0) return;
    new ConfirmModal(
      app,
      `Delete ${items.length} habit${items.length === 1 ? "" : "s"}`,
      `Permanently delete ${items.length} selected habit${items.length === 1 ? "" : "s"}? Files are moved to trash.`,
      async () => {
        for (const h of items) await habitService.deleteHabit(h);
        new Notice(`Deleted ${items.length} habit${items.length === 1 ? "" : "s"}`);
        setSelected(new Set());
      }
    ).open();
  };

  return (
    <>
      {selected.size > 0 && (
        <div className="kp-bulkbar">
          <span>{selected.size} selected</span>
          <select
            onChange={(e) => {
              if (e.target.value) void bulkSetFrequency(e.target.value as HabitFrequency);
              e.target.value = "";
            }}
            defaultValue=""
          >
            <option value="" disabled>
              Set frequency…
            </option>
            {HABIT_FREQUENCIES.map((f) => (
              <option key={f} value={f}>
                {HABIT_FREQUENCY_LABEL[f]}
              </option>
            ))}
          </select>
          <select
            onChange={(e) => {
              if (e.target.value) void bulkSetState(e.target.value as HabitState);
              e.target.value = "";
            }}
            defaultValue=""
          >
            <option value="" disabled>
              Set state…
            </option>
            {HABIT_STATES.map((s) => (
              <option key={s} value={s}>
                {HABIT_STATE_LABEL[s]}
              </option>
            ))}
          </select>
          <select
            onChange={(e) => {
              if (e.target.value) void bulkSetProject(e.target.value);
              e.target.value = "";
            }}
            defaultValue=""
          >
            <option value="" disabled>
              Move to project…
            </option>
            {projects.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
          <button className="kp-btn kp-btn--ghost" onClick={() => void bulkArchive()}>
            Archive
          </button>
          <button className="kp-btn kp-btn--ghost kp-btn--danger" onClick={bulkDelete}>
            Delete
          </button>
          <button className="kp-btn kp-btn--ghost" onClick={() => setSelected(new Set())}>
            Clear
          </button>
        </div>
      )}
      <div className="kp-table__wrap">
        <table className="kp-table">
          <thead>
            <tr>
              <th className="kp-table__check">
                <input type="checkbox" checked={allChecked} onChange={toggleAll} />
              </th>
              <HabitTh icon="repeat" label="Name" />
              <HabitTh icon="folder" label="Project" />
              <HabitTh icon="flag" label="Milestone" />
              <HabitTh icon="repeat" label="Frequency" />
              <HabitTh icon="hash" label="Target" />
              <HabitTh icon="status" label="State" />
              <HabitTh icon="hash" label="Goal" />
              <HabitTh icon="flame" label="Streak" />
              <HabitTh icon="more" label="Actions" />
            </tr>
          </thead>
          <tbody>
            {habits.map((h) => (
              <HabitRow
                key={h.id}
                habit={h}
                projects={projects}
                logs={logs}
                checked={selected.has(h.id)}
                onToggle={() => toggleRow(h.id)}
              />
            ))}
            {habits.length === 0 && (
              <tr>
                <td colSpan={10} className="kp-empty">
                  No habits yet — create one from the new menu.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
};

const HabitTh: React.FC<{ icon: IconName; label: string }> = ({ icon, label }) => (
  <th>
    <span className="kp-table__th-inner">
      <Icon name={icon} size={13} />
      {label}
    </span>
  </th>
);

interface RowProps {
  habit: Habit;
  projects: string[];
  logs: ReturnType<typeof selectLogList>;
  checked: boolean;
  onToggle: () => void;
}

const HabitRow: React.FC<RowProps> = ({ habit, projects, logs, checked, onToggle }) => {
  const { habitService, store } = usePlugin();
  const projectsMap = store((s) => s.projects);
  const projectObj = Object.values(projectsMap).find((p) => p.name === habit.project);
  const streak = React.useMemo(
    () => computeStreak(habit, completionCounts(habit, logs), new Date()),
    [habit, logs]
  );
  return (
    <tr>
      <td className="kp-table__check">
        <input type="checkbox" checked={checked} onChange={onToggle} />
      </td>
      <td>
        <a
          className="kp-table__title"
          title={habit.title}
          onClick={(e) =>
            void habitService.openInNewLeaf(habit, e.metaKey || e.ctrlKey ? "tab" : undefined)
          }
        >
          <Icon name="repeat" size={13} />
          {habit.code && <span className="kp-code">{habit.code}</span>}
          <span className="kp-table__title-text">{habit.title}</span>
        </a>
      </td>
      <td>
        <div className="kp-table__project-cell">
          <span
            className="kp-table__color-dot"
            style={{ background: projectObj?.color ?? "transparent" }}
            aria-hidden
          />
          <select
            value={habit.project}
            onChange={(e) => void habitService.setProject(habit, e.target.value)}
          >
            {projects.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
            {!projects.includes(habit.project) && (
              <option value={habit.project}>{habit.project}</option>
            )}
          </select>
        </div>
      </td>
      <td>{habit.milestone ?? "—"}</td>
      <td>
        <select
          value={habit.frequency}
          onChange={(e) =>
            void habitService.setFrequency(habit, e.target.value as HabitFrequency)
          }
        >
          {HABIT_FREQUENCIES.map((f) => (
            <option key={f} value={f}>
              {HABIT_FREQUENCY_LABEL[f]}
            </option>
          ))}
        </select>
      </td>
      <td>
        <input
          type="number"
          min={1}
          step={1}
          defaultValue={habit.target}
          className="kp-habit-target-input"
          onBlur={(e) => {
            const n = parseInt(e.target.value, 10);
            if (Number.isFinite(n) && n >= 1 && n !== habit.target) {
              void habitService.setTarget(habit, n);
            } else if (!Number.isFinite(n) || n < 1) {
              e.target.value = String(habit.target);
            }
          }}
        />
      </td>
      <td>
        <select
          value={habit.state}
          onChange={(e) => void habitService.setState(habit, e.target.value as HabitState)}
        >
          {HABIT_STATES.map((s) => (
            <option key={s} value={s}>
              {HABIT_STATE_LABEL[s]}
            </option>
          ))}
        </select>
      </td>
      <td>
        <input
          type="text"
          defaultValue={habit.goal ?? ""}
          placeholder="Goal…"
          onBlur={(e) => {
            const v = e.target.value.trim();
            if (v !== (habit.goal ?? "")) {
              void habitService.setGoal(habit, v || undefined);
            }
          }}
        />
      </td>
      <td>
        <span className="kp-table__streak">
          <Icon name="flame" size={12} />
          {streak.current}
          <span className="kp-habit-row__streak-sep">/</span>
          {streak.longest}
        </span>
      </td>
      <td>
        <button
          className="kp-btn kp-btn--ghost"
          onClick={(e) =>
            void habitService.openInNewLeaf(habit, e.metaKey || e.ctrlKey ? "tab" : undefined)
          }
        >
          Open
        </button>
      </td>
    </tr>
  );
};
