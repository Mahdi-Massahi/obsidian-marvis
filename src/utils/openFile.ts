import { App, MarkdownView, TFile, WorkspaceLeaf } from "obsidian";

export type OpenMode = "sidebar" | "window" | "tab";

export interface SidebarLeafCache {
  get: () => WorkspaceLeaf | null;
  set: (leaf: WorkspaceLeaf | null) => void;
}

export function findOpenLeafForFile(app: App, path: string): WorkspaceLeaf | undefined {
  return app.workspace.getLeavesOfType("markdown").find((leaf) => {
    const view = leaf.view;
    return view instanceof MarkdownView && view.file?.path === path;
  });
}

function isLeafAlive(app: App, leaf: WorkspaceLeaf): boolean {
  let alive = false;
  app.workspace.iterateAllLeaves((l) => {
    if (l === leaf) alive = true;
  });
  return alive;
}

export async function openOrFocusFile(
  app: App,
  file: TFile,
  mode: OpenMode,
  cache?: SidebarLeafCache
): Promise<void> {
  const existing = findOpenLeafForFile(app, file.path);
  if (existing) {
    app.workspace.setActiveLeaf(existing, { focus: true });
    await app.workspace.revealLeaf(existing);
    return;
  }
  let leaf: WorkspaceLeaf | null = null;

  if (mode === "sidebar" && cache) {
    const cached = cache.get();
    if (cached && isLeafAlive(app, cached)) leaf = cached;
  }

  if (!leaf) {
    if (mode === "window") leaf = app.workspace.getLeaf("window");
    else if (mode === "sidebar") leaf = app.workspace.getRightLeaf(false);
  }
  if (!leaf) leaf = app.workspace.getLeaf("tab");

  await leaf.openFile(file);
  if (mode === "sidebar" && cache) cache.set(leaf);
  await app.workspace.revealLeaf(leaf);
}
