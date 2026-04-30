import * as React from "react";
import { usePlugin } from "../context";
import { applyFilter } from "../../filter/filterEngine";
import type { Task } from "../../schema/types";
import { listProjectFolders } from "../../services/taskService";
import { Icon, IconName } from "../shared/Icon";

type SortKey = "title" | "project" | "milestone" | "status" | "priority" | "due";

const COLUMN_ICONS: Record<SortKey | "tags" | "actions", IconName> = {
  title: "text",
  project: "folder",
  milestone: "flag",
  status: "status",
  priority: "priority",
  due: "calendar",
  tags: "hash",
  actions: "more",
};

export const TaskTable: React.FC = () => {
  const { store, settings, taskService, app } = usePlugin();
  const tasksMap = store((s) => s.tasks);
  const filter = store((s) => s.filter);
  const allTasks = React.useMemo(() => Object.values(tasksMap), [tasksMap]);
  const filtered = React.useMemo(() => applyFilter(allTasks, filter), [allTasks, filter]);

  const [sortKey, setSortKey] = React.useState<SortKey>("due");
  const [sortDir, setSortDir] = React.useState<"asc" | "desc">("asc");
  const [selected, setSelected] = React.useState<Set<string>>(new Set());

  const sorted = React.useMemo(() => {
    const dir = sortDir === "asc" ? 1 : -1;
    return filtered.slice().sort((a, b) => {
      const av = (a[sortKey] ?? "") as string;
      const bv = (b[sortKey] ?? "") as string;
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return 0;
    });
  }, [filtered, sortKey, sortDir]);

  const toggleSort = (k: SortKey) => {
    if (sortKey === k) setSortDir(sortDir === "asc" ? "desc" : "asc");
    else {
      setSortKey(k);
      setSortDir("asc");
    }
  };

  const projects = listProjectFolders(app, settings.rootFolder);

  const toggleRow = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };

  const allChecked = sorted.length > 0 && sorted.every((t) => selected.has(t.id));
  const toggleAll = () => {
    if (allChecked) setSelected(new Set());
    else setSelected(new Set(sorted.map((t) => t.id)));
  };

  const bulkSetStatus = async (status: string) => {
    const tasks = sorted.filter((t) => selected.has(t.id));
    for (const t of tasks) await taskService.setStatus(t, status);
    setSelected(new Set());
  };

  const bulkSetPriority = async (priority: string) => {
    const tasks = sorted.filter((t) => selected.has(t.id));
    for (const t of tasks) await taskService.setPriority(t, priority);
    setSelected(new Set());
  };

  const bulkArchive = async () => {
    const tasks = sorted.filter((t) => selected.has(t.id));
    for (const t of tasks) await taskService.archive(t);
    setSelected(new Set());
  };

  return (
    <>
      {selected.size > 0 && (
        <div className="kp-bulkbar">
          <span>{selected.size} selected</span>
          <select
            onChange={(e) => {
              if (e.target.value) void bulkSetStatus(e.target.value);
              e.target.value = "";
            }}
            defaultValue=""
          >
            <option value="" disabled>
              Set status…
            </option>
            {settings.statuses.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
          <select
            onChange={(e) => {
              const v = e.target.value;
              if (v === "__none") void bulkSetPriority("");
              else if (v) void bulkSetPriority(v);
              e.target.value = "";
            }}
            defaultValue=""
          >
            <option value="" disabled>
              Set priority…
            </option>
            <option value="__none">— none —</option>
            {settings.priorities.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
          <button className="kp-btn kp-btn--ghost" onClick={bulkArchive}>
            Archive
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
              <Th label="Title" k="title" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
              <Th label="Project" k="project" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
              <Th label="Milestone" k="milestone" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
              <Th label="Status" k="status" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
              <Th label="Priority" k="priority" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
              <Th label="Due" k="due" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
              <th>
                <span className="kp-table__th-inner">
                  <Icon name={COLUMN_ICONS.tags} size={13} />
                  Tags
                </span>
              </th>
              <th>
                <span className="kp-table__th-inner">
                  <Icon name={COLUMN_ICONS.actions} size={13} />
                  Actions
                </span>
              </th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((task) => (
              <Row
                key={task.id}
                task={task}
                projects={projects}
                checked={selected.has(task.id)}
                onToggle={() => toggleRow(task.id)}
              />
            ))}
            <NewTaskRow projects={projects} />
            {sorted.length === 0 && (
              <tr>
                <td colSpan={9} className="kp-empty">
                  No tasks match the current filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
};

interface ThProps {
  label: string;
  k: SortKey;
  sortKey: SortKey;
  sortDir: "asc" | "desc";
  onClick: (k: SortKey) => void;
}

const Th: React.FC<ThProps> = ({ label, k, sortKey, sortDir, onClick }) => (
  <th className="kp-table__th" onClick={() => onClick(k)}>
    <span className="kp-table__th-inner">
      <Icon name={COLUMN_ICONS[k]} size={13} />
      {label}
      {sortKey === k && <span className="kp-table__sort">{sortDir === "asc" ? "▲" : "▼"}</span>}
    </span>
  </th>
);

interface RowProps {
  task: Task;
  projects: string[];
  checked: boolean;
  onToggle: () => void;
}

const Row: React.FC<RowProps> = ({ task, projects, checked, onToggle }) => {
  const { settings, taskService, store } = usePlugin();
  const milestonesMap = store((s) => s.milestones);
  const milestones = React.useMemo(
    () =>
      Object.values(milestonesMap)
        .filter((m) => !m.project || m.project === task.project)
        .map((m) => m.name),
    [milestonesMap, task.project]
  );

  return (
    <tr>
      <td className="kp-table__check">
        <input type="checkbox" checked={checked} onChange={onToggle} />
      </td>
      <td>
        <a className="kp-table__title" onClick={() => void taskService.openInNewLeaf(task)}>
          {task.title}
        </a>
      </td>
      <td>
        <select
          value={task.project ?? ""}
          onChange={(e) => void taskService.setProject(task, e.target.value)}
        >
          {projects.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
          {task.project && !projects.includes(task.project) && (
            <option value={task.project}>{task.project}</option>
          )}
        </select>
      </td>
      <td>
        <select
          value={task.milestone ?? ""}
          onChange={(e) => void taskService.setMilestone(task, e.target.value || undefined)}
        >
          <option value="">—</option>
          {milestones.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
          {task.milestone && !milestones.includes(task.milestone) && (
            <option value={task.milestone}>{task.milestone}</option>
          )}
        </select>
      </td>
      <td>
        <select
          value={task.status}
          onChange={(e) => void taskService.setStatus(task, e.target.value)}
        >
          {settings.statuses.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
      </td>
      <td>
        <select
          value={task.priority ?? ""}
          onChange={(e) => void taskService.setPriority(task, e.target.value)}
        >
          <option value="">—</option>
          {settings.priorities.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
      </td>
      <td>
        <input
          type="date"
          value={task.due ?? ""}
          onChange={(e) => void taskService.setDue(task, e.target.value || undefined)}
        />
      </td>
      <td>
        {task.tags.length > 0 ? (
          <div className="kp-table__tags">
            {task.tags.map((t) => (
              <span key={t} className="kp-chip kp-chip--tag">
                #{t}
              </span>
            ))}
          </div>
        ) : (
          <span className="kp-table__empty-cell">—</span>
        )}
      </td>
      <td>
        {task.archived ? (
          <button className="kp-btn kp-btn--ghost" onClick={() => void taskService.unarchive(task)}>
            Unarchive
          </button>
        ) : (
          <button className="kp-btn kp-btn--ghost" onClick={() => void taskService.archive(task)}>
            Archive
          </button>
        )}
      </td>
    </tr>
  );
};

const NewTaskRow: React.FC<{ projects: string[] }> = ({ projects }) => {
  const { taskService, settings, openQuickCreate } = usePlugin();
  const [editing, setEditing] = React.useState(false);
  const [title, setTitle] = React.useState("");
  const [project, setProject] = React.useState(projects[0] ?? "Inbox");
  const [status, setStatus] = React.useState(settings.statuses[1]?.id ?? "todo");
  const [priority, setPriority] = React.useState<string>("");
  const [due, setDue] = React.useState("");
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  React.useEffect(() => {
    if (!editing && projects.length > 0 && !projects.includes(project)) {
      setProject(projects[0]);
    }
  }, [projects, editing, project]);

  const reset = () => {
    setTitle("");
    setEditing(false);
  };

  const submit = async () => {
    const t = title.trim();
    if (!t) {
      reset();
      return;
    }
    await taskService.createTask({
      title: t,
      project: project || "Inbox",
      status,
      priority: priority || undefined,
      due: due || undefined,
    });
    reset();
  };

  if (!editing) {
    return (
      <tr className="kp-newrow" onClick={() => setEditing(true)}>
        <td className="kp-table__check" />
        <td colSpan={8}>
          <span className="kp-newrow__label">+ New task</span>
          <button
            className="kp-btn kp-btn--ghost kp-newrow__expand"
            onClick={(e) => {
              e.stopPropagation();
              openQuickCreate();
            }}
          >
            Open full form…
          </button>
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
          placeholder="Task title…"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void submit();
            if (e.key === "Escape") reset();
          }}
          onBlur={() => {
            if (!title.trim()) reset();
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
      <td>—</td>
      <td>
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          {settings.statuses.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
      </td>
      <td>
        <select value={priority} onChange={(e) => setPriority(e.target.value)}>
          <option value="">—</option>
          {settings.priorities.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
      </td>
      <td>
        <input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
      </td>
      <td />
      <td>
        <button className="kp-btn kp-btn--primary" onMouseDown={(e) => e.preventDefault()} onClick={() => void submit()}>
          Add
        </button>
      </td>
    </tr>
  );
};
