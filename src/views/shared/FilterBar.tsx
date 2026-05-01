import * as React from "react";
import { usePlugin } from "../context";
import type { ViewKind } from "../../schema/types";
import { Icon, IconName } from "./Icon";

interface Props {
  activeView: ViewKind;
  toolbar?: React.ReactNode;
}

const VIEWS: { id: ViewKind; label: string; icon: IconName }[] = [
  { id: "kanban", label: "Kanban", icon: "kanban" },
  { id: "timeline", label: "Timeline", icon: "timeline" },
  { id: "calendar", label: "Calendar", icon: "calendar" },
  { id: "table", label: "Table", icon: "table" },
];

const CHIP_ICONS: Record<string, IconName> = {
  Project: "folder",
  Milestone: "flag",
  Status: "status",
  Priority: "priority",
  Tag: "hash",
};

export const FilterBar: React.FC<Props> = ({ activeView, toolbar }) => {
  const { store, settings, switchView } = usePlugin();
  const filter = store((s) => s.filter);
  const projects = store((s) => s.projects);
  const milestones = store((s) => s.milestones);
  const tasks = store((s) => s.tasks);
  const setFilter = store((s) => s.setFilter);

  const projectNames = React.useMemo(
    () => Object.values(projects).map((p) => p.name).sort(),
    [projects]
  );
  const projectColors = React.useMemo(() => {
    const map: Record<string, string> = {};
    for (const p of Object.values(projects)) map[p.name] = p.color;
    return map;
  }, [projects]);
  const statusColors = React.useMemo(() => {
    const map: Record<string, string> = {};
    for (const s of settings.statuses) map[s.id] = s.color;
    return map;
  }, [settings.statuses]);
  const priorityColors = React.useMemo(() => {
    const map: Record<string, string> = {};
    for (const p of settings.priorities) map[p.id] = p.color;
    return map;
  }, [settings.priorities]);
  const milestoneNames = React.useMemo(
    () => Object.values(milestones).map((m) => m.name).sort(),
    [milestones]
  );
  const allTags = React.useMemo(() => {
    const set = new Set<string>();
    for (const t of Object.values(tasks)) for (const tag of t.tags) set.add(tag);
    return Array.from(set).sort();
  }, [tasks]);

  const toggle = <T,>(arr: T[], v: T): T[] =>
    arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v];

  return (
    <div className="kp-filterbar">
      <div className="kp-filterbar__row">
        <div className="kp-viewswitcher">
          {VIEWS.map((v) => (
            <button
              key={v.id}
              className={`kp-viewswitcher__btn ${activeView === v.id ? "is-active" : ""}`}
              onClick={() => switchView(v.id)}
              title={v.label}
            >
              <Icon name={v.icon} size={15} />
              <span>{v.label}</span>
            </button>
          ))}
        </div>

        <div className="kp-search kp-search--anchored">
          <Icon name="search" size={14} className="kp-search__icon" />
          <input
            type="search"
            className="kp-search__input"
            placeholder="Search tasks…"
            value={filter.search}
            onChange={(e) => setFilter({ search: e.target.value })}
          />
        </div>
      </div>

      <div className="kp-filterbar__row kp-filterbar__row--chips">
        {toolbar && <div className="kp-filterbar__toolbar">{toolbar}</div>}
        <div className="kp-filterbar__chips">
          <ChipGroup
            label="Project"
            options={projectNames}
            selected={filter.projects}
            onToggle={(v) => setFilter({ projects: toggle(filter.projects, v) })}
            colors={projectColors}
          />
          <ChipGroup
            label="Milestone"
            options={milestoneNames}
            selected={filter.milestones}
            onToggle={(v) => setFilter({ milestones: toggle(filter.milestones, v) })}
          />
          <ChipGroup
            label="Status"
            options={settings.statuses.map((s) => s.id)}
            labels={Object.fromEntries(settings.statuses.map((s) => [s.id, s.label]))}
            selected={filter.statuses}
            onToggle={(v) => setFilter({ statuses: toggle(filter.statuses, v) })}
            colors={statusColors}
          />
          <ChipGroup
            label="Priority"
            options={settings.priorities.map((p) => p.id)}
            labels={Object.fromEntries(settings.priorities.map((p) => [p.id, p.label]))}
            selected={filter.priorities}
            onToggle={(v) => setFilter({ priorities: toggle(filter.priorities, v) })}
            colors={priorityColors}
            colorMode="text"
          />
          {allTags.length > 0 && (
            <ChipGroup
              label="Tag"
              options={allTags}
              selected={filter.tags}
              onToggle={(v) => setFilter({ tags: toggle(filter.tags, v) })}
              prefix="#"
            />
          )}
          <button
            className={`kp-chipgroup__trigger ${filter.includeArchived ? "is-selected" : ""}`}
            onClick={() => setFilter({ includeArchived: !filter.includeArchived })}
            title="Toggle archived tasks"
          >
            <Icon name="archive" size={13} />
            <span>Archived</span>
          </button>
        </div>
      </div>
    </div>
  );
};

interface ChipGroupProps {
  label: string;
  options: string[];
  selected: string[];
  onToggle: (value: string) => void;
  labels?: Record<string, string>;
  prefix?: string;
  colors?: Record<string, string>;
  colorMode?: "dot" | "text";
}

const ChipGroup: React.FC<ChipGroupProps> = ({ label, options, selected, onToggle, labels, prefix, colors, colorMode = "dot" }) => {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  if (options.length === 0) return null;

  const iconName = CHIP_ICONS[label];
  return (
    <div className="kp-chipgroup" ref={ref}>
      <button
        className={`kp-chipgroup__trigger ${selected.length ? "is-selected" : ""}`}
        onClick={() => setOpen((v) => !v)}
      >
        {iconName && <Icon name={iconName} size={13} />}
        <span>{label}</span>
        {selected.length > 0 && <span className="kp-chipgroup__count">{selected.length}</span>}
      </button>
      {open && (
        <div className="kp-chipgroup__menu">
          {options.map((opt) => {
            const c = colors?.[opt];
            const showDot = c && colorMode === "dot";
            const labelStyle =
              c && colorMode === "text"
                ? { color: c, fontWeight: 700, letterSpacing: "-1px" as const }
                : undefined;
            return (
              <label key={opt} className="kp-chipgroup__item">
                <input
                  type="checkbox"
                  checked={selected.includes(opt)}
                  onChange={() => onToggle(opt)}
                />
                {showDot && (
                  <span
                    className="kp-table__color-dot"
                    style={{ background: c }}
                    aria-hidden
                  />
                )}
                <span style={labelStyle}>
                  {prefix ?? ""}
                  {labels?.[opt] ?? opt}
                </span>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
};
