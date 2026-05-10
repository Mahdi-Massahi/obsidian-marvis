import { App, normalizePath, TFile, TFolder } from "obsidian";
import { formatLogFilename } from "../../schema/frontmatter";

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function timeOfDay(d: Date): string {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function isoWithOffset(d: Date): string {
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? "+" : "-";
  const oh = pad(Math.floor(Math.abs(off) / 60));
  const om = pad(Math.abs(off) % 60);
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` +
    `${sign}${oh}:${om}`
  );
}

function quote(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => (line ? `> ${line}` : ">"))
    .join("\n");
}

interface SessionMetadata {
  model: string;
  voice: string;
}

// One conversation turn = a user input followed by zero or more assistant
// outputs (tool calls / tool results / spoken reply). Turns are separated by
// `---` in the transcript. The user line is blockquoted; the assistant lines
// are plain text. The timestamp is written once at the start of the turn.
type TurnSide = "none" | "user" | "assistant";

export class ChatTranscriptService {
  private file: TFile | null = null;
  private startedAt: Date | null = null;
  private buffer: string[] = [];
  private flushHandle: number | null = null;
  private writeChain: Promise<void> = Promise.resolve();
  private turnSide: TurnSide = "none";

  constructor(private app: App, private getRoot: () => string) {}

  isActive(): boolean {
    return this.file !== null;
  }

  currentFile(): TFile | null {
    return this.file;
  }

  async beginSession(meta: SessionMetadata): Promise<TFile> {
    this.startedAt = new Date();
    const folder = normalizePath(`${this.getRoot()}/_chats`);
    await this.ensureFolder(folder);
    const filename = `${formatLogFilename(this.startedAt)}.md`;
    const path = normalizePath(`${folder}/${filename}`);
    const fm = [
      "---",
      "kind: chat",
      `started: ${isoWithOffset(this.startedAt)}`,
      `model: ${meta.model}`,
      `voice: ${meta.voice}`,
      "---",
      "",
      "",
    ].join("\n");
    this.file = await this.app.vault.create(path, fm);
    this.turnSide = "none";
    return this.file;
  }

  appendUser(text: string, ts: Date): void {
    if (!this.file) return;
    const trimmed = text.trim();
    if (!trimmed) return;
    // Closing the previous turn when the user speaks again after the AI replied.
    if (this.turnSide === "assistant") this.closeTurn();
    if (this.turnSide === "none") this.openTurn(ts);
    this.buffer.push(quote(trimmed), "");
    this.turnSide = "user";
    this.scheduleFlush();
  }

  appendAssistant(text: string, ts: Date): void {
    if (!this.file) return;
    const trimmed = text.trim();
    if (!trimmed) return;
    if (this.turnSide === "none") this.openTurn(ts);
    this.buffer.push(trimmed, "");
    this.turnSide = "assistant";
    this.scheduleFlush();
  }

  appendToolCall(name: string, preview: string, ts: Date): void {
    if (!this.file) return;
    if (this.turnSide === "none") this.openTurn(ts);
    this.buffer.push(`_Proposed ${name}: ${preview}_`, "");
    this.turnSide = "assistant";
    this.scheduleFlush();
  }

  appendToolResult(name: string, summary: string, ts: Date): void {
    if (!this.file) return;
    if (this.turnSide === "none") this.openTurn(ts);
    this.buffer.push(`_${name}: ${summary}_`, "");
    this.turnSide = "assistant";
    this.scheduleFlush();
  }

  appendNote(text: string, ts: Date): void {
    if (!this.file) return;
    if (this.turnSide === "none") this.openTurn(ts);
    this.buffer.push(`_${text}_`, "");
    this.scheduleFlush();
  }

  async endSession(ts: Date): Promise<void> {
    if (!this.file) return;
    if (this.turnSide !== "none") this.closeTurn();
    await this.flushNow();
    const file = this.file;
    const ended = isoWithOffset(ts);
    try {
      const content = await this.app.vault.read(file);
      const updated = content.replace(/^---\r?\n([\s\S]*?)\r?\n---/, (_m, fm) => {
        const trimmed = String(fm).replace(/\nended:.*$/m, "");
        return `---\n${trimmed}\nended: ${ended}\n---`;
      });
      await this.app.vault.modify(file, updated);
    } catch {
      // ignore — file may have been deleted by the user
    }
    this.file = null;
    this.startedAt = null;
    this.buffer = [];
    this.turnSide = "none";
  }

  private openTurn(ts: Date): void {
    this.buffer.push(`*${timeOfDay(ts)}*`, "");
  }

  private closeTurn(): void {
    this.buffer.push("---", "");
    this.turnSide = "none";
  }

  private scheduleFlush(): void {
    if (this.flushHandle != null) return;
    this.flushHandle = window.setTimeout(() => {
      this.flushHandle = null;
      void this.flushNow();
    }, 250);
  }

  private async flushNow(): Promise<void> {
    if (this.flushHandle != null) {
      window.clearTimeout(this.flushHandle);
      this.flushHandle = null;
    }
    if (!this.file) return;
    if (this.buffer.length === 0) return;
    const chunk = this.buffer.join("\n");
    this.buffer = [];
    const file = this.file;
    this.writeChain = this.writeChain
      .catch(() => undefined)
      .then(async () => {
        try {
          await this.app.vault.append(file, chunk + "\n");
        } catch {
          // Drop on the floor — Obsidian may have removed the file mid-session.
        }
      });
    await this.writeChain;
  }

  private async ensureFolder(path: string): Promise<void> {
    const existing = this.app.vault.getAbstractFileByPath(path);
    if (existing instanceof TFolder) return;
    if (existing) return;
    await this.app.vault.createFolder(path);
  }
}
