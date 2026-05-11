---
name: obsidian-plugin-rules
description: Obsidian community-plugin registry compliance for Marvis. Use when editing user-facing strings (notices, button labels, setting names/descriptions, modal headings, command names, ribbon tooltips, dropdown options), touching `manifest.json`, changing the GitHub release workflow, modifying `eslint.config.mjs`, or writing code that could trip the obsidianmd ESLint rules (`prefer-active-doc`, `prefer-create-el`, `prefer-active-window-timers`, `no-tfile-tfolder-cast`, `no-static-styles-assignment`, `ui/sentence-case`). Covers ObsidianReviewBot quirks (the bot is stricter than the public lint rules — sentence-case is the most aggressive), the gap between local `npm run lint` and the bot, safe UI-string patterns, anti-patterns and their replacements (`fetch` → `requestUrl`, `console.log` → `console.debug`, `vault.trash` → `fileManager.trashFile`, Node imports gated by `Platform.isDesktopApp`), and manifest/release rules (lowercase id, no `v` prefix on tags, individual release artifacts, ≤250-char description).
---

# Obsidian community-plugin compliance — what to do and what not to do

Marvis is published to the Obsidian community-plugin registry. Every commit
is potentially scanned by **ObsidianReviewBot**, which uses a private rule
set built on top of `eslint-plugin-obsidianmd`. We've burned several PR
review cycles re-fixing things; this file captures the lessons so future
work doesn't repeat them.

## CI vs. the bot — the gap you must understand

- `npm run lint` runs `eslint-plugin-obsidianmd@0.2.9` (latest published)
  with the recommended preset, plus `@typescript-eslint/require-await` and
  `noInlineConfig` enabled. See [`eslint.config.mjs`](../../eslint.config.mjs).
- The bot uses an **unreleased / private rule version** that is stricter
  than anything we can install. We confirmed by experiment: building the
  plugin's `master` branch and overlaying its compiled JS produced the
  same lint output as `0.2.9`. The bot's stricter logic is not in the
  public source.
- **A green local lint is necessary but NOT sufficient.** The bot can
  still flag `obsidianmd/ui/sentence-case` violations on UI strings that
  the public rule passes.
- When the bot rejects a string the public rule passed, the workflow is:
  reword to remove ambiguity → push → wait 6h for re-scan. Last resort:
  comment `/skip` on the bot's PR with a one-line reason.

## UI strings — the highest-risk surface

Every notice, button label, setting name, setting description, modal
heading, command name, ribbon tooltip, and dropdown option text gets
scanned. Defaults that have caused failures:

### Sentence case (the rule the bot is most aggressive about)

- **Only the first letter of the sentence is capital.** Everything else
  is lowercase except recognised brands and acronyms.
- **Brand names are unreliable.** The published rule's brand list
  (`Obsidian`, `Google`, `Gemini`, `iCloud Drive`, `macOS`, etc.) doesn't
  always match what the bot accepts. Marvis is *not* in the brand list.
- **The bot has flipped on this between rounds.** Round N's "Expected"
  was lowercase `marvis`; round N+1 then flagged that exact string.
  Don't trust the suggestion blindly.
- **Safest pattern**: keep UI strings free of brand mentions where you
  can; if a brand is unavoidable, capitalise it correctly and accept
  that the bot might still complain.

### Patterns that have failed even when locally clean

- **Multi-sentence descriptions**:
  `setDesc("Foo. Bar baz.")` — keep `setDesc` to one sentence.
- **Periods inside identifiers**:
  `Calendar.app`, `data.json`, `marvis.md` — confuses sentence
  detection. Reword to drop the dot or wrap the identifier as code.
- **Acronyms mid-sentence**: `API`, `RRULE` — usually OK, but the
  bot has flagged some. Prefer to drop them when not essential.
- **Parenthesised labels**: `"(No projects)"` — the bot has flagged
  these. Use a plain phrase like `"No projects yet"`.
- **Brand-colon constructs**: `"Gemini Live: setupComplete received."`
  — flagged. Reword to drop the brand prefix.
- **Brand-tagged headings**: `setName("Gemini API key")` is fine for
  the *name* but `setDesc("Your own Google AI Studio key. Stored
  locally.")` got flagged twice. Keep descriptions generic.

### When in doubt, the safest UI string is

- One sentence, ≤ 12 words, no acronyms, no proper nouns, no parens, no
  embedded periods. Example: `"Stored locally on your device."` Such
  strings have never been flagged.

## Hard rules from the obsidianmd recommended config

These are caught by local lint. No exceptions; the bot rejects all
attempts to disable them.

| Rule | Fix |
|---|---|
| `@typescript-eslint/require-await` | Drop `async` if no `await`, or add `await`. For "must return Promise" interfaces, use `(): Promise<T> { ...; return Promise.resolve(); }` |
| `obsidianmd/prefer-active-doc` | `document` → `activeDocument`. `globalThis` → `window` (typed as `(window as ElectronWindow)`). **`eslint-disable` is forbidden.** |
| `obsidianmd/prefer-active-window-timers` | `setTimeout` → `activeWindow.setTimeout` |
| `obsidianmd/prefer-create-el` | `document.createElement("div")` → `createDiv()`, `createEl("button")`, `createSpan()` |
| `obsidianmd/no-tfile-tfolder-cast` | `(x as TFile)` → `if (x instanceof TFile) { … }` |
| `obsidianmd/no-static-styles-assignment` | `el.style.X = …` → CSS class. Add the rule to [`styles.css`](../../styles.css). |
| `@typescript-eslint/no-base-to-string` | `${args.x}` where `args: Record<string, unknown>` → `${asStr(args.x)}` (see helper in [toolRegistry.ts](../../src/services/assistant/toolRegistry.ts)) |
| `@typescript-eslint/prefer-promise-reject-errors` | `reject(err)` → `reject(err instanceof Error ? err : new Error(String(err)))` |
| `obsidianmd/ui/sentence-case` | See above. **`eslint-disable` is forbidden.** |

## Specific anti-patterns and their replacements

```ts
// ❌ window.prompt / window.alert — bot rejects no-alert
const name = window.prompt("Name?");
// ✅ use Obsidian Modal
new TextPromptModal(app, "New project", "Name", (name) => {…}).open();

// ❌ fetch() — bot rejects (no-restricted-globals)
await fetch(url);
// ✅ use Obsidian's requestUrl
import { requestUrl } from "obsidian";
const r = await requestUrl({ url });

// ❌ console.log — flagged unless console.warn/error/debug
console.log("debug");
// ✅ console.debug, console.warn, or console.error
console.debug("debug");

// ❌ direct Node imports at top level — crashes mobile
import { execFile } from "child_process";
// ✅ lazy require, gated by Platform.isDesktopApp
const req = (window as ElectronWindow).require;
const cp = req("child_process") as typeof import("child_process");

// ❌ Vault.delete / Vault.trash for user files
await app.vault.trash(file);
// ✅ FileManager.trashFile (respects user settings)
await app.fileManager.trashFile(file);
```

## Manifest / release rules (caught by the validator workflow)

- `manifest.json.id` is lowercase, no `obsidian-` prefix, no `plugin`
  suffix. Marvis uses `marvis`.
- `manifest.json.version` matches the GitHub release tag exactly. **No
  `v` prefix.** Tag `0.1.1`, not `v0.1.1`.
- `manifest.json.minAppVersion` matches the highest Obsidian API actually
  used. Marvis currently uses `ensureSideLeaf` (1.7.2). Bump this when
  adding APIs introduced in newer versions.
- The GitHub release must contain `main.js`, `manifest.json`, and
  `styles.css` as **individual files** (not zipped). The release workflow
  in [`.github/workflows/release.yml`](../../.github/workflows/release.yml)
  handles this; don't bypass it.
- `manifest.json.description`: short (< 250 chars), no "Obsidian", no
  "this plugin", ends with `.?!)`.

## Workflow tips

- **Always run `npm run lint` before pushing.** CI runs it; failing locally
  saves a CI cycle.
- **After changing dependencies** (`package.json`), run `npm install` to
  regenerate `package-lock.json` and commit both. CI uses `npm ci` which
  fails fast on any mismatch.
- **Don't add `eslint-disable` comments** for `obsidianmd/prefer-active-doc`
  or `obsidianmd/ui/sentence-case`. The bot rejects them outright. Fix the
  underlying issue or reword.
- **Don't loosen `eslint.config.mjs`** to suppress rules; the bot ignores
  local overrides and the PR will be rejected anyway.
- **When the bot flags something the local rule passed**: reword the
  string (don't argue), push, wait 6h. If the bot is genuinely wrong,
  `/skip` with reasoning is supported.

## Useful resources

- ESLint plugin source: <https://github.com/obsidianmd/eslint-plugin>
- Plugin guidelines: <https://docs.obsidian.md/Plugins/Releasing/Plugin+guidelines>
- Submission requirements: <https://docs.obsidian.md/Plugins/Releasing/Submission+requirements+for+plugins>
- Plugin API: <https://github.com/obsidianmd/obsidian-api>
