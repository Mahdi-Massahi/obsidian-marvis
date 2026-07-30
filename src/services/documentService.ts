import { App, normalizePath, TFile } from "obsidian";
import type { ProjectService } from "./projectService";

export interface CreateDocumentOptions {
  content?: string;
  overwrite?: boolean;
}

export interface AppendDocumentOptions {
  heading?: string;
  createIfMissing?: boolean;
}

/**
 * Free-form markdown documents anywhere in the vault. Unlike the other
 * services, these files are NOT Marvis entities — they carry no `kind`
 * frontmatter and the indexer ignores them. This backs the assistant's
 * create_document / append_to_document tools so the user can dictate content
 * and have it persisted to an ordinary note.
 */
export class DocumentService {
  constructor(
    private app: App,
    private projects: ProjectService
  ) {}

  /**
   * Turn a user/model-supplied path into a safe, vault-relative markdown path.
   * Adds a `.md` extension when missing and rejects attempts to escape the
   * vault root via `..` segments.
   */
  resolvePath(rawPath: string): string {
    const trimmed = (rawPath ?? "").trim();
    if (!trimmed) throw new Error("A file path is required.");
    let path = normalizePath(trimmed);
    if (path.split("/").some((seg) => seg === "..")) {
      throw new Error(`Invalid path (must stay inside the vault): ${rawPath}`);
    }
    if (!path.toLowerCase().endsWith(".md")) path = `${path}.md`;
    return path;
  }

  private async ensureParentFolder(path: string): Promise<void> {
    const idx = path.lastIndexOf("/");
    if (idx <= 0) return; // at the vault root — nothing to create
    const parent = path.slice(0, idx);
    if (parent) await this.projects.ensureFolder(parent);
  }

  /**
   * Normalize a path for reading without forcing a `.md` extension (the caller
   * may point at a note whose exact name we don't want to mangle). Still guards
   * against escaping the vault root.
   */
  private resolveReadPath(rawPath: string): string {
    const trimmed = (rawPath ?? "").trim();
    if (!trimmed) throw new Error("A file path is required.");
    const path = normalizePath(trimmed);
    if (path.split("/").some((seg) => seg === "..")) {
      throw new Error(`Invalid path (must stay inside the vault): ${rawPath}`);
    }
    return path;
  }

  /**
   * Read any note in the vault by path — Marvis entity or free-form document.
   * Tries the path as given, then with `.md` appended, so callers can name a
   * file loosely ("Notes/Journal") and still hit "Notes/Journal.md".
   */
  async readDocument(
    rawPath: string
  ): Promise<{ path: string; basename: string; content: string }> {
    const norm = this.resolveReadPath(rawPath);
    const candidates = norm.toLowerCase().endsWith(".md")
      ? [norm]
      : [norm, `${norm}.md`];
    for (const candidate of candidates) {
      const file = this.app.vault.getAbstractFileByPath(candidate);
      if (file instanceof TFile) {
        const content = await this.app.vault.cachedRead(file);
        return { path: file.path, basename: file.basename, content };
      }
    }
    throw new Error(
      `No file at ${norm}${norm.toLowerCase().endsWith(".md") ? "" : " (also tried .md)"}`
    );
  }

  /**
   * List markdown files in the vault, optionally scoped to a folder. Covers
   * free-form documents that the search/list_* tools (which only see indexed
   * Marvis entities) can't surface, so the assistant can find a file to read.
   */
  listDocuments(
    options: { folder?: string; limit?: number } = {}
  ): { files: Array<{ path: string; basename: string; folder: string }>; total: number; truncated: boolean } {
    const limit = options.limit && options.limit > 0 ? options.limit : 100;
    const prefix = options.folder?.trim() ? normalizePath(options.folder.trim()) : "";
    const matched = this.app.vault
      .getMarkdownFiles()
      .filter((f) => !prefix || f.path === prefix || f.path.startsWith(`${prefix}/`))
      .sort((a, b) => a.path.localeCompare(b.path));
    const files = matched.slice(0, limit).map((f) => ({
      path: f.path,
      basename: f.basename,
      folder: f.parent?.path ?? "",
    }));
    return { files, total: matched.length, truncated: matched.length > files.length };
  }

  /**
   * Search INSIDE the body text of markdown files across the vault, including
   * free-form documents that `search_vault` (indexed entities, titles/tags
   * only) can't see. Case-insensitive line-grep, optional regex, returns the
   * matched line snippets per file. Bounded for performance: recent files
   * first, hard scan cap, and early-exit once `limit` files have matched.
   */
  async searchContent(
    query: string,
    options: { folder?: string; limit?: number; regex?: boolean } = {}
  ): Promise<{
    query: string;
    matches: Array<{ path: string; basename: string; count: number; snippets: Array<{ line: number; text: string }> }>;
    scanned: number;
    truncated: boolean;
  }> {
    const q = (query ?? "").trim();
    if (!q) return { query: q, matches: [], scanned: 0, truncated: false };

    const limit = options.limit && options.limit > 0 ? options.limit : 20;
    const prefix = options.folder?.trim() ? normalizePath(options.folder.trim()) : "";

    let matcher: (line: string) => boolean;
    if (options.regex) {
      let re: RegExp;
      try {
        re = new RegExp(q, "i");
      } catch (err) {
        throw new Error(
          `Invalid regular expression: ${err instanceof Error ? err.message : String(err)}`
        );
      }
      matcher = (line) => re.test(line);
    } else {
      const needle = q.toLowerCase();
      matcher = (line) => line.toLowerCase().includes(needle);
    }

    const MAX_SCAN = 3000;
    const MAX_SNIPPETS_PER_FILE = 3;
    const SNIPPET_MAX_CHARS = 200;

    // Skip the assistant's own subtrees unless the caller explicitly scopes there.
    const excluded = (path: string) =>
      !prefix && path.split("/").some((seg) => seg === "_chats" || seg === "_assistant");

    const candidates = this.app.vault
      .getMarkdownFiles()
      .filter((f) => !prefix || f.path === prefix || f.path.startsWith(`${prefix}/`))
      .filter((f) => !excluded(f.path))
      .sort((a, b) => b.stat.mtime - a.stat.mtime);

    const matches: Array<{ path: string; basename: string; count: number; snippets: Array<{ line: number; text: string }> }> = [];
    let scanned = 0;
    let truncated = false;

    for (const file of candidates) {
      if (matches.length >= limit || scanned >= MAX_SCAN) {
        truncated = true;
        break;
      }
      scanned++;
      const content = await this.app.vault.cachedRead(file);
      const lines = content.split(/\r?\n/);
      let count = 0;
      const snippets: Array<{ line: number; text: string }> = [];
      for (let i = 0; i < lines.length; i++) {
        if (!matcher(lines[i])) continue;
        count++;
        if (snippets.length < MAX_SNIPPETS_PER_FILE) {
          snippets.push({ line: i + 1, text: lines[i].trim().slice(0, SNIPPET_MAX_CHARS) });
        }
      }
      if (count > 0) matches.push({ path: file.path, basename: file.basename, count, snippets });
    }

    return { query: q, matches, scanned, truncated };
  }

  async createDocument(
    rawPath: string,
    options: CreateDocumentOptions = {}
  ): Promise<{ path: string; created: boolean }> {
    const path = this.resolvePath(rawPath);
    const content = options.content ?? "";
    const existing = this.app.vault.getAbstractFileByPath(path);
    if (existing instanceof TFile) {
      if (!options.overwrite) {
        throw new Error(
          `A file already exists at ${path}. Use append_to_document to add to it, or set overwrite to replace it.`
        );
      }
      await this.app.vault.modify(existing, content);
      return { path, created: false };
    }
    if (existing) throw new Error(`Path exists but is not a file: ${path}`);
    await this.ensureParentFolder(path);
    await this.app.vault.create(path, content);
    return { path, created: true };
  }

  async appendToDocument(
    rawPath: string,
    content: string,
    options: AppendDocumentOptions = {}
  ): Promise<{ path: string; created: boolean }> {
    const path = this.resolvePath(rawPath);
    const body = content ?? "";
    const section = options.heading?.trim()
      ? `## ${options.heading.trim()}\n\n${body}`
      : body;
    const existing = this.app.vault.getAbstractFileByPath(path);
    if (existing instanceof TFile) {
      await this.app.vault.process(existing, (data) => {
        const base = data.replace(/\s*$/, "");
        return base ? `${base}\n\n${section}\n` : `${section}\n`;
      });
      return { path, created: false };
    }
    if (existing) throw new Error(`Path exists but is not a file: ${path}`);
    if (options.createIfMissing === false) {
      throw new Error(
        `No file at ${path}. Create it first with create_document, or allow createIfMissing.`
      );
    }
    await this.ensureParentFolder(path);
    await this.app.vault.create(path, `${section}\n`);
    return { path, created: true };
  }
}
