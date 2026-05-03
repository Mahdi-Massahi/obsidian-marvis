import * as React from "react";
import { Notice } from "obsidian";
import { usePlugin } from "../context";
import type { Event } from "../../schema/types";
import { listProjectFolders } from "../../services/taskService";
import { Icon, IconName } from "../shared/Icon";
import { ConfirmModal } from "../shared/ConfirmModal";
import { describeRecurrence } from "../../utils/recurrence";

export const EventTable: React.FC = () => {
  const { store, app, settings, eventService } = usePlugin();
  const eventsMap = store((s) => s.events);
  const filter = store((s) => s.filter);

  const events = React.useMemo(() => {
    return Object.values(eventsMap)
      .filter((ev) => {
        if (filter.projects.length && (!ev.project || !filter.projects.includes(ev.project)))
          return false;
        if (filter.tags.length) {
          const tagSet = new Set(ev.tags);
          if (!filter.tags.every((t) => tagSet.has(t))) return false;
        }
        if (filter.search.trim()) {
          const q = filter.search.trim().toLowerCase();
          const haystack = `${ev.title} ${ev.tags.join(" ")} ${ev.project ?? ""} ${
            ev.body ?? ""
          }`.toLowerCase();
          if (!haystack.includes(q)) return false;
        }
        return true;
      })
      .sort((a, b) => {
        const da = `${a.date}T${a.time ?? "00:00"}`;
        const db = `${b.date}T${b.time ?? "00:00"}`;
        return db.localeCompare(da);
      });
  }, [eventsMap, filter]);

  const projects = listProjectFolders(app, settings.rootFolder);

  const [selected, setSelected] = React.useState<Set<string>>(new Set());

  const toggleRow = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };

  const allChecked = events.length > 0 && events.every((e) => selected.has(e.id));
  const toggleAll = () => {
    if (allChecked) setSelected(new Set());
    else setSelected(new Set(events.map((e) => e.id)));
  };

  const targets = () => events.filter((e) => selected.has(e.id));

  const bulkSetProject = async (project: string) => {
    for (const e of targets()) await eventService.setProject(e, project);
    setSelected(new Set());
  };

  const bulkArchive = async () => {
    for (const e of targets()) await eventService.archive(e);
    setSelected(new Set());
  };

  const bulkDelete = () => {
    const items = targets();
    if (items.length === 0) return;
    new ConfirmModal(
      app,
      `Delete ${items.length} event${items.length === 1 ? "" : "s"}`,
      `Permanently delete ${items.length} selected event${
        items.length === 1 ? "" : "s"
      }? Files are moved to trash.`,
      async () => {
        for (const e of items) await eventService.deleteEvent(e);
        new Notice(`Deleted ${items.length} event${items.length === 1 ? "" : "s"}`);
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
    for (const e of targets()) await eventService.addTags(e, tags);
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
              <EventTh icon="calendar" label="Date" />
              <EventTh icon="clock" label="Time" />
              <EventTh icon="text" label="Title" />
              <EventTh icon="folder" label="Project" />
              <EventTh icon="filter" label="Recurrence" />
              <EventTh icon="tag" label="Tags" />
              <EventTh icon="more" label="Actions" />
            </tr>
          </thead>
          <tbody>
            {events.map((ev) => (
              <EventRow
                key={ev.id}
                event={ev}
                projects={projects}
                checked={selected.has(ev.id)}
                onToggle={() => toggleRow(ev.id)}
              />
            ))}
            {events.length === 0 && (
              <tr>
                <td colSpan={8} className="kp-empty">
                  No events yet — use the Create menu to add one.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
};

const EventTh: React.FC<{ icon: IconName; label: string }> = ({ icon, label }) => (
  <th>
    <span className="kp-table__th-inner">
      <Icon name={icon} size={13} />
      {label}
    </span>
  </th>
);

interface RowProps {
  event: Event;
  projects: string[];
  checked: boolean;
  onToggle: () => void;
}

const EventRow: React.FC<RowProps> = ({ event, projects, checked, onToggle }) => {
  const { eventService, store } = usePlugin();
  const projectsMap = store((s) => s.projects);
  const projectObj = event.project
    ? Object.values(projectsMap).find((p) => p.name === event.project)
    : undefined;
  const recurrenceLabel = event.recurrence ? describeRecurrence(event.recurrence) : "—";

  return (
    <tr>
      <td className="kp-table__check">
        <input type="checkbox" checked={checked} onChange={onToggle} />
      </td>
      <td>
        <input
          type="date"
          value={event.date}
          onChange={(e) => {
            if (!e.target.value) return;
            void eventService.setDate(event, e.target.value);
          }}
        />
      </td>
      <td>
        {event.time ? (
          <span className="kp-table__created">
            {event.endTime ? `${event.time}–${event.endTime}` : event.time}
          </span>
        ) : (
          <span className="kp-table__empty">All-day</span>
        )}
      </td>
      <td>
        <a
          className="kp-table__title"
          title={event.title}
          onClick={(e) =>
            void eventService.openInNewLeaf(event, e.metaKey || e.ctrlKey ? "tab" : undefined)
          }
        >
          <Icon name="calendar" size={13} />
          {event.code && <span className="kp-code">{event.code}</span>}
          <span className="kp-table__title-text">{event.title}</span>
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
            value={event.project ?? ""}
            onChange={(e) => void eventService.setProject(event, e.target.value)}
          >
            {projects.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
            {event.project && !projects.includes(event.project) && (
              <option value={event.project}>{event.project}</option>
            )}
          </select>
        </div>
      </td>
      <td className="kp-table__created">{recurrenceLabel}</td>
      <td>
        <div className="kp-table__tags">
          {event.tags.length === 0 ? (
            <span className="kp-table__empty">—</span>
          ) : (
            event.tags.map((t) => (
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
            void eventService.openInNewLeaf(event, e.metaKey || e.ctrlKey ? "tab" : undefined)
          }
        >
          Open
        </button>
      </td>
    </tr>
  );
};
