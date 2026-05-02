import { App, normalizePath, requestUrl, TFile } from "obsidian";
import type KanbanPlusPlugin from "../main";
import type { ProjectService } from "./projectService";
import type { LogService } from "./logService";
import type { TaskService } from "./taskService";

const API_BASE = "https://api.telegram.org/bot";
const FILE_BASE = "https://api.telegram.org/file/bot";

interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  channel_post?: TelegramMessage;
}

interface TelegramMessage {
  message_id: number;
  date: number; // unix seconds
  chat: { id: number; title?: string; username?: string };
  from?: { id: number; username?: string; first_name?: string };
  text?: string;
  caption?: string;
  voice?: TelegramFile;
  audio?: TelegramFile & { file_name?: string; mime_type?: string };
  video?: TelegramFile & { file_name?: string; mime_type?: string };
  video_note?: TelegramFile;
  document?: TelegramFile & { file_name?: string; mime_type?: string };
  photo?: TelegramFile[];
  sticker?: TelegramFile;
}

interface TelegramFile {
  file_id: string;
  file_unique_id: string;
  file_size?: number;
  duration?: number;
  width?: number;
  height?: number;
  mime_type?: string;
}

interface PullResult {
  fetched: number;
  saved: number;
  skipped: number;
  errors: number;
}

export type PullProgress =
  | { phase: "fetching" }
  | { phase: "processing"; current: number; total: number; label?: string }
  | { phase: "done"; result: PullResult };

export class TelegramService {
  constructor(
    private app: App,
    private plugin: KanbanPlusPlugin,
    private projects: ProjectService,
    private logs: LogService,
    private tasks: TaskService
  ) {}

  private get token(): string {
    return this.plugin.settings.telegramToken.trim();
  }

  async pull(onProgress?: (p: PullProgress) => void): Promise<PullResult> {
    const result: PullResult = { fetched: 0, saved: 0, skipped: 0, errors: 0 };
    if (!this.token) throw new Error("Telegram token not configured.");

    const inbox = this.plugin.settings.telegramInboxProject || "_project";
    await this.ensureInboxProject(inbox);

    onProgress?.({ phase: "fetching" });
    const offset = this.plugin.settings.telegramOffset || undefined;
    const updates = await this.getUpdates(offset);
    result.fetched = updates.length;

    const chatFilter = this.plugin.settings.telegramChatId.trim();
    const allowedChat = chatFilter ? Number(chatFilter) : null;

    const total = updates.length;
    let maxUpdateId = this.plugin.settings.telegramOffset - 1;
    for (let i = 0; i < updates.length; i++) {
      const upd = updates[i];
      if (upd.update_id > maxUpdateId) maxUpdateId = upd.update_id;
      const msg = upd.message ?? upd.channel_post;
      const label = msg
        ? truncate(msg.text ?? msg.caption ?? mediaLabel(msg), 60)
        : `update ${upd.update_id}`;
      onProgress?.({ phase: "processing", current: i + 1, total, label });
      if (!msg) {
        result.skipped += 1;
        continue;
      }
      if (allowedChat != null && msg.chat.id !== allowedChat) {
        result.skipped += 1;
        continue;
      }
      try {
        await this.saveMessage(inbox, msg);
        result.saved += 1;
        await this.react(msg.chat.id, msg.message_id);
      } catch (err) {
        console.error("Failed to save Telegram message", upd.update_id, err);
        result.errors += 1;
      }
    }

    if (updates.length > 0) {
      this.plugin.settings.telegramOffset = maxUpdateId + 1;
      await this.plugin.saveSettings();
    }

    onProgress?.({ phase: "done", result });
    return result;
  }

  async discoverChats(): Promise<{ id: number; title: string }[]> {
    if (!this.token) throw new Error("Telegram token not configured.");
    // Pass no offset — Telegram returns the most recent unconsumed updates
    // without acknowledging them. Safe to call repeatedly.
    const updates = await this.getUpdates();
    const seen = new Map<number, string>();
    for (const upd of updates) {
      const msg = upd.message ?? upd.channel_post;
      if (!msg) continue;
      const title =
        msg.chat.title ??
        msg.chat.username ??
        msg.from?.username ??
        msg.from?.first_name ??
        `chat ${msg.chat.id}`;
      seen.set(msg.chat.id, title);
    }
    return Array.from(seen.entries()).map(([id, title]) => ({ id, title }));
  }

  private async ensureInboxProject(name: string): Promise<void> {
    const path = this.projects.projectFilePath(name);
    if (!(this.app.vault.getAbstractFileByPath(path) instanceof TFile)) {
      await this.projects.createProject(name);
    }
  }

  private async saveMessage(inbox: string, msg: TelegramMessage): Promise<void> {
    const ts = new Date(msg.date * 1000);
    const rawText = msg.text ?? msg.caption ?? "";

    const parsed = parseRouting(rawText);
    const project = this.resolveProject(parsed.projectMention) ?? inbox;
    const tags = Array.from(new Set([...parsed.tags, "tg"]));

    // Attachments live under the destination project's tasks/_attachments or
    // logs/_attachments folder, matching the entity kind.
    const attachments = await this.handleMedia(project, parsed.kind, msg, ts);

    const bodyParts: string[] = [];
    if (parsed.cleanText) bodyParts.push(parsed.cleanText);
    for (const a of attachments) bodyParts.push(`![[${a}]]`);
    const body = bodyParts.join("\n\n").trim() || undefined;

    if (parsed.kind === "task") {
      const title = firstLine(parsed.cleanText) || `Telegram ${formatLocalStamp(ts)}`;
      const remainder = restAfterFirstLine(parsed.cleanText);
      const taskBodyParts: string[] = [];
      if (remainder) taskBodyParts.push(remainder);
      for (const a of attachments) taskBodyParts.push(`![[${a}]]`);
      const status = this.plugin.settings.statuses[0]?.id ?? "todo";
      await this.tasks.createTask({
        title,
        project,
        status,
        tags,
        body: taskBodyParts.join("\n\n").trim() || undefined,
      });
      return;
    }

    await this.logs.createLog(project, {
      timestamp: ts,
      body,
      tags,
    });
  }

  private resolveProject(mention: string | undefined): string | undefined {
    if (!mention) return undefined;
    const wanted = mention.toLowerCase();
    const projects = Object.values(this.plugin.store.getState().projects);
    const exact = projects.find((p) => p.name === mention);
    if (exact) return exact.name;
    const ci = projects.find((p) => p.name.toLowerCase() === wanted);
    return ci?.name;
  }

  private async handleMedia(
    project: string,
    kind: "task" | "log",
    msg: TelegramMessage,
    ts: Date
  ): Promise<string[]> {
    const out: string[] = [];
    const subfolder = kind === "task" ? "tasks" : "logs";
    const attachDir = normalizePath(
      `${this.projects.projectFolder(project)}/${subfolder}/_attachments`
    );

    const ensureDir = async () => {
      if (!(this.app.vault.getAbstractFileByPath(attachDir))) {
        await this.projects.ensureFolder(attachDir);
      }
    };

    const writeFile = async (
      kind: string,
      ext: string,
      file: TelegramFile,
      originalName?: string
    ): Promise<string | null> => {
      try {
        const bytes = await this.downloadFile(file.file_id);
        if (!bytes) return null;
        await ensureDir();
        const stamp = `${ts.getFullYear()}${String(ts.getMonth() + 1).padStart(2, "0")}${String(
          ts.getDate()
        ).padStart(2, "0")}-${String(ts.getHours()).padStart(2, "0")}${String(
          ts.getMinutes()
        ).padStart(2, "0")}${String(ts.getSeconds()).padStart(2, "0")}`;
        const safeOriginal = originalName?.replace(/[^a-z0-9._-]+/gi, "-").slice(0, 80);
        const baseName = safeOriginal
          ? `${stamp}-${safeOriginal}`
          : `${kind}-${stamp}-${msg.message_id}.${ext}`;
        let target = normalizePath(`${attachDir}/${baseName}`);
        let suffix = 0;
        while (this.app.vault.getAbstractFileByPath(target)) {
          suffix += 1;
          const dot = baseName.lastIndexOf(".");
          target =
            dot >= 0
              ? normalizePath(
                  `${attachDir}/${baseName.slice(0, dot)}-${suffix}${baseName.slice(dot)}`
                )
              : normalizePath(`${attachDir}/${baseName}-${suffix}`);
        }
        await this.app.vault.createBinary(target, bytes);
        return target;
      } catch (err) {
        console.error("Telegram media download failed", err);
        return null;
      }
    };

    if (msg.voice) {
      const path = await writeFile("voice", "ogg", msg.voice);
      if (path) out.push(path);
    }
    if (msg.audio) {
      const ext = guessExtFromMime(msg.audio.mime_type) ?? "mp3";
      const path = await writeFile("audio", ext, msg.audio, msg.audio.file_name);
      if (path) out.push(path);
    }
    if (msg.video) {
      const ext = guessExtFromMime(msg.video.mime_type) ?? "mp4";
      const path = await writeFile("video", ext, msg.video, msg.video.file_name);
      if (path) out.push(path);
    }
    if (msg.video_note) {
      const path = await writeFile("video-note", "mp4", msg.video_note);
      if (path) out.push(path);
    }
    if (msg.document) {
      const ext =
        guessExtFromName(msg.document.file_name) ??
        guessExtFromMime(msg.document.mime_type) ??
        "bin";
      const path = await writeFile("doc", ext, msg.document, msg.document.file_name);
      if (path) out.push(path);
    }
    if (msg.photo && msg.photo.length > 0) {
      // Telegram returns multiple sizes; take the largest.
      const largest = msg.photo[msg.photo.length - 1];
      const path = await writeFile("photo", "jpg", largest);
      if (path) out.push(path);
    }
    if (msg.sticker) {
      const path = await writeFile("sticker", "webp", msg.sticker);
      if (path) out.push(path);
    }

    return out;
  }

  private async getUpdates(offset?: number): Promise<TelegramUpdate[]> {
    const params: Record<string, unknown> = {
      timeout: 0,
      allowed_updates: ["message", "channel_post"],
    };
    if (offset != null) params.offset = offset;
    const data = await this.call("getUpdates", params);
    return (data?.result as TelegramUpdate[]) ?? [];
  }

  private async react(chatId: number, messageId: number): Promise<void> {
    try {
      await this.call("setMessageReaction", {
        chat_id: chatId,
        message_id: messageId,
        reaction: [{ type: "emoji", emoji: "\u{1F44D}" }],
      });
    } catch (err) {
      console.warn("Telegram reaction failed", err);
    }
  }

  private async downloadFile(fileId: string): Promise<ArrayBuffer | null> {
    const meta = await this.call("getFile", { file_id: fileId });
    const filePath = (meta?.result as { file_path?: string } | undefined)?.file_path;
    if (!filePath) return null;
    const url = `${FILE_BASE}${this.token}/${filePath}`;
    const resp = await requestUrl({ url, method: "GET" });
    return resp.arrayBuffer;
  }

  private async call(
    method: string,
    params: Record<string, unknown>
  ): Promise<{ ok?: boolean; result?: unknown }> {
    const url = `${API_BASE}${this.token}/${method}`;
    const resp = await requestUrl({
      url,
      method: "POST",
      contentType: "application/json",
      body: JSON.stringify(params),
      throw: false,
    });
    if (resp.status >= 400) {
      throw new Error(`Telegram ${method} ${resp.status}: ${resp.text}`);
    }
    return resp.json as { ok?: boolean; result?: unknown };
  }
}

interface ParsedRouting {
  kind: "task" | "log";
  projectMention?: string;
  tags: string[];
  cleanText: string;
}

function parseRouting(text: string): ParsedRouting {
  // First @\S+ is the routing mention; subsequent ones are kept as plain text.
  let projectMention: string | undefined;
  const tags: string[] = [];
  let kind: "task" | "log" = "log";

  const tagRegex = /(?:^|\s)#([\p{L}\p{N}_-]+)/gu;
  for (const m of text.matchAll(tagRegex)) {
    tags.push(m[1].toLowerCase());
  }

  const mentionMatch = text.match(/(?:^|\s)@([\p{L}\p{N}_-]+)/u);
  if (mentionMatch) projectMention = mentionMatch[1];

  // Routing markers shape kind, then are removed from tag list and body.
  const lower = tags.map((t) => t.toLowerCase());
  if (lower.includes("task")) kind = "task";
  else if (lower.includes("log")) kind = "log";
  const routingTags = new Set(["task", "log"]);
  const remainingTags = tags.filter((t) => !routingTags.has(t.toLowerCase()));

  // Strip the first @mention and the routing tags from the visible body.
  let clean = text;
  if (mentionMatch) {
    clean = clean.replace(mentionMatch[0], mentionMatch[0].startsWith(" ") ? " " : "");
  }
  clean = clean.replace(/(?:^|\s)#(?:task|log)\b/gi, (m) =>
    m.startsWith(" ") ? " " : ""
  );
  clean = clean.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();

  return { kind, projectMention, tags: Array.from(new Set(remainingTags)), cleanText: clean };
}

function firstLine(text: string): string {
  const idx = text.indexOf("\n");
  return (idx >= 0 ? text.slice(0, idx) : text).trim();
}

function restAfterFirstLine(text: string): string {
  const idx = text.indexOf("\n");
  return idx >= 0 ? text.slice(idx + 1).trim() : "";
}

function truncate(s: string, n: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length <= n ? t : t.slice(0, n - 1) + "\u2026";
}

function mediaLabel(msg: TelegramMessage): string {
  if (msg.voice) return "voice note";
  if (msg.audio) return msg.audio.file_name ?? "audio";
  if (msg.video) return msg.video.file_name ?? "video";
  if (msg.video_note) return "video note";
  if (msg.document) return msg.document.file_name ?? "document";
  if (msg.photo) return "photo";
  if (msg.sticker) return "sticker";
  return "message";
}

function formatLocalStamp(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(
    d.getHours()
  )}-${pad(d.getMinutes())}`;
}

function guessExtFromMime(mime: string | undefined): string | undefined {
  if (!mime) return undefined;
  const map: Record<string, string> = {
    "audio/ogg": "ogg",
    "audio/mpeg": "mp3",
    "audio/mp4": "m4a",
    "audio/wav": "wav",
    "video/mp4": "mp4",
    "video/quicktime": "mov",
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/gif": "gif",
    "image/webp": "webp",
    "application/pdf": "pdf",
  };
  return map[mime.toLowerCase()];
}

function guessExtFromName(name: string | undefined): string | undefined {
  if (!name) return undefined;
  const dot = name.lastIndexOf(".");
  if (dot < 0) return undefined;
  return name.slice(dot + 1).toLowerCase();
}
