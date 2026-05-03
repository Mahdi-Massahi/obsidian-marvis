import * as React from "react";
import * as ReactDOM from "react-dom";
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
  const { store, settings, switchView, openCreateMenu } = usePlugin();
  const filter = store((s) => s.filter);
  const projects = store((s) => s.projects);
  const milestones = store((s) => s.milestones);
  const tasks = store((s) => s.tasks);
  const setFilter = store((s) => s.setFilter);
  const [filterModalOpen, setFilterModalOpen] = React.useState(false);
  const [searchModalOpen, setSearchModalOpen] = React.useState(false);
  const searchModalInputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (searchModalOpen) {
      setTimeout(() => searchModalInputRef.current?.focus(), 50);
    }
  }, [searchModalOpen]);

  const activeFilterCount =
    filter.projects.length +
    filter.milestones.length +
    filter.statuses.length +
    filter.priorities.length +
    filter.tags.length +
    (filter.includeLogs ? 1 : 0) +
    (filter.includeEvents ? 1 : 0) +
    (filter.includeArchived ? 1 : 0);

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
        <button
          className="kp-iconbtn kp-iconbtn--round kp-iconbtn--accent"
          title="Create new"
          aria-label="Create new"
          onClick={() => openCreateMenu()}
        >
          <Icon name="plus" size={15} />
        </button>

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
        <button
          className={`kp-iconbtn kp-iconbtn--round kp-filterbar__filtertrigger ${activeFilterCount ? "is-selected" : ""}`}
          title="Filters"
          aria-label="Filters"
          onClick={() => setFilterModalOpen(true)}
        >
          <Icon name="filter" size={15} />
          {activeFilterCount > 0 && (
            <span className="kp-filterbar__filtertrigger-count">{activeFilterCount}</span>
          )}
        </button>
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
          {(activeView === "calendar" || activeView === "timeline") && (
            <button
              className={`kp-chipgroup__trigger ${filter.includeLogs ? "is-selected" : ""}`}
              onClick={() => setFilter({ includeLogs: !filter.includeLogs })}
              title="Toggle log visibility"
            >
              <Icon name="notebook" size={13} />
              <span>Logs</span>
            </button>
          )}
          {(activeView === "calendar" || activeView === "timeline") && (
            <button
              className={`kp-chipgroup__trigger ${filter.includeEvents ? "is-selected" : ""}`}
              onClick={() => setFilter({ includeEvents: !filter.includeEvents })}
              title="Toggle event visibility"
            >
              <Icon name="calendar" size={13} />
              <span>Events</span>
            </button>
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

      {ReactDOM.createPortal(
        <div className="kp-portal">
          <nav className="kp-mobnav kp-mobnav--views" aria-label="Marvis views">
            {VIEWS.map((v) => (
              <button
                key={v.id}
                className={`kp-mobnav__btn ${activeView === v.id ? "is-active" : ""}`}
                onClick={() => switchView(v.id)}
                title={v.label}
                aria-label={v.label}
              >
                <Icon name={v.icon} size={20} />
              </button>
            ))}
          </nav>
          <div className="kp-mobnav__right">
            <nav className="kp-mobnav kp-mobnav--search" aria-label="Search">
              <button
                className={`kp-mobnav__btn ${filter.search ? "is-active" : ""}`}
                title="Search"
                aria-label="Search"
                onClick={() => setSearchModalOpen(true)}
              >
                <Icon name="search" size={20} />
              </button>
            </nav>
            <nav className="kp-mobnav kp-mobnav--actions" aria-label="Marvis actions">
              <button
                className="kp-mobnav__btn kp-mobnav__btn--accent"
                title="Create new"
                aria-label="Create new"
                onClick={() => openCreateMenu()}
              >
                <Icon name="plus" size={20} />
              </button>
            </nav>
          </div>
        </div>,
        document.body
      )}

      {searchModalOpen && ReactDOM.createPortal(
        <div className="kp-portal">
          <div
            className="kp-searchmodal__overlay"
            onClick={() => setSearchModalOpen(false)}
          />
          <div className="kp-searchmodal" role="dialog" aria-label="Search">
            <input
              ref={searchModalInputRef}
              type="search"
              className="kp-searchmodal__input"
              placeholder="Search tasks…"
              value={filter.search}
              onChange={(e) => setFilter({ search: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === "Escape" || e.key === "Enter") {
                  setSearchModalOpen(false);
                }
              }}
            />
            {filter.search && (
              <button
                className="kp-iconbtn"
                aria-label="Clear"
                onClick={() => setFilter({ search: "" })}
              >
                <Icon name="x" size={14} />
              </button>
            )}
            <button
              className="kp-btn kp-btn--ghost"
              onClick={() => setSearchModalOpen(false)}
            >
              Done
            </button>
          </div>
        </div>,
        document.body
      )}

      {filterModalOpen && ReactDOM.createPortal(
        <div className="kp-portal">
          <div
            className="kp-filtermodal__overlay"
            onClick={() => setFilterModalOpen(false)}
          />
          <div className="kp-filtermodal" role="dialog" aria-label="Filters">
            <div className="kp-filtermodal__header">
              <span className="kp-filtermodal__title">Filters</span>
              <button
                className="kp-iconbtn"
                aria-label="Close"
                onClick={() => setFilterModalOpen(false)}
              >
                <Icon name="x" size={16} />
              </button>
            </div>
            <div className="kp-filtermodal__body">
              <FilterSection
                label="Project"
                options={projectNames}
                selected={filter.projects}
                onToggle={(v) => setFilter({ projects: toggle(filter.projects, v) })}
                colors={projectColors}
              />
              <FilterSection
                label="Milestone"
                options={milestoneNames}
                selected={filter.milestones}
                onToggle={(v) => setFilter({ milestones: toggle(filter.milestones, v) })}
              />
              <FilterSection
                label="Status"
                options={settings.statuses.map((s) => s.id)}
                labels={Object.fromEntries(settings.statuses.map((s) => [s.id, s.label]))}
                selected={filter.statuses}
                onToggle={(v) => setFilter({ statuses: toggle(filter.statuses, v) })}
                colors={statusColors}
              />
              <FilterSection
                label="Priority"
                options={settings.priorities.map((p) => p.id)}
                labels={Object.fromEntries(settings.priorities.map((p) => [p.id, p.label]))}
                selected={filter.priorities}
                onToggle={(v) => setFilter({ priorities: toggle(filter.priorities, v) })}
                colors={priorityColors}
                colorMode="text"
              />
              {allTags.length > 0 && (
                <FilterSection
                  label="Tag"
                  options={allTags}
                  selected={filter.tags}
                  onToggle={(v) => setFilter({ tags: toggle(filter.tags, v) })}
                  prefix="#"
                />
              )}
              <div className="kp-filtermodal__toggles">
                {(activeView === "calendar" || activeView === "timeline") && (
                  <label className="kp-filtermodal__toggle">
                    <input
                      type="checkbox"
                      checked={filter.includeLogs}
                      onChange={() => setFilter({ includeLogs: !filter.includeLogs })}
                    />
                    <Icon name="notebook" size={13} />
                    <span>Logs</span>
                  </label>
                )}
                {(activeView === "calendar" || activeView === "timeline") && (
                  <label className="kp-filtermodal__toggle">
                    <input
                      type="checkbox"
                      checked={filter.includeEvents}
                      onChange={() => setFilter({ includeEvents: !filter.includeEvents })}
                    />
                    <Icon name="calendar" size={13} />
                    <span>Events</span>
                  </label>
                )}
                <label className="kp-filtermodal__toggle">
                  <input
                    type="checkbox"
                    checked={filter.includeArchived}
                    onChange={() => setFilter({ includeArchived: !filter.includeArchived })}
                  />
                  <Icon name="archive" size={13} />
                  <span>Archived</span>
                </label>
              </div>
            </div>
            {activeFilterCount > 0 && (
              <div className="kp-filtermodal__footer">
                <button
                  className="kp-btn kp-btn--ghost"
                  onClick={() =>
                    setFilter({
                      projects: [],
                      milestones: [],
                      statuses: [],
                      priorities: [],
                      tags: [],
                      includeLogs: false,
                      includeEvents: false,
                      includeArchived: false,
                    })
                  }
                >
                  Clear all
                </button>
              </div>
            )}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};

interface FilterSectionProps {
  label: string;
  options: string[];
  selected: string[];
  onToggle: (value: string) => void;
  labels?: Record<string, string>;
  prefix?: string;
  colors?: Record<string, string>;
  colorMode?: "dot" | "text";
}

const FilterSection: React.FC<FilterSectionProps> = ({
  label,
  options,
  selected,
  onToggle,
  labels,
  prefix,
  colors,
  colorMode = "dot",
}) => {
  if (options.length === 0) return null;
  const iconName = CHIP_ICONS[label];
  return (
    <div className="kp-filtermodal__section">
      <div className="kp-filtermodal__sectionhead">
        {iconName && <Icon name={iconName} size={13} />}
        <span>{label}</span>
        {selected.length > 0 && (
          <span className="kp-chipgroup__count">{selected.length}</span>
        )}
      </div>
      <div className="kp-filtermodal__options">
        {options.map((opt) => {
          const c = colors?.[opt];
          const showDot = c && colorMode === "dot";
          const labelStyle =
            c && colorMode === "text"
              ? { color: c, fontWeight: 700, letterSpacing: "-1px" as const }
              : undefined;
          const isSelected = selected.includes(opt);
          return (
            <label
              key={opt}
              className={`kp-filtermodal__option ${isSelected ? "is-selected" : ""}`}
            >
              <input
                type="checkbox"
                checked={isSelected}
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
  const [pos, setPos] = React.useState<{ top: number; left: number } | null>(null);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const menuRef = React.useRef<HTMLDivElement>(null);

  const updatePos = React.useCallback(() => {
    const r = triggerRef.current?.getBoundingClientRect();
    if (!r) return;
    setPos({ top: r.bottom + 6, left: r.left });
  }, []);

  React.useEffect(() => {
    if (!open) return;
    updatePos();
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (
        !triggerRef.current?.contains(t) &&
        !menuRef.current?.contains(t)
      )
        setOpen(false);
    };
    const onScroll = () => updatePos();
    document.addEventListener("mousedown", onDoc);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [open, updatePos]);

  if (options.length === 0) return null;

  const iconName = CHIP_ICONS[label];
  return (
    <div className="kp-chipgroup">
      <button
        ref={triggerRef}
        className={`kp-chipgroup__trigger ${selected.length ? "is-selected" : ""}`}
        onClick={() => setOpen((v) => !v)}
      >
        {iconName && <Icon name={iconName} size={13} />}
        <span>{label}</span>
        {selected.length > 0 && <span className="kp-chipgroup__count">{selected.length}</span>}
      </button>
      {open && pos && ReactDOM.createPortal(
        <div className="kp-portal">
        <div
          ref={menuRef}
          className="kp-chipgroup__menu kp-chipgroup__menu--floating"
          style={{ top: pos.top, left: pos.left }}
        >
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
        </div>,
        document.body
      )}
    </div>
  );
};
