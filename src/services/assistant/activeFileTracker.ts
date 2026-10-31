import { MarkdownView, TFile } from "obsidian";
import type KanbanPlusPlugin from "../../main";
import { AssistantView } from "../../views/AssistantView";
import { PlannerView, VIEW_TYPE_KANBAN_PLUS } from "../../views/PlannerView";
import { describeView, ViewContext } from "./viewContext";

/**
 * Tracks what the user actually has in front of them while talking to the
 * assistant: the last markdown file they focused in a real editor, and the
 * Marvis view (Kanban, Timeline, …) on screen.
 *
 * `workspace.getActiveFile()` returns null (or a stale value) whenever a
 * non-editor leaf — like the Marvis assistant panel — is the active leaf, which
 * is exactly the situation while the user is talking to the assistant. This
 * remembers the last `MarkdownView` file so "read the doc I have open" and the
 * `[active: …]` message stamp resolve to the note the user means, not the panel.
 */
export class ActiveFileTracker {
  private plugin: KanbanPlusPlugin;
  private last: TFile | null = null;
  private lastPlanner: PlannerView | null = null;
  // True while a Marvis view is the newest thing the user focused, not counting
  // the assistant panel. The panel can cover the view (same tab group, phone),
  // so a focused view still counts as in front when it's no longer visible.
  private plannerFocused = false;

  constructor(plugin: KanbanPlusPlugin) {
    this.plugin = plugin;
  }

  start(): void {
    const ws = this.plugin.app.workspace;
    this.plugin.registerEvent(
      ws.on("active-leaf-change", (leaf) => {
        const view = leaf?.view;
        // Focusing the assistant panel leaves everything intact — it's where
        // the user types, not what they're looking at.
        if (!view || view instanceof AssistantView) return;
        this.plannerFocused = view instanceof PlannerView;
        if (view instanceof PlannerView) this.lastPlanner = view;
        else if (view instanceof MarkdownView && view.file) this.last = view.file;
      })
    );
    this.plugin.registerEvent(
      ws.on("file-open", (file) => {
        if (file instanceof TFile && file.extension === "md") this.last = file;
      })
    );
    ws.onLayoutReady(() => {
      const f = ws.getActiveFile();
      if (f && f.extension === "md") this.last = f;
      // Obsidian fires no leaf events until the layout is ready, so a view
      // restored as the active leaf has to be picked up here.
      const planner = ws.getActiveViewOfType(PlannerView);
      if (planner) {
        this.lastPlanner = planner;
        this.plannerFocused = true;
      }
    });
  }

  /**
   * The markdown file the user most recently had focused, or null. Once a
   * Marvis view has been focused after it, the file only counts while it's
   * still on screen — otherwise "here" would resolve to a note behind the board.
   */
  current(): TFile | null {
    const file = this.lastFile();
    if (file && this.focusedPlanner() && !this.isOnScreen(file)) return null;
    return file;
  }

  /** The Marvis view in front of the user, described for the model, or null. */
  currentView(): ViewContext | null {
    const view = this.focusedPlanner() ?? this.visiblePlanner();
    if (!view) return null;
    const { filter, milestones } = this.plugin.store.getState();
    return describeView(
      view.getKind(),
      filter,
      this.plugin.settings.viewState,
      Object.values(milestones)
    );
  }

  private lastFile(): TFile | null {
    if (this.last) {
      // TFile.path updates in place on rename; re-resolving guards deletion.
      const still = this.plugin.app.vault.getAbstractFileByPath(this.last.path);
      if (still instanceof TFile) return this.last;
      this.last = null;
    }
    const active = this.plugin.app.workspace.getActiveFile();
    return active && active.extension === "md" ? active : null;
  }

  private isOnScreen(file: TFile): boolean {
    return this.plugin.app.workspace.getLeavesOfType("markdown").some((leaf) => {
      const view = leaf.view;
      return view instanceof MarkdownView && view.file?.path === file.path && view.containerEl.isShown();
    });
  }

  private openPlanners(): PlannerView[] {
    return this.plugin.app.workspace
      .getLeavesOfType(VIEW_TYPE_KANBAN_PLUS)
      .map((leaf) => leaf.view)
      .filter((view): view is PlannerView => view instanceof PlannerView);
  }

  private focusedPlanner(): PlannerView | null {
    const view = this.lastPlanner;
    return this.plannerFocused && view && this.openPlanners().includes(view) ? view : null;
  }

  // Opening a card puts its note in the sidebar and leaves the board visible,
  // so focus alone can't tell whether a view is still in front.
  private visiblePlanner(): PlannerView | null {
    const shown = this.openPlanners().filter((view) => view.containerEl.isShown());
    return shown.find((view) => view === this.lastPlanner) ?? shown[0] ?? null;
  }
}
