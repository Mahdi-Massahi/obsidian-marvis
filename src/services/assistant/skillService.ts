import { App, normalizePath, TFile } from "obsidian";
import { todayISO } from "../../schema/frontmatter";
import type { ProjectService } from "../projectService";

export interface SkillIndexEntry {
  name: string;
  description: string;
  path: string;
}

export interface LoadedSkill {
  name: string;
  description: string;
  body: string;
  path: string;
}

const FRONTMATTER_RE = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/;

/**
 * A growable library of reusable "skills" for the voice assistant — short
 * markdown instruction files the model can load on demand. Distinct from the
 * per-project coding-agent skills (`<project>/skills/marvis.md`): these live
 * under `<root>/_assistant/skills` and shape the assistant's own behavior.
 *
 * The files carry `kind: skill`, so `getKind` returns null and the indexer
 * never treats them as entities; the `_assistant` subtree is also skipped by
 * the indexer walk.
 */
export class SkillService {
  constructor(
    private app: App,
    private getRoot: () => string,
    private projects: ProjectService
  ) {}

  skillsFolder(): string {
    return normalizePath(`${this.getRoot()}/_assistant/skills`);
  }

  private slugify(name: string): string {
    const slug = (name ?? "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    return slug || "skill";
  }

  private skillPath(name: string): string {
    return normalizePath(`${this.skillsFolder()}/${this.slugify(name)}.md`);
  }

  private skillFiles(): TFile[] {
    const prefix = `${this.skillsFolder()}/`;
    return this.app.vault.getMarkdownFiles().filter((f) => f.path.startsWith(prefix));
  }

  private fmName(f: TFile): string {
    const fm = this.app.metadataCache.getFileCache(f)?.frontmatter;
    const name = fm && typeof fm.name === "string" ? fm.name.trim() : "";
    return name || f.basename;
  }

  private fmDescription(f: TFile): string {
    const fm = this.app.metadataCache.getFileCache(f)?.frontmatter;
    return fm && typeof fm.description === "string" ? fm.description.trim() : "";
  }

  /**
   * Lightweight index (name + description) of every saved skill. Synchronous —
   * reads frontmatter from the metadata cache so it can feed the system prompt
   * at connect time.
   */
  listSkillIndex(): SkillIndexEntry[] {
    return this.skillFiles()
      .map((f) => ({ name: this.fmName(f), description: this.fmDescription(f), path: f.path }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Read a skill's full body by its frontmatter name (case-insensitive) or slug. */
  async loadSkill(name: string): Promise<LoadedSkill> {
    const wanted = (name ?? "").trim().toLowerCase();
    if (!wanted) throw new Error("A skill name is required.");
    const slug = this.slugify(name);
    const file = this.skillFiles().find(
      (f) => this.fmName(f).toLowerCase() === wanted || f.basename.toLowerCase() === slug
    );
    if (!file) throw new Error(`No skill named "${name}".`);
    const raw = await this.app.vault.cachedRead(file);
    return {
      name: this.fmName(file),
      description: this.fmDescription(file),
      body: raw.replace(FRONTMATTER_RE, "").trim(),
      path: file.path,
    };
  }

  /** Create or overwrite a skill. Frontmatter-quoted so odd names/descriptions stay valid YAML. */
  async saveSkill(
    name: string,
    description: string,
    body: string
  ): Promise<{ path: string; created: boolean }> {
    const cleanName = (name ?? "").trim();
    if (!cleanName) throw new Error("A skill name is required.");
    const path = this.skillPath(cleanName);
    const desc = (description ?? "").replace(/\s+/g, " ").trim();
    const frontmatter = [
      "---",
      "kind: skill",
      `name: ${JSON.stringify(cleanName)}`,
      `description: ${JSON.stringify(desc)}`,
      `created: ${todayISO()}`,
      "---",
      "",
    ].join("\n");
    const content = `${frontmatter}${(body ?? "").trim()}\n`;
    await this.projects.ensureFolder(this.skillsFolder());
    const existing = this.app.vault.getAbstractFileByPath(path);
    if (existing instanceof TFile) {
      await this.app.vault.modify(existing, content);
      return { path, created: false };
    }
    if (existing) throw new Error(`Path exists but is not a file: ${path}`);
    await this.app.vault.create(path, content);
    return { path, created: true };
  }
}
