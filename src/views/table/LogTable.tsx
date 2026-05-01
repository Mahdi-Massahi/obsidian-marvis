import * as React from "react";
import { Notice } from "obsidian";
import { usePlugin } from "../context";
import type { Log } from "../../schema/types";
import { listProjectFolders } from "../../services/taskService";
import { Icon, IconName } from "../shared/Icon";

export const LogTable: React.FC = () => {
  const { store, app, settings } = usePlugin();
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

  return (
    <div className="kp-table__wrap">
      <table className="kp-table">
        <thead>
          <tr>
            <LogTh icon="clock" label="Timestamp" />
            <LogTh icon="folder" label="Project" />
            <LogTh icon="text" label="Excerpt" />
            <LogTh icon="tag" label="Tags" />
            <LogTh icon="more" label="Actions" />
          </tr>
        </thead>
        <tbody>
          {logs.map((l) => (
            <LogRow key={l.id} log={l} projects={projects} />
          ))}
          <NewLogRow projects={projects} />
          {logs.length === 0 && (
            <tr>
              <td colSpan={5} className="kp-empty">
                No logs yet — click the row below to add one.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
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
}

const LogRow: React.FC<RowProps> = ({ log, projects }) => {
  const { logService, store } = usePlugin();
  const projectsMap = store((s) => s.projects);
  const projectObj = log.project
    ? Object.values(projectsMap).find((p) => p.name === log.project)
    : undefined;

  const tsForInput = log.timestamp.length >= 16 ? log.timestamp.slice(0, 16) : log.timestamp;

  return (
    <tr>
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
        <td colSpan={5}>
          <span className="kp-newrow__label">+ New log</span>
        </td>
      </tr>
    );
  }

  return (
    <tr className="kp-newrow kp-newrow--editing">
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
