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
    rules: {
      // The Obsidian recommended preset pulls in @typescript-eslint's
      // type-checked rules, several of which flag stylistic patterns that
      // aren't relevant to plugin-review acceptance. Keep the bug-class
      // rules (misused/floating promises) but drop the noise.
      "@typescript-eslint/no-base-to-string": "off",
      "@typescript-eslint/restrict-template-expressions": "off",
      "@typescript-eslint/no-unnecessary-type-assertion": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/prefer-promise-reject-errors": "off",
      // TypeScript already catches references to undefined identifiers; the
      // ESLint version doesn't know about ambient namespaces like `NodeJS`.
      "no-undef": "off",
      // The react-hooks plugin isn't installed here; the unrecognised-rule
      // warning is purely a config-discovery quirk, not a code issue.
      "react-hooks/exhaustive-deps": "off",
      // Proper nouns / brand names that should stay capitalized inside
      // otherwise sentence-cased UI strings.
      "obsidianmd/ui/sentence-case": [
        "error",
        {
          brands: [
            "Marvis",
            "Apple Calendar",
            "Calendar.app",
            "Gemini",
            "Gemini Live",
            "Google AI Studio",
            "Kanban",
            "Gantt",
            "Obsidian",
            "macOS",
            "iOS",
            "RRULE",
          ],
          acronyms: [
            "AI",
            "API",
            "ID",
            "IDs",
            "URL",
            "RSVP",
            "T",
            "L",
            "M",
            "P",
            "E",
            "OK",
          ],
        },
      ],
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
