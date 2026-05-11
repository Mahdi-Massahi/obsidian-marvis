# Architecture

This document describes the internal design of Marvis. Read it before
making cross-cutting changes. For setup and contribution flow, see
[CONTRIBUTING.md](./CONTRIBUTING.md).

## Tech stack

- **TypeScript**, **React 18**, **Zustand** store
- Obsidian plugin API (`obsidian` peer dependency)
- **esbuild** bundles `src/main.ts` → `main.js`
- **@dnd-kit** (drag & drop), **date-fns**, **fuse.js** (fuzzy search),
  **rrule** (recurrence)

## Vault layout

The plugin owns one root folder (default `Marvis/`, configurable). Inside
it:

```
<root>/
  <Project>/
    _project.md           # kind: project
    milestones/<m>.md     # kind: milestone
    tasks/<t>.md          # kind: task
    logs/<YYYY-MM-DD-HH-mm-ss>.md   # kind: log
    events/<date>-<title>.md         # kind: event
    skills/marvis.md      # per-project coding-agent skill
    archive/              # archived tasks live here
  _chats/<datetime>.md    # AI assistant transcripts (when persistTranscripts on)
```

Every entity is a markdown file with frontmatter. The `kind` field
discriminates them. Tasks and milestones reference their project via
`[[Wikilinks]]`. See
[`src/schema/frontmatter.ts`](src/schema/frontmatter.ts) for the parsers
and [`src/schema/types.ts`](src/schema/types.ts) for the canonical shapes.

## Code map

- [`src/main.ts`](src/main.ts) — plugin lifecycle, service wiring,
  ribbon, file-menu integration, code allocator (`T-/L-/M-/P-/E-` IDs).
- [`src/settings.ts`](src/settings.ts) — settings schema + tab UI (root
  folder, statuses, priorities, calendar sync, assistant, skill
  template).
- [`src/commands.ts`](src/commands.ts) — palette commands.
- [`src/index/`](src/index/) — `Indexer` watches the vault and feeds the
  Zustand `store` (projects/milestones/tasks/logs/events).
- [`src/schema/`](src/schema/) — types, frontmatter parsers, default
  vocabularies.
- [`src/services/`](src/services/) — CRUD against the vault. Frontmatter
  is the source of truth.
  - `projectService.ts`, `milestoneService.ts`, `taskService.ts`,
    `logService.ts`, `eventService.ts`
  - `calendar/` — Apple Calendar sync (macOS-only, read-only).
  - `assistant/` — Gemini Live voice/text assistant.
- [`src/views/`](src/views/) — React views.
  - `PlannerView.tsx` — the Obsidian `ItemView`; mounts React, holds the
    toolbar/filter bar, switches between view kinds.
  - `AssistantView.tsx` — sidebar `ItemView` for the AI assistant panel.
  - `Kanban.tsx`, `Timeline.tsx`, `Calendar.tsx`, `Table.tsx` — the four
    view kinds.
  - `AssistantPanel.tsx` — chat/voice UI body.
  - `shared/` — `FilterBar`, `TaskCard`, `QuickCreateModal` (smart-parse
    `!high due:tomorrow @Project #tag`), `CreateMenuModal`,
    `ConfirmModal`, `AssistantConfirmModal`, `TaskActionBar`, `Icon`.
  - `table/` — per-kind table renderers.
- [`src/filter/`](src/filter/) — filter engine + Fuse-based search.
- [`src/utils/`](src/utils/) — date helpers, fractional indexing for
  drag-reorder, attachment helpers, recurrence (RRULE) helpers,
  file-open routing.
- [`src/skills/defaultTemplate.ts`](src/skills/defaultTemplate.ts) —
  bundled `marvis.md` skill template scaffolded into each project.

## Conventions

- **Frontmatter is the source of truth.** When changing a
  task/project/milestone, mutate the file via
  `app.fileManager.processFrontMatter` (see services). Don't keep
  parallel state in the store — the indexer re-derives it from the
  vault.
- **IDs are file paths.** Stable codes (`T-1`, `P-3`, …) are allocated
  in `main.ts` via `allocateCode` and persisted in settings
  (`nextCode`). `backfillCodes` in `commands.ts` retrofits older notes.
- **Drag-reorder uses fractional indexing**
  ([`utils/fractionalIndex.ts`](src/utils/fractionalIndex.ts)) on the
  `order` frontmatter field — avoid resequencing siblings.
- **Statuses and priorities are user-configurable vocabularies**
  (`StatusDef`, `PriorityDef`). Don't hard-code IDs; resolve through
  `settings.statuses` / `settings.priorities`. New statuses are migrated
  in `loadSettings` (see the `review` migration for the pattern).
- **React components read from the Zustand store via
  `views/context.ts`.** Don't reach into Obsidian APIs from inside view
  components — go through services.
- **Calendar sync is one-way (external → vault).** Synced events carry
  `extId` + `source` and the `#external` tag; never write back to the
  provider.
- **The assistant must gate every vault mutation through
  `AssistantConfirmModal`.** Don't add tools that mutate without a
  confirm step.

## Platform notes

- `isDesktopOnly: false` in `manifest.json` — keep the core working on
  mobile. macOS-only features (Apple Calendar sync) check
  `provider.isAvailable()` and degrade gracefully.
- Gemini Live audio sessions are capped at 15 minutes by Google; the
  timer in `AssistantPanel` reflects that. Pre-emptive reconnect kicks
  in 30 seconds before the cap.
- Obsidian APIs used (and their minimum versions): `ensureSideLeaf` is
  1.7.2 — keep `manifest.json.minAppVersion` aligned with the highest
  required API.

## Community-plugin compliance

Marvis is published to the Obsidian community-plugin registry, and every
PR is scanned by `ObsidianReviewBot`. The bot enforces stricter rules than
what `npm run lint` catches locally — particularly for UI string casing.
Before opening a PR or pushing user-facing strings, read
[`.marvis/skills/obsidian-plugin-rules.md`](.marvis/skills/obsidian-plugin-rules.md)
for the full list of patterns to avoid and the workflow when the bot
flags something the local lint passed.
