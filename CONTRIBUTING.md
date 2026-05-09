# Contributing to Marvis

Thanks for your interest in helping! Marvis is an Obsidian community plugin
that turns a vault into a multi-view project planner. Contributions of any
size are welcome — bug reports, fixes, new view affordances, docs, examples.

## Local setup

1. Fork and clone the repo.
2. `npm install`
3. Symlink the cloned folder into a test vault so Obsidian loads your
   working copy:
   ```bash
   ln -s "$(pwd)" "<vault>/.obsidian/plugins/marvis"
   ```
4. `npm run dev` — esbuild watches and rebuilds `main.js` on save.
5. In Obsidian, enable the plugin under Settings → Community plugins
   (you may need to reload the vault after enabling for the first time).

## Before opening a PR

- `npm run typecheck` must pass (this is what CI runs).
- For UI changes, include a before/after screenshot or a short GIF in the
  PR description.
- Keep commit messages in [Conventional Commits](https://www.conventionalcommits.org/)
  style — the repo already uses `feat:`, `fix:`, `docs:`, `refactor:`. See
  `git log` for examples. Release notes are drafted from these commit
  messages at release time, so a clear subject line directly improves the
  changelog.

## What's in scope

- The four core views (Kanban, Timeline, Calendar, Table) and their
  filtering/search.
- Entity CRUD via the markdown-frontmatter source of truth (projects,
  milestones, tasks, logs, events).
- Calendar sync providers (currently Apple Calendar on macOS) — additional
  read-only providers are welcome, but the model is **vault-as-truth**:
  one-way pulls only.
- The conversational AI assistant — new tools must keep the
  confirm-before-mutating contract (`AssistantConfirmModal`).

## What's out of scope (for now)

- Anything that requires Marvis-hosted infrastructure (sync, auth, hosted
  AI). The plugin is local-first by design.
- Replacing the Obsidian-native frontmatter format with a binary store.
- Heavy framework swaps (React + Zustand + esbuild are load-bearing
  choices; PRs that swap any of them are unlikely to be accepted).

## Architecture

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the code map, conventions,
and the rules that data flowing through the indexer + store + services
must follow. Read this before touching anything cross-cutting.

## Reporting bugs

Use the bug-report issue template. Please include your Obsidian version,
OS, and minimal reproduction steps. If the bug touches the AI assistant,
also note your model setting.

## Reporting security issues

Don't open a public issue. See [SECURITY.md](./SECURITY.md).

## Code of conduct

Be kind. Assume good faith. The maintainer reserves the right to close
threads that get unproductive.
