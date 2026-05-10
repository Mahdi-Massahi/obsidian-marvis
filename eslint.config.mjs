// Mirrors the rules the obsidianmd community-plugin validation bot enforces.
// The bot ignores local rule overrides and uses a stricter superset of
// `eslint-plugin-obsidianmd`'s published `recommended` config — currently
// adds `require-await` and forbids `eslint-disable` for two rules
// (`obsidianmd/prefer-active-doc`, `obsidianmd/ui/sentence-case`). We
// reproduce that here so a clean local lint == a clean bot report.
//
// Don't add rule overrides that loosen things; the bot won't honour them
// and the PR will be rejected anyway.
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
