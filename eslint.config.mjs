// Reproduces what we can of the obsidianmd community-plugin validation bot.
// Two important caveats:
//
// 1. The published `eslint-plugin-obsidianmd` (currently 0.2.9, latest on
//    npm) is a strict subset of what the bot actually runs. The bot uses an
//    unreleased / private rule version (the validator is in a non-public
//    repo). A green local lint is necessary but NOT sufficient — the bot
//    can still flag `obsidianmd/ui/sentence-case` violations on strings
//    that the published rule passes. When that happens, either reword the
//    string to remove the ambiguity or comment `/skip` on the bot's PR
//    explaining why.
//
// 2. We additionally enable `require-await` and forbid inline
//    `eslint-disable` directives — the bot enforces both even though the
//    published recommended config doesn't. So our config is stricter than
//    what's published, but still looser than what the bot actually runs.
//
// Don't loosen any rule here; the bot ignores local overrides and the PR
// will be rejected anyway.
import tsparser from "@typescript-eslint/parser";
import { defineConfig } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";

export default defineConfig([
  ...obsidianmd.configs.recommended,
  {
    files: ["src/**/*.ts", "src/**/*.tsx"],
    languageOptions: {
      parser: tsparser,
      parserOptions: { project: "./tsconfig.json" },
    },
    // The bot enables `require-await`; the published recommended config
    // disables it. Re-enable to match.
    rules: {
      "@typescript-eslint/require-await": "error",
    },
    // Forbid `eslint-disable` and friends globally. The bot rejects
    // disabling `obsidianmd/prefer-active-doc` and `obsidianmd/ui/sentence-case`
    // outright. We can't selectively forbid those two without a custom rule,
    // so disallow inline directives entirely — fix the underlying issues.
    linterOptions: {
      noInlineConfig: true,
      reportUnusedDisableDirectives: "error",
    },
  },
  {
    ignores: [
      "main.js",
      "node_modules/",
      "docs/",
      ".github/",
      ".marvis/",
      "esbuild.config.mjs",
      "eslint.config.mjs",
    ],
  },
]);
