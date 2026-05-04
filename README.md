# Marvis

A multi-view project planner for Obsidian. Projects, milestones, tasks, logs, and events are real markdown notes; views (Kanban, Timeline, Calendar, Table) sit on top.

## Features

- **Four switchable views** over the same data: Kanban, Timeline (Gantt), Calendar, Table.
- **First-class entities** — projects, milestones, tasks, logs, and events are notes with frontmatter, fully compatible with Dataview/Bases.
- **Stable IDs** — every item gets a `T-/L-/M-/P-/E-` code; backfill command for existing vaults.
- **Filtering & search** — project, milestone, status, priority, tag, date range, fuzzy text. Save presets.
- **Drag-and-drop** — reorder/restage in Kanban (fractional indexing), reschedule in Calendar/Timeline.
- **Quick-create** with smart parsing: `Fix login !high due:tomorrow @Brison #bug`.
- **Quick log** to capture timestamped notes against a project.
- **Recurring tasks/events** via RRULE.
- **Customisable statuses & priorities** with colours.
- **Apple Calendar sync** (macOS) — one-way pull of events into the vault, mapped to projects.
- **Conversational AI assistant** (Gemini Live, voice + text) — every vault change is gated by a confirmation modal; transcripts can be persisted.
- **Per-project coding-agent skill** — each project gets a `skills/marvis.md` scaffolded from a configurable template.
- **Archive** — move done tasks into a project's `archive/` folder.

## Vault layout

```
Planner/
  Project Life/
    _project.md
    milestones/v1.md
    tasks/Fix-login.md
    logs/2026-05-04-09-30-00.md
    events/2026-05-10-kickoff.md
    skills/marvis.md
    archive/
```

## Development

```bash
npm install
npm run dev      # esbuild watch
npm run build    # tsc + esbuild production
```

To test in a real vault, symlink this folder into `<vault>/.obsidian/plugins/marvis/`.
