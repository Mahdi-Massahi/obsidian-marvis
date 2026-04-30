import * as React from "react";
import { Notice } from "obsidian";
import { usePlugin } from "../context";
import type { Milestone } from "../../schema/types";
import { listProjectFolders } from "../../services/taskService";
import { Icon, IconName } from "../shared/Icon";

const MILESTONE_STATUSES: Milestone["status"][] = ["planned", "active", "done"];

export const MilestoneTable: React.FC = () => {
  const { store, app, settings } = usePlugin();
  const milestonesMap = store((s) => s.milestones);
  const tasksMap = store((s) => s.tasks);

  const milestones = React.useMemo(
    () =>
      Object.values(milestonesMap).sort((a, b) => {
        const ap = a.project ?? "";
        const bp = b.project ?? "";
        if (ap !== bp) return ap.localeCompare(bp);
        return a.name.localeCompare(b.name);
      }),
    [milestonesMap]
  );

  const taskCounts = React.useMemo(() => {
    const counts = new Map<string, number>();
    for (const t of Object.values(tasksMap)) {
      if (!t.milestone || t.archived) continue;
      counts.set(t.milestone, (counts.get(t.milestone) ?? 0) + 1);
    }
    return counts;
  }, [tasksMap]);

  const projects = listProjectFolders(app, settings.rootFolder);

  return (
    <div className="kp-table__wrap">
      <table className="kp-table">
        <thead>
          <tr>
            <MsTh icon="flag" label="Name" />
            <MsTh icon="folder" label="Project" />
            <MsTh icon="status" label="Status" />
            <MsTh icon="calendar" label="Due" />
            <MsTh icon="check" label="Tasks" />
            <MsTh icon="more" label="Actions" />
          </tr>
        </thead>
        <tbody>
          {milestones.map((m) => (
            <MilestoneRow
              key={m.id}
              milestone={m}
              projects={projects}
              taskCount={taskCounts.get(m.name) ?? 0}
            />
          ))}
          <NewMilestoneRow projects={projects} />
          {milestones.length === 0 && (
            <tr>
              <td colSpan={6} className="kp-empty">
                No milestones yet — click the row below to add one.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
};

const MsTh: React.FC<{ icon: IconName; label: string }> = ({ icon, label }) => (
  <th>
    <span className="kp-table__th-inner">
      <Icon name={icon} size={13} />
      {label}
    </span>
  </th>
);

interface RowProps {
  milestone: Milestone;
  projects: string[];
  taskCount: number;
}

const MilestoneRow: React.FC<RowProps> = ({ milestone, projects, taskCount }) => {
  const { milestoneService } = usePlugin();
  return (
    <tr>
      <td>
        <a
          className="kp-table__title"
          onClick={() => void milestoneService.openInNewLeaf(milestone)}
        >
          <Icon name="flag" size={13} />
          {milestone.title}
        </a>
      </td>
      <td>
        <select
          value={milestone.project ?? ""}
          onChange={(e) => void milestoneService.setProject(milestone, e.target.value)}
        >
          {projects.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
          {milestone.project && !projects.includes(milestone.project) && (
            <option value={milestone.project}>{milestone.project}</option>
          )}
        </select>
      </td>
      <td>
        <select
          value={milestone.status}
          onChange={(e) =>
            void milestoneService.setStatus(milestone, e.target.value as Milestone["status"])
          }
        >
          {MILESTONE_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </td>
      <td>
        <input
          type="date"
          value={milestone.due ?? ""}
          onChange={(e) => void milestoneService.setDue(milestone, e.target.value || undefined)}
        />
      </td>
      <td>{taskCount}</td>
      <td>
        <button
          className="kp-btn kp-btn--ghost"
          onClick={() => void milestoneService.openInNewLeaf(milestone)}
        >
          Open
        </button>
      </td>
    </tr>
  );
};

const NewMilestoneRow: React.FC<{ projects: string[] }> = ({ projects }) => {
  const { milestoneService } = usePlugin();
  const [editing, setEditing] = React.useState(false);
  const [name, setName] = React.useState("");
  const [project, setProject] = React.useState(projects[0] ?? "");
  const [due, setDue] = React.useState("");
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  React.useEffect(() => {
    if (!project && projects.length > 0) setProject(projects[0]);
  }, [projects, project]);

  const reset = () => {
    setName("");
    setEditing(false);
  };

  const submit = async () => {
    const n = name.trim();
    if (!n || !project) {
      reset();
      return;
    }
    try {
      await milestoneService.createMilestone(project, n, { due: due || undefined });
      new Notice(`Milestone ${n} created`);
    } catch (e) {
      console.error(e);
      new Notice("Failed to create milestone — see console");
    }
    reset();
  };

  if (!editing) {
    return (
      <tr
        className="kp-newrow"
        onClick={() => {
          if (projects.length === 0) {
            new Notice("Create a project first.");
            return;
          }
          setEditing(true);
        }}
      >
        <td colSpan={6}>
          <span className="kp-newrow__label">+ New milestone</span>
        </td>
      </tr>
    );
  }

  return (
    <tr className="kp-newrow kp-newrow--editing">
      <td>
        <input
          ref={inputRef}
          type="text"
          placeholder="Milestone name…"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void submit();
            if (e.key === "Escape") reset();
          }}
          onBlur={() => {
            if (!name.trim()) reset();
          }}
        />
      </td>
      <td>
        <select value={project} onChange={(e) => setProject(e.target.value)}>
          {projects.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </td>
      <td>planned</td>
      <td>
        <input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
      </td>
      <td>0</td>
      <td>
        <button
          className="kp-btn kp-btn--primary"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => void submit()}
        >
          Add
        </button>
      </td>
    </tr>
  );
};
