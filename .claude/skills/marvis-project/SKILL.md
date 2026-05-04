---
name: marvis-project
description: Conventions for working inside a Marvis project folder (a symlinked Obsidian vault project containing tasks/, milestones/, logs/, archive/, skills/). Use when picking up a Marvis task, updating its status, recording work, writing logs, or editing any markdown note with `kind: task|milestone|log|project` frontmatter. Covers task intake (add `by-AI` tag, append a `## Plan` section, set `in-progress`), the `backlog → todo → in-progress → review → done` flow (never set `done` yourself), wikilink rules (bare names), exact frontmatter shapes, when to write a log vs append a task Update, and hard rules (don't unarchive, don't delete, don't rename `_project.md`, don't write secrets).
---

# Marvis project conventions

This folder is a **Marvis project**: a symlinked Obsidian vault project where tasks, milestones, logs, and the archive are real markdown notes. When you operate on these notes, follow the rules below.

Before starting any task, also read every other `.md` in the project's `skills/` folder for project-specific knowledge (the canonical copy of these rules lives at `.marvis/skills/marvis.md`).

## Folder layout

- `_project.md` — project metadata (`kind: project`).
- `tasks/*.md` — open tasks (`kind: task`).
- `milestones/*.md` — milestones (`kind: milestone`).
- `logs/*.md` — time-stamped log entries (`kind: log`); filename is the timestamp `YYYY-MM-DD-HH-mm-ss.md`.
- `archive/*.md` — completed/archived items. **Do not unarchive without an explicit user request.**
- `skills/*.md` — agent guidance. Add more here for project-specific conventions.

## Frontmatter — exact shapes

### Task (`kind: task`)

```yaml
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
```

### Milestone (`kind: milestone`)

```yaml
---
kind: milestone
project: "[[<project>]]"
status: planned | active | done
start: 2026-05-01    # optional
due:   2026-06-01
---
```

### Log (`kind: log`)

```yaml
---
kind: log
project: "[[<project>]]"
timestamp: 2026-05-12T14:33:07
tags: [agent]
created: 2026-05-12
---
```

Body is freeform markdown — embeds (`![[file.png]]`, `![[clip.mp3]]`) work.

## Wikilink rules

- Use the **bare folder/file name** in wikilinks: `[[marvis]]`, not `[[Marvis/marvis/_project]]`.
- No `.md` extension.
- The plugin parses the inner text via `stripWikilink`; pathy links work but bare names are preferred.

## How to pick a task

1. List `tasks/*.md`.
2. Filter: `status` not `done`, `archived` not `true`.
3. Sort: priority (`high` > `medium` > `low`), then `due` ascending, then `order` ascending.
4. Show the user the candidates by title; ask them to pick before doing work.
5. Read the picked task's full body before you start.
6. **Add `by-AI` to the task's `tags`** (if not already there). Preserve all other existing tags.
7. Set `status: in-progress` (regardless of prior status — see note below).
8. **Append a plan section to the task body** before writing any code:

   ```markdown
   ## Plan — 2026-05-02 20:30 (by-AI)

   <2–6 bullet points on the approach, files to touch, and any open assumptions>
   ```

   Keep it tight — concrete enough to execute against, short enough to scan.

**Picking a task in a non-default state:** the user may hand you a task that's already `in-progress`, `blocked`, or even `done` (e.g. for a follow-up). The intake is still the same — add `by-AI` to tags, append a fresh `## Plan — <timestamp> (by-AI)` section, and set `status: in-progress` if it isn't already there. Don't skip the plan just because the task wasn't in `todo`.

## How to update task state

- Edit only the `---` frontmatter block of the task — don't rewrite the existing body unless the user asks. The body is the user's task description. You may **append** new headings (Plan, Update, Blocked) without touching what was already there.
- When you start: `status: in-progress`.
- When you finish: `status: review` (not `done`) **and append a work-summary section to the task's body** (see "Recording work on a task"). The user reviews the change and flips it to `done` themselves; never set `done` yourself unless the user explicitly tells you to.
- Status flow: `backlog → todo → in-progress → review → done`. `blocked` is a side-state used when you genuinely can't proceed.
- Never invent a status or priority value. Use what's already in use across the project, or the canonical set above.

## When the task is vague or under-specified

Try to complete it autonomously first. Use the title, body, surrounding code, and the rest of the project's `skills/` folder to make a reasonable interpretation. Only stop if you genuinely cannot proceed without input the codebase doesn't have.

If you're truly blocked:

1. Set `status: blocked`.
2. Append a Blocked section to the task body explaining what's missing:

   ```markdown
   ## Blocked — 2026-05-02 20:30 (by-AI)

   <what you understood the task to be>

   **Need from user:** <specific question(s) or missing decision(s)>

   <what you tried before stopping, if anything>
   ```

   Be specific — a question the user can answer in one sentence beats a vague "needs more info." Don't set `blocked` for trivial ambiguity you can resolve yourself; that's just noise.

## Recording work on a task

When you finish (or pause meaningfully) a task, **append** to the task's body under a heading so the user can see what you did:

```markdown
## Update — 2026-05-02 20:30 (by-AI)

<one or two sentences on what you changed>

- file/path/one.ts
- file/path/two.tsx
```

Use a fresh `## Update — <timestamp> (by-AI)` heading per session so multiple updates accumulate. Keep it short — link to files, not full diffs.

## When to write a log entry

Logs are for project-wide events, **not** routine task completions. Write a log only when:

- You make a non-obvious decision that spans multiple tasks (library choice, design tradeoff, blocking issue).
- The user explicitly asks you to record something.

Filename = current local timestamp `YYYY-MM-DD-HH-mm-ss.md` (must match `timestamp:` to the second). Body is freeform. **Always include `by-AI` in `tags`**.

## Hard rules

- **Don't unarchive** anything in `archive/` without explicit confirmation.
- **Don't touch other projects** in the surrounding `Marvis/` (you only see this one via the symlink).
- **Don't write secrets** (tokens, API keys, passwords) into any task or log body. If the user shares one for context, omit it from anything you save.
- **Don't delete** files. Archive (frontmatter flag + folder move) instead.
- **Don't rename `_project.md`** or change the project's folder name — that's the project's identity.
