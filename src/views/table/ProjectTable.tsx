import * as React from "react";
import { Notice } from "obsidian";
import { usePlugin } from "../context";
import type { Project } from "../../schema/types";
import { PROJECT_PALETTE } from "../../schema/types";
import { Icon, IconName } from "../shared/Icon";

const PROJECT_STATUSES: Project["status"][] = ["active", "paused", "done", "archived"];

export const ProjectTable: React.FC = () => {
  const { store, projectService } = usePlugin();
  const projectsMap = store((s) => s.projects);
  const tasksMap = store((s) => s.tasks);
  const milestonesMap = store((s) => s.milestones);

  const projects = React.useMemo(
    () => Object.values(projectsMap).sort((a, b) => a.name.localeCompare(b.name)),
    [projectsMap]
  );

  const taskCounts = React.useMemo(() => {
    const counts = new Map<string, number>();
    for (const t of Object.values(tasksMap)) {
      if (!t.project || t.archived) continue;
      counts.set(t.project, (counts.get(t.project) ?? 0) + 1);
    }
    return counts;
  }, [tasksMap]);

  const milestoneCounts = React.useMemo(() => {
    const counts = new Map<string, number>();
    for (const m of Object.values(milestonesMap)) {
      if (!m.project) continue;
      counts.set(m.project, (counts.get(m.project) ?? 0) + 1);
    }
    return counts;
  }, [milestonesMap]);

  return (
    <div className="kp-table__wrap">
      <table className="kp-table">
        <thead>
          <tr>
            <ProjTh icon="folder" label="Name" />
            <ProjTh icon="status" label="Status" />
            <ProjTh icon="palette" label="Color" />
            <ProjTh icon="check" label="Tasks" />
            <ProjTh icon="flag" label="Milestones" />
            <ProjTh icon="calendar" label="Created" />
            <ProjTh icon="more" label="Actions" />
          </tr>
        </thead>
        <tbody>
          {projects.map((p) => (
            <ProjectRow
              key={p.id}
              project={p}
              taskCount={taskCounts.get(p.name) ?? 0}
              milestoneCount={milestoneCounts.get(p.name) ?? 0}
            />
          ))}
          <NewProjectRow />
          {projects.length === 0 && (
            <tr>
              <td colSpan={7} className="kp-empty">
                No projects yet — click the row below to add one.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
};

const ProjTh: React.FC<{ icon: IconName; label: string }> = ({ icon, label }) => (
  <th>
    <span className="kp-table__th-inner">
      <Icon name={icon} size={13} />
      {label}
    </span>
  </th>
);

interface ProjectRowProps {
  project: Project;
  taskCount: number;
  milestoneCount: number;
}

const ProjectRow: React.FC<ProjectRowProps> = ({ project, taskCount, milestoneCount }) => {
  const { projectService } = usePlugin();
  return (
    <tr>
      <td>
        <a
          className="kp-table__title"
          onClick={(e) =>
            void projectService.openInNewLeaf(
              project,
              e.metaKey || e.ctrlKey ? "tab" : undefined
            )
          }
        >
          <span
            className="kp-table__color-dot"
            style={{ background: project.color }}
            aria-hidden
          />
          {project.title}
        </a>
      </td>
      <td>
        <select
          value={project.status}
          onChange={(e) => void projectService.setStatus(project, e.target.value as Project["status"])}
        >
          {PROJECT_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </td>
      <td>
        <input
          type="color"
          value={project.color}
          onChange={(e) => void projectService.setColor(project, e.target.value)}
          className="kp-table__color"
        />
      </td>
      <td>{taskCount}</td>
      <td>{milestoneCount}</td>
      <td>{project.created ?? "—"}</td>
      <td>
        <button
          className="kp-btn kp-btn--ghost"
          onClick={(e) =>
            void projectService.openInNewLeaf(
              project,
              e.metaKey || e.ctrlKey ? "tab" : undefined
            )
          }
        >
          Open
        </button>
      </td>
    </tr>
  );
};

const NewProjectRow: React.FC = () => {
  const { projectService } = usePlugin();
  const [editing, setEditing] = React.useState(false);
  const [name, setName] = React.useState("");
  const [color, setColor] = React.useState(PROJECT_PALETTE[0]);
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const reset = () => {
    setName("");
    setEditing(false);
  };

  const submit = async () => {
    const n = name.trim();
    if (!n) {
      reset();
      return;
    }
    try {
      await projectService.createProject(n, color);
      new Notice(`Project ${n} created`);
    } catch (e) {
      console.error(e);
      new Notice("Failed to create project — see console");
    }
    reset();
  };

  if (!editing) {
    return (
      <tr className="kp-newrow" onClick={() => setEditing(true)}>
        <td colSpan={7}>
          <span className="kp-newrow__label">+ New project</span>
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
          placeholder="Project name…"
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
      <td>active</td>
      <td>
        <input
          type="color"
          value={color}
          onChange={(e) => setColor(e.target.value)}
          className="kp-table__color"
        />
      </td>
      <td>0</td>
      <td>0</td>
      <td>—</td>
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
