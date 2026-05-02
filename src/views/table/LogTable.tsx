import * as React from "react";
import { Notice } from "obsidian";
import { usePlugin } from "../context";
import type { Log } from "../../schema/types";
import { listProjectFolders } from "../../services/taskService";
import { Icon, IconName } from "../shared/Icon";
import { ConfirmModal } from "../shared/ConfirmModal";

export const LogTable: React.FC = () => {
  const { store, app, settings, logService } = usePlugin();
  const logsMap = store((s) => s.logs);
  const filter = store((s) => s.filter);

  const logs = React.useMemo(() => {
    return Object.values(logsMap)
      .filter((l) => {
        if (filter.projects.length && (!l.project || !filter.projects.includes(l.project)))
          return false;
        if (filter.tags.length) {
          const taskTags = new Set(l.tags);
          if (!filter.tags.every((t) => taskTags.has(t))) return false;
        }
        if (filter.search.trim()) {
          const q = filter.search.trim().toLowerCase();
          const haystack = `${l.tags.join(" ")} ${l.project ?? ""} ${l.body ?? ""} ${
            l.excerpt ?? ""
          }`.toLowerCase();
          if (!haystack.includes(q)) return false;
        }
        return true;
      })
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  }, [logsMap, filter]);

  const projects = listProjectFolders(app, settings.rootFolder);

  const [selected, setSelected] = React.useState<Set<string>>(new Set());

  const toggleRow = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };

  const allChecked = logs.length > 0 && logs.every((l) => selected.has(l.id));
  const toggleAll = () => {
    if (allChecked) setSelected(new Set());
    else setSelected(new Set(logs.map((l) => l.id)));
  };

  const targets = () => logs.filter((l) => selected.has(l.id));

  const bulkSetProject = async (project: string) => {
    for (const l of targets()) await logService.setProject(l, project);
    setSelected(new Set());
  };

  const bulkArchive = async () => {
    for (const l of targets()) await logService.archive(l);
    setSelected(new Set());
  };

  const bulkDelete = () => {
    const items = targets();
    if (items.length === 0) return;
    new ConfirmModal(
      app,
      `Delete ${items.length} log${items.length === 1 ? "" : "s"}`,
      `Permanently delete ${items.length} selected log${items.length === 1 ? "" : "s"}? Files are moved to trash.`,
      async () => {
        for (const l of items) await logService.deleteLog(l);
        new Notice(`Deleted ${items.length} log${items.length === 1 ? "" : "s"}`);
        setSelected(new Set());
      }
    ).open();
  };

  const [tagInput, setTagInput] = React.useState("");
  const bulkAddTag = async () => {
    const tags = tagInput
      .split(/[,\s]+/)
      .map((t) => t.replace(/^#/, "").trim())
      .filter((t) => t.length > 0);
    if (tags.length === 0) return;
    for (const l of targets()) await logService.addTags(l, tags);
    setTagInput("");
    setSelected(new Set());
  };

  return (
    <>
      {selected.size > 0 && (
        <div className="kp-bulkbar">
          <span>{selected.size} selected</span>
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
          <input
            type="text"
            placeholder="Add tag(s)…"
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void bulkAddTag();
            }}
            className="kp-bulkbar__input"
          />
          <button className="kp-btn kp-btn--ghost" onClick={() => void bulkAddTag()}>
            Add tag
          </button>
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
              <LogTh icon="clock" label="Timestamp" />
              <LogTh icon="folder" label="Project" />
              <LogTh icon="text" label="Excerpt" />
              <LogTh icon="tag" label="Tags" />
              <LogTh icon="calendar" label="Created" />
              <LogTh icon="more" label="Actions" />
            </tr>
          </thead>
          <tbody>
            {logs.map((l) => (
              <LogRow
                key={l.id}
                log={l}
                projects={projects}
                checked={selected.has(l.id)}
                onToggle={() => toggleRow(l.id)}
              />
            ))}
            <NewLogRow projects={projects} />
            {logs.length === 0 && (
              <tr>
                <td colSpan={7} className="kp-empty">
                  No logs yet — click the row below to add one.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
};

const LogTh: React.FC<{ icon: IconName; label: string }> = ({ icon, label }) => (
  <th>
    <span className="kp-table__th-inner">
      <Icon name={icon} size={13} />
      {label}
    </span>
  </th>
);

interface RowProps {
  log: Log;
  projects: string[];
  checked: boolean;
  onToggle: () => void;
}

const LogRow: React.FC<RowProps> = ({ log, projects, checked, onToggle }) => {
  const { logService, store } = usePlugin();
  const projectsMap = store((s) => s.projects);
  const projectObj = log.project
    ? Object.values(projectsMap).find((p) => p.name === log.project)
    : undefined;

  const tsForInput = log.timestamp.length >= 16 ? log.timestamp.slice(0, 16) : log.timestamp;

  return (
    <tr>
      <td className="kp-table__check">
        <input type="checkbox" checked={checked} onChange={onToggle} />
      </td>
      <td>
        <input
          type="datetime-local"
          value={tsForInput}
          onChange={(e) => {
            const v = e.target.value;
            if (!v) return;
            const d = new Date(v);
            if (Number.isNaN(d.getTime())) return;
            void logService.setTimestamp(log, d);
          }}
        />
      </td>
      <td>
        <div className="kp-table__project-cell">
          <span
            className="kp-table__color-dot"
            style={{ background: projectObj?.color ?? "transparent" }}
            aria-hidden
          />
          <select
            value={log.project ?? ""}
            onChange={(e) => void logService.setProject(log, e.target.value)}
          >
            {projects.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
            {log.project && !projects.includes(log.project) && (
              <option value={log.project}>{log.project}</option>
            )}
          </select>
        </div>
      </td>
      <td>
        <a
          className="kp-table__title"
          onClick={(e) =>
            void logService.openInNewLeaf(log, e.metaKey || e.ctrlKey ? "tab" : undefined)
          }
        >
          <Icon name="notebook" size={13} />
          {log.code && <span className="kp-code">{log.code}</span>}
          {log.excerpt ?? log.name}
        </a>
      </td>
      <td>
        <div className="kp-table__tags">
          {log.tags.length === 0 ? (
            <span className="kp-table__empty">—</span>
          ) : (
            log.tags.map((t) => (
              <span key={t} className="kp-tag-chip">
                #{t}
              </span>
            ))
          )}
        </div>
      </td>
      <td className="kp-table__created">{log.created ?? "—"}</td>
      <td>
        <button
          className="kp-btn kp-btn--ghost"
          onClick={(e) =>
            void logService.openInNewLeaf(log, e.metaKey || e.ctrlKey ? "tab" : undefined)
          }
        >
          Open
        </button>
      </td>
    </tr>
  );
};

const NewLogRow: React.FC<{ projects: string[] }> = ({ projects }) => {
  const { logService } = usePlugin();
  const [editing, setEditing] = React.useState(false);
  const [project, setProject] = React.useState(projects[0] ?? "");
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [body, setBody] = React.useState("");

  React.useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  React.useEffect(() => {
    if (!project && projects.length > 0) setProject(projects[0]);
  }, [projects, project]);

  const reset = () => {
    setBody("");
    setEditing(false);
  };

  const submit = async () => {
    if (!project) {
      reset();
      return;
    }
    try {
      await logService.createLog(project, { body: body.trim() || undefined });
      new Notice(`Log added to ${project}`);
    } catch (e) {
      console.error(e);
      new Notice("Failed to create log — see console");
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
        <td colSpan={6}>
          <span className="kp-newrow__label">+ New log</span>
        </td>
      </tr>
    );
  }

  return (
    <tr className="kp-newrow kp-newrow--editing">
      <td className="kp-table__check" />
      <td>now</td>
      <td>
        <select value={project} onChange={(e) => setProject(e.target.value)}>
          {projects.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </td>
      <td>
        <input
          ref={inputRef}
          type="text"
          placeholder="Log body…"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void submit();
            if (e.key === "Escape") reset();
          }}
        />
      </td>
      <td>—</td>
      <td className="kp-table__created">—</td>
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
