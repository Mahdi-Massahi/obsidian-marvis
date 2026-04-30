# Kanban+

A Notion-style multi-view project planner for Obsidian. Every project, milestone, and task is a real markdown note; views (Kanban, Timeline, Calendar, Table) sit on top.

## Features

- **Four switchable views** over the same data: Kanban, Timeline (Gantt), Calendar, Table.
- **First-class entities** — projects, milestones, and tasks are notes with frontmatter, fully compatible with Dataview/Bases.
- **Filtering & search** — project, milestone, status, priority, tag, date range, fuzzy text. Save presets.
- **Drag-and-drop** — reorder/restage in Kanban, reschedule in Calendar/Timeline.
- **Quick-create** with smart parsing: `Fix login !high due:tomorrow @Brison #bug`.
- **Archive** — move done tasks into a project's `archive/` folder.

## Vault layout

```
Planner/
  Brison/
    _project.md
    milestones/v1.md
    tasks/Fix-login.md
    archive/
```

## Development

```bash
npm install
npm run dev      # esbuild watch
npm run build    # production build (tsc + esbuild)
```

To test in a real vault, symlink this folder into `<vault>/.obsidian/plugins/kanban-plus/`.
