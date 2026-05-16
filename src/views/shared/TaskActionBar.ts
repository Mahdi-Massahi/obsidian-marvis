import { MarkdownView, Notice, WorkspaceLeaf } from "obsidian";
import type KanbanPlusPlugin from "../../main";
import type { Task } from "../../schema/types";
import { ConfirmModal } from "./ConfirmModal";

const BAR_CLASS = "kp-task-actionbar";
const FLAG_ATTR = "data-kp-actionbar";

export class TaskActionBar {
  private plugin: KanbanPlusPlugin;
  private storeUnsub: (() => void) | null = null;

  constructor(plugin: KanbanPlusPlugin) {
    this.plugin = plugin;
  }

  start(): void {
    const ws = this.plugin.app.workspace;
    this.plugin.registerEvent(ws.on("file-open", () => this.refresh()));
    this.plugin.registerEvent(ws.on("active-leaf-change", () => this.refresh()));
    this.plugin.registerEvent(ws.on("layout-change", () => this.refresh()));
    this.plugin.registerEvent(
      this.plugin.app.metadataCache.on("changed", (file) => {
        if (this.plugin.store.getState().tasks[file.path]) this.refresh();
      })
    );

    this.storeUnsub = this.plugin.store.subscribe(() => this.refresh());

    ws.onLayoutReady(() => this.refresh());
  }

  stop(): void {
    this.storeUnsub?.();
    this.storeUnsub = null;
    activeDocument.querySelectorAll(`.${BAR_CLASS}`).forEach((el) => el.remove());
  }

  private refresh(): void {
    const leaves = this.plugin.app.workspace.getLeavesOfType("markdown");
    const tasks = this.plugin.store.getState().tasks;
    for (const leaf of leaves) this.refreshLeaf(leaf, tasks);
  }

  private refreshLeaf(leaf: WorkspaceLeaf, tasks: Record<string, Task>): void {
    const view = leaf.view as MarkdownView | undefined;
    if (!view) return;
    const file = view.file ?? null;
    const container = view.containerEl;
    const viewContent = container?.querySelector(".view-content");
    if (!viewContent) return;

    const existing = viewContent.querySelector(
      `:scope > .${BAR_CLASS}`
    );
    const task = file ? tasks[file.path] : undefined;

    if (!task) {
      existing?.remove();
      return;
    }

    if (!existing) {
      const bar = this.createBar(task);
      viewContent.insertBefore(bar, viewContent.firstChild);
      return;
    }

    if (existing.getAttribute(FLAG_ATTR) !== this.signatureFor(task)) {
      this.populateBar(existing as HTMLElement, task);
    }
  }

  private createBar(task: Task): HTMLElement {
    const bar = createDiv();
    bar.className = `${BAR_CLASS} kp-portal`;
    this.populateBar(bar, task);
    return bar;
  }

  private populateBar(bar: HTMLElement, task: Task): void {
    bar.setAttribute(FLAG_ATTR, this.signatureFor(task));
    while (bar.firstChild) bar.removeChild(bar.firstChild);

    const meta = createDiv();
    meta.className = `${BAR_CLASS}__meta`;
    if (task.code) {
      const code = createSpan();
      code.className = "kp-code";
      code.textContent = task.code;
      meta.appendChild(code);
    }
    if (task.archived) {
      const badge = createSpan();
      badge.className = `${BAR_CLASS}__badge`;
      badge.textContent = "Archived";
      meta.appendChild(badge);
    }
    bar.appendChild(meta);

    const actions = createDiv();
    actions.className = `${BAR_CLASS}__actions`;

    actions.appendChild(
      this.makeButton("Open in Marvis", "kp-btn kp-btn--ghost", () => {
        void this.plugin.activateView("kanban").then(() => {
          this.plugin.store.getState().focusTask(task.path);
        });
      })
    );

    actions.appendChild(
      this.makeButton(
        task.archived ? "Unarchive" : "Archive",
        "kp-btn kp-btn--ghost",
        () => {
          const promise = task.archived
            ? this.plugin.taskService.unarchive(task)
            : this.plugin.taskService.archive(task);
          void promise.catch((e: unknown) => {
            console.error(e);
            new Notice("Failed — see console");
          });
        }
      )
    );

    actions.appendChild(
      this.makeButton("Delete", "kp-btn kp-btn--ghost kp-btn--danger", () => {
        new ConfirmModal(
          this.plugin.app,
          "Delete task",
          `Delete "${task.title}"? The file will be moved to Obsidian's trash.`,
          () => {
            void this.plugin.taskService.deleteTask(task).catch((e: unknown) => {
              console.error(e);
              new Notice("Failed to delete — see console");
            });
          },
          "Delete"
        ).open();
      })
    );

    bar.appendChild(actions);
  }

  private makeButton(label: string, className: string, onClick: () => void): HTMLButtonElement {
    const btn = createEl("button");
    btn.className = className;
    btn.textContent = label;
    btn.addEventListener("click", onClick);
    return btn;
  }

  private signatureFor(task: Task): string {
    return `${task.path}|${task.archived ? "1" : "0"}|${task.code ?? ""}`;
  }
}
