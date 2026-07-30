import { MarkdownView, TFile } from "obsidian";
import type KanbanPlusPlugin from "../../main";

/**
 * Tracks the last markdown file the user actually had focused in a real editor.
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

  constructor(plugin: KanbanPlusPlugin) {
    this.plugin = plugin;
  }

  start(): void {
    const ws = this.plugin.app.workspace;
    this.plugin.registerEvent(
      ws.on("active-leaf-change", (leaf) => {
        const view = leaf?.view;
        // Only real markdown editors update the tracker — focusing the
        // assistant panel (not a MarkdownView) leaves the last note intact.
        if (view instanceof MarkdownView && view.file) this.last = view.file;
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
    });
  }

  /** The markdown file the user most recently had focused, or null. */
  current(): TFile | null {
    if (this.last) {
      // TFile.path updates in place on rename; re-resolving guards deletion.
      const still = this.plugin.app.vault.getAbstractFileByPath(this.last.path);
      if (still instanceof TFile) return this.last;
      this.last = null;
    }
    const active = this.plugin.app.workspace.getActiveFile();
    return active && active.extension === "md" ? active : null;
  }
}
