import type { FilterState, Milestone, ViewKind } from "../../schema/types";
import type { ViewStateSettings } from "../../settings";

export interface ViewContext {
  view: ViewKind;
  groupBy?: string;
  tab?: string;
  mode?: string;
  zoom?: string;
  filters?: ViewFilters;
}

export interface ViewFilters {
  projects?: string[];
  milestones?: Array<{ name: string; project?: string }>;
  statuses?: string[];
  priorities?: string[];
  tags?: string[];
  frequencies?: string[];
  habitStates?: string[];
  search?: string;
  includeArchived?: boolean;
}

function viewSettings(kind: ViewKind, viewState: ViewStateSettings): Partial<ViewContext> {
  switch (kind) {
    case "kanban":
      return { groupBy: viewState.kanbanGroupBy };
    case "timeline":
      return { groupBy: viewState.timelineGroupBy, zoom: viewState.timelineZoom };
    case "calendar":
      return { mode: viewState.calendarMode };
    case "table":
      return { tab: viewState.tableTab };
    case "habits":
      return {};
  }
}

function nonEmpty<T>(list: T[]): T[] | undefined {
  return list.length ? list : undefined;
}

// A milestone filter holds bare names, and the same name can exist in several
// projects. Resolve each one to its project so a milestone-only filter still
// tells the model where a new task belongs.
function resolveMilestones(
  names: string[],
  projects: string[],
  milestones: Milestone[]
): Array<{ name: string; project?: string }> {
  return names.flatMap((name) => {
    const matches = milestones.filter(
      (m) => m.name === name && (!projects.length || (m.project && projects.includes(m.project)))
    );
    return matches.length ? matches.map((m) => ({ name, project: m.project })) : [{ name }];
  });
}

/**
 * Describes a Marvis view for the assistant. The filter is global, so a value
 * set in one view stays in the store after switching to another: this mirrors
 * the chips FilterBar shows for `kind`, leaving out whatever the user can't see
 * as applied there.
 */
export function describeView(
  kind: ViewKind,
  filter: FilterState,
  viewState: ViewStateSettings,
  milestones: Milestone[]
): ViewContext {
  const tab = kind === "table" ? viewState.tableTab : undefined;
  const habits = kind === "habits";
  const projects = tab === "projects" ? [] : filter.projects;
  const filters: ViewFilters = {
    projects: nonEmpty(projects),
    milestones:
      tab === "milestones"
        ? undefined
        : nonEmpty(resolveMilestones(filter.milestones, projects, milestones)),
    statuses: habits ? undefined : nonEmpty(filter.statuses),
    priorities: habits ? undefined : nonEmpty(filter.priorities),
    tags: nonEmpty(filter.tags),
    frequencies: habits ? nonEmpty(filter.frequencies) : undefined,
    habitStates: habits ? nonEmpty(filter.habitStates) : undefined,
    search: filter.search.trim() || undefined,
    includeArchived: filter.includeArchived || undefined,
  };
  return {
    view: kind,
    ...viewSettings(kind, viewState),
    filters: Object.values(filters).some((v) => v !== undefined) ? filters : undefined,
  };
}
