// Default coding-agent guide that scaffolds into every Marvis project at
// `<project>/skills/marvis.md`. Editable per-vault from plugin settings.

export const DEFAULT_MARVIS_SKILL = `# Marvis — Coding-agent guide

This folder is a **Marvis project**. Tasks, milestones, logs, and the archive
are real markdown notes managed by the Marvis Obsidian plugin. The folder has
been symlinked into a code repo so coding agents (Claude Code, Cursor, …) can
read and edit them directly.

You should read this file before starting any work in this project, and read
every other \`.md\` in this \`skills/\` folder for project-specific knowledge.

## Folder layout

- \`_project.md\` — project metadata (\`kind: project\`).
- \`tasks/*.md\` — open tasks (\`kind: task\`).
- \`milestones/*.md\` — milestones (\`kind: milestone\`).
- \`logs/*.md\` — time-stamped log entries (\`kind: log\`); filename is the
  timestamp \`YYYY-MM-DD-HH-mm-ss.md\`.
- \`events/*.md\` — calendar entries (\`kind: event\`); filename is
  \`YYYY-MM-DD-<slug>.md\`. May be recurring via an iCal RRULE.
- \`archive/*.md\` — completed/archived items. **Do not unarchive without an
  explicit user request.**
- \`skills/*.md\` — agent guidance (you are reading one of these). Add more
  here for project-specific conventions.

## Frontmatter — exact shapes

### Task (\`kind: task\`)

\`\`\`yaml
---
kind: task
project: "[[<project-folder-name>]]"   # required
milestone: "[[<milestone-name>]]"      # optional
status: backlog | todo | in-progress | review | blocked | done
priority: low | medium | high          # optional
due: 2026-05-12                        # YYYY-MM-DD, optional
start: 2026-05-01                      # YYYY-MM-DD, optional
tags: [bug, auth]
created: 2026-05-01
order: 1.5                             # fractional sort key, optional
parent: "[[<parent-task>]]"            # optional, for subtasks
recurrence: "every week"               # optional
archived: false                        # set true and move to archive/ when done
---
\`\`\`

### Milestone (\`kind: milestone\`)

\`\`\`yaml
---
kind: milestone
project: "[[<project>]]"
status: planned | active | done
start: 2026-05-01    # optional
due:   2026-06-01
---
\`\`\`

### Log (\`kind: log\`)

\`\`\`yaml
---
kind: log
project: "[[<project>]]"
timestamp: 2026-05-12T14:33:07
tags: [agent]
created: 2026-05-12
---
\`\`\`

Body is freeform markdown — embeds (\`![[file.png]]\`, \`![[clip.mp3]]\`) work.

### Event (\`kind: event\`)

Calendar-style entries. Live in \`events/*.md\` under each project folder
(or under the catch-all \`_project/events/\` if no project is set). Filename
convention: \`YYYY-MM-DD-<slug>.md\`.

\`\`\`yaml
---
kind: event
project: "[[<project>]]"          # optional; "_project" is the default
title: "Standup"
date: 2026-05-12                  # required, YYYY-MM-DD
time: "10:00"                     # optional; omit for all-day
endTime: "10:30"                  # optional
recurrence: "FREQ=WEEKLY;BYDAY=MO,WE"   # optional, RFC 5545 RRULE
tags: [meeting]
extId: "abc123@google.com"        # optional, set when imported from a feed
source: "google:user@x.com"       # optional, only set by importers
created: 2026-05-12
---
\`\`\`

- Recurrence is an iCal RRULE string — same format Google Calendar API and
  Microsoft Graph emit. One file per series; views expand occurrences only
  within the visible range.
- Events render in Calendar, Timeline and the Events table — never in
  Kanban (events aren't workflow items).
- A timed event without \`endTime\` is treated as a point in time. With
  \`endTime\`, it has a duration in the calendar tooltip.
- Body is freeform markdown — same embedding rules as logs.
- Events with \`source: macos:*\` are managed by Marvis's calendar sync
  from Apple Calendar (which mirrors any account configured in macOS:
  Exchange, iCloud, Google, etc.). Editing them by hand may be overwritten
  on the next sync. Hand-authored events have no \`source\` field and are
  never touched by sync.

## Wikilink rules

- Use the **bare folder/file name** in wikilinks: \`[[marvis]]\`, not
  \`[[Planner/marvis/_project]]\`.
- No \`.md\` extension.
- The plugin parses the inner text via \`stripWikilink\`; pathy links work but
  bare names are preferred.

## How to pick a task

1. List \`tasks/*.md\`.
2. Filter: \`status\` not \`done\`, \`archived\` not \`true\`.
3. Sort: priority (\`high\` > \`medium\` > \`low\`), then \`due\` ascending,
   then \`order\` ascending.
4. Show the user the candidates by title; ask them to pick before doing work.
5. Read the picked task's full body before you start.
6. **Add \`by-AI\` to the task's \`tags\`** (if not already there). This lets the
   user filter for AI-touched tasks later. Preserve all other existing tags.
7. Set \`status: in-progress\` (regardless of prior status — see note below).
8. **Append a plan section to the task body** before writing any code:

   \`\`\`markdown
   ## Plan — 2026-05-02 20:30 (by-AI)

   <2–6 bullet points on the approach, files to touch, and any open assumptions>
   \`\`\`

   Keep it tight — concrete enough to execute against, short enough to scan.

**Picking a task in a non-default state:** the user may hand you a task that's
already \`in-progress\`, \`blocked\`, or even \`done\` (e.g. for a follow-up). The
intake is still the same — add \`by-AI\` to tags, append a fresh \`## Plan —
<timestamp> (by-AI)\` section, and set \`status: in-progress\` if it isn't
already there. Don't skip the plan just because the task wasn't in \`todo\`.

## How to update task state

- Edit only the \`---\` frontmatter block of the task — don't rewrite the
  existing body unless the user asks. The body is the user's task description.
  You may **append** new headings (Plan, Update, Blocked) without touching what
  was already there.
- When you start: \`status: in-progress\`.
- When you finish: \`status: review\` (not \`done\`) **and append a work-summary
  section to the task's body** (see "Recording work on a task"). The user
  reviews the change and flips it to \`done\` themselves; never set \`done\`
  yourself unless the user explicitly tells you to.
- Status flow: \`backlog → todo → in-progress → review → done\`. \`blocked\` is
  a side-state used when you genuinely can't proceed.
- Never invent a status or priority value. Use what's already in use across
  the project, or the canonical set above.

## When the task is vague or under-specified

Try to complete it autonomously first. Use the title, body, surrounding code,
and the rest of this skills folder to make a reasonable interpretation. Only
stop if you genuinely cannot proceed without input the codebase doesn't have.

If you're truly blocked:

1. Set \`status: blocked\`.
2. Append a Blocked section to the task body explaining what's missing:

   \`\`\`markdown
   ## Blocked — 2026-05-02 20:30 (by-AI)

   <what you understood the task to be>

   **Need from user:** <specific question(s) or missing decision(s)>

   <what you tried before stopping, if anything>
   \`\`\`

   Be specific — a question the user can answer in one sentence beats a vague
   "needs more info." Don't set \`blocked\` for trivial ambiguity you can resolve
   yourself; that's just noise.

## Recording work on a task

When you finish (or pause meaningfully) a task, **append** to the task's body
under a heading so the user can see what you did:

\`\`\`markdown
## Update — 2026-05-02 20:30 (by-AI)

<one or two sentences on what you changed>

- file/path/one.ts
- file/path/two.tsx
\`\`\`

Use a fresh \`## Update — <timestamp> (by-AI)\` heading per session so multiple
updates accumulate. Keep it short — link to files, not full diffs.

## When to write a log entry

Logs are for project-wide events, **not** routine task completions. Write a
log only when:

- You make a non-obvious decision that spans multiple tasks (library choice,
  design tradeoff, blocking issue).
- The user explicitly asks you to record something.

Filename = current local timestamp \`YYYY-MM-DD-HH-mm-ss.md\` (must match
\`timestamp:\` to the second). Body is freeform. **Always include \`by-AI\` in
\`tags\`**.

## Hard rules

- **Don't unarchive** anything in \`archive/\` without explicit confirmation.
- **Don't touch other projects** in the surrounding \`Planner/\` (you only
  see this one via the symlink).
- **Don't write secrets** (tokens, API keys, passwords) into any task or log
  body. If the user shares one for context, omit it from anything you save.
- **Don't delete** files. Archive (frontmatter flag + folder move) instead.
- **Don't rename \`_project.md\`** or change the project's folder name —
  that's the project's identity.

## Adding more skills

If a project needs deeper conventions (database schema, API contract, naming
rules), create another \`.md\` next to this one and explain them. Keep
\`marvis.md\` focused on the universal Marvis conventions.
`;
