import * as React from "react";
import { Notice } from "obsidian";
import { usePlugin } from "../context";
import type { Milestone } from "../../schema/types";
import { listProjectFolders } from "../../services/taskService";
import { Icon, IconName } from "../shared/Icon";
import { ConfirmModal } from "../shared/ConfirmModal";

const MILESTONE_STATUSES: Milestone["status"][] = ["planned", "active", "done"];

export const MilestoneTable: React.FC = () => {
  const { store, app, settings, milestoneService } = usePlugin();
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

  const [selected, setSelected] = React.useState<Set<string>>(new Set());

  const toggleRow = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };

  const allChecked = milestones.length > 0 && milestones.every((m) => selected.has(m.id));
  const toggleAll = () => {
    if (allChecked) setSelected(new Set());
    else setSelected(new Set(milestones.map((m) => m.id)));
  };

  const targets = () => milestones.filter((m) => selected.has(m.id));

  const bulkSetStatus = async (status: Milestone["status"]) => {
    for (const m of targets()) await milestoneService.setStatus(m, status);
    setSelected(new Set());
  };

  const bulkSetProject = async (project: string) => {
    for (const m of targets()) await milestoneService.setProject(m, project);
    setSelected(new Set());
  };

  const bulkArchive = async () => {
    for (const m of targets()) await milestoneService.archive(m);
    setSelected(new Set());
  };

  const bulkDelete = () => {
    const items = targets();
    if (items.length === 0) return;
    new ConfirmModal(
      app,
      `Delete ${items.length} milestone${items.length === 1 ? "" : "s"}`,
      `Permanently delete ${items.length} selected milestone${items.length === 1 ? "" : "s"}? Files are moved to trash.`,
      async () => {
        for (const m of items) await milestoneService.deleteMilestone(m);
        new Notice(`Deleted ${items.length} milestone${items.length === 1 ? "" : "s"}`);
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
              if (e.target.value) void bulkSetStatus(e.target.value as Milestone["status"]);
              e.target.value = "";
            }}
            defaultValue=""
          >
            <option value="" disabled>
              Set status…
            </option>
            {MILESTONE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
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
              <MsTh icon="flag" label="Name" />
              <MsTh icon="folder" label="Project" />
              <MsTh icon="status" label="Status" />
              <MsTh icon="calendar" label="Due" />
              <MsTh icon="clock" label="Created" />
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
                checked={selected.has(m.id)}
                onToggle={() => toggleRow(m.id)}
              />
            ))}
            <NewMilestoneRow projects={projects} />
            {milestones.length === 0 && (
              <tr>
                <td colSpan={8} className="kp-empty">
                  No milestones yet — click the row below to add one.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
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
  checked: boolean;
  onToggle: () => void;
}

const MilestoneRow: React.FC<RowProps> = ({
  milestone,
  projects,
  taskCount,
  checked,
  onToggle,
}) => {
  const { milestoneService, store } = usePlugin();
  const projectsMap = store((s) => s.projects);
  const projectObj = milestone.project
    ? Object.values(projectsMap).find((p) => p.name === milestone.project)
    : undefined;
  return (
    <tr>
      <td className="kp-table__check">
        <input type="checkbox" checked={checked} onChange={onToggle} />
      </td>
      <td>
        <a
          className="kp-table__title"
          onClick={(e) =>
            void milestoneService.openInNewLeaf(
              milestone,
              e.metaKey || e.ctrlKey ? "tab" : undefined
            )
          }
        >
          <Icon name="flag" size={13} />
          {milestone.code && <span className="kp-code">{milestone.code}</span>}
          {milestone.title}
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
        </div>
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
      <td className="kp-table__created">{milestone.created ?? "—"}</td>
      <td>{taskCount}</td>
      <td>
        <button
          className="kp-btn kp-btn--ghost"
          onClick={(e) =>
            void milestoneService.openInNewLeaf(
              milestone,
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

const NewMilestoneRow: React.FC<{ projects: string[] }> = ({ projects }) => {
  const { milestoneService, store } = usePlugin();
  const projectsMap = store((s) => s.projects);
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
        <td className="kp-table__check" />
        <td colSpan={7}>
          <span className="kp-newrow__label">+ New milestone</span>
        </td>
      </tr>
    );
  }

  return (
    <tr className="kp-newrow kp-newrow--editing">
      <td className="kp-table__check" />
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
        <div className="kp-table__project-cell">
          <span
            className="kp-table__color-dot"
            style={{
              background:
                Object.values(projectsMap).find((p) => p.name === project)?.color ??
                "transparent",
            }}
            aria-hidden
          />
          <select value={project} onChange={(e) => setProject(e.target.value)}>
            {projects.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>
      </td>
      <td>planned</td>
      <td>
        <input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
      </td>
      <td className="kp-table__created">—</td>
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
