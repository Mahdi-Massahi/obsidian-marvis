import { Notice } from "obsidian";
import type KanbanPlusPlugin from "../../main";
import { AudioBridge } from "./audioBridge";
import { ChatTranscriptService } from "./chatTranscriptService";
import {
  GeminiLiveClient,
  FunctionCall as ClientFunctionCall,
} from "./geminiLiveClient";
import {
  buildFunctionDeclarations,
  dispatch,
  FunctionResponseItem,
} from "./toolRegistry";

export type SessionState =
  | "idle"
  | "connecting"
  | "listening"
  | "thinking"
  | "speaking"
  | "awaiting-confirmation"
  | "reconnecting"
  | "error";

export type MessageKind = "user" | "assistant" | "tool-call" | "tool-result" | "note";

export interface SessionMessage {
  kind: MessageKind;
  text: string;
  ts: number;
  id?: string;
}

export interface SessionMetrics {
  elapsedMs: number;
  reconnects: number;
  state: SessionState;
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function formatNowReadable(d: Date = new Date()): string {
  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  return (
    `${days[d.getDay()]}, ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}

function formatDateTimeStamp(d: Date = new Date()): string {
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  );
}

function buildSystemInstruction(opts: { userName?: string; override?: string }): string {
  const now = new Date();
  const todayISO = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const tomorrowISO = `${tomorrow.getFullYear()}-${pad(tomorrow.getMonth() + 1)}-${pad(tomorrow.getDate())}`;
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const name = opts.userName?.trim();

  const base = `You are Marvis, ${name ? `${name}'s` : "the user's"} voice-driven planning assistant inside Obsidian.

CURRENT CONTEXT (this session started at this moment — use it as your reference for "now"):
- Date & time: ${formatNowReadable(now)} (${tz})
- Today: ${todayISO}
- Tomorrow: ${tomorrowISO}
${name ? `- User's name: ${name}` : ""}

You have read and write access to ${name ? `${name}'s` : "the user's"} projects, tasks, milestones, events, and logs through tools. You should:
- Address ${name ? name + " by name occasionally — naturally, not in every turn" : "the user warmly without overusing 'user'"}. Sound concise, friendly, and warm. Speak in short turns, summarize lists rather than reading every item.
- At the start of any open-ended planning conversation ("what's on my plate?", "good morning", "what should I focus on?"), proactively call get_planning_snapshot and use list_tasks (filtered by due=today and due=tomorrow) to give a personalized overview. Mention overdue items if any, then today, then tomorrow if relevant.
- Resolve relative dates ("today", "tomorrow", "Friday", "next week") against today's date above. Today is ${todayISO}, tomorrow is ${tomorrowISO}. Do not invent dates.
- The user's text messages may arrive prefixed with [YYYY-MM-DD HH:mm:ss] indicating exactly when they were sent. Treat that timestamp as authoritative for "now" within the conversation if it differs from the session-start time above.
- Before making any change to the vault (creating tasks/milestones/projects/logs/events, updating tasks, archiving items), briefly state intent in one sentence, then call the tool. The user sees a confirmation modal — never assume approval. If a tool returns declined: true, accept it without arguing and offer alternatives.
- After a write tool resolves with ok: true, acknowledge in ONE short sentence ("Done.", "Created.", "Logged.", "Updated."). Optionally include just the title or a single anchor (date/project) — never the full field list. The user already saw every field in the approval modal, so do not read back priority, due date, tags, status, project, etc. unless they explicitly ask "what did you set?". Same rule for batches: one acknowledgement covers the batch.
- Never invent project names, task titles, paths, or item ids. Only reference items returned by tools. If unsure, call list_* or search_vault first.
- Use ISO YYYY-MM-DD for dates in tool arguments.
- When creating a task or log without an explicit project, default to "Inbox".
- When creating tasks, logs, or events, always populate the body field with the substantive content the user gave you — notes, context, acceptance criteria, what happened, agenda, links, attendees. The title is a one-line label; the body is where the actual information lives. For logs especially, the body is the main payload — never create a log with only a title. Only leave body empty if the user genuinely gave nothing beyond a title.
- When calling create_task, classify the task and include exactly one of \`bug\`, \`feature\`, \`improvement\`, or \`idea\` in \`tags\`: \`bug\` for something broken or wrong ("X is failing", "fix Y", "Z doesn't work"), \`feature\` for a concrete new capability to build ("add", "support", "implement"), \`improvement\` for refining/polishing something that already exists ("make X faster", "tweak Y", "clean up Z", "better wording for…"), \`idea\` for an exploratory or half-formed thought ("maybe we could…", "what if…", brainstorm-style). When unsure between feature and idea, prefer \`idea\`; when unsure between feature and improvement, ask whether the thing already exists — if yes, \`improvement\`. Preserve any additional tags the user mentioned alongside the classification tag.
- Keep spoken replies under ~3 sentences unless asked for more detail. For long lists, summarize as counts ("you have five tasks due today — want me to read them?") and read on request.`;

  if (opts.override && opts.override.trim()) {
    return `${base}\n\nADDITIONAL INSTRUCTIONS FROM USER:\n${opts.override.trim()}`;
  }
  return base;
}

const SESSION_DURATION_MS = 15 * 60 * 1000;

export interface SessionOptions {
  onState?: (state: SessionState) => void;
  onMessage?: (message: SessionMessage) => void;
  onTick?: (elapsedMs: number) => void;
}

export class AssistantSession {
  private plugin: KanbanPlusPlugin;
  private transcript: ChatTranscriptService;
  private audio = new AudioBridge();
  private client: GeminiLiveClient | null = null;
  private state: SessionState = "idle";
  private startedAt: number | null = null;
  private resumeHandle: string | null = null;
  private reconnects = 0;
  private tickHandle: number | null = null;
  private opts: SessionOptions = {};
  private pendingTools = new Map<string, ClientFunctionCall>();
  private toolQueue: Promise<void> = Promise.resolve();
  private inputBuffer = "";
  private outputBuffer = "";
  private lastSpokenAt = 0;
  private wakeLock: { release: () => Promise<void> } | null = null;
  private wakeLockReacquireRef: ((this: Document, ev: Event) => void) | null = null;

  constructor(plugin: KanbanPlusPlugin, transcript: ChatTranscriptService) {
    this.plugin = plugin;
    this.transcript = transcript;
  }

  configure(opts: SessionOptions): void {
    this.opts = opts;
  }

  getState(): SessionState {
    return this.state;
  }

  getMetrics(): SessionMetrics {
    return {
      elapsedMs: this.startedAt ? Date.now() - this.startedAt : 0,
      reconnects: this.reconnects,
      state: this.state,
    };
  }

  isActive(): boolean {
    return this.state !== "idle" && this.state !== "error";
  }

  async start(): Promise<void> {
    if (this.isActive()) return;
    const settings = this.plugin.settings.assistant;
    if (!settings.enabled) {
      new Notice("Assistant is disabled in settings.");
      return;
    }
    if (!settings.apiKey?.trim()) {
      new Notice("Set a Gemini API key in Marvis settings first.");
      return;
    }
    this.setState("connecting");
    try {
      if (settings.persistTranscripts) {
        await this.transcript.beginSession({
          model: settings.model,
          voice: settings.voice,
        });
      }
      await this.audio.ensurePlayback();
      await this.connectClient();
      await this.audio.startMic((buf) => this.client?.sendAudioChunk(buf));
      this.startedAt = Date.now();
      this.startTick();
      void this.acquireWakeLock();
      this.setState("listening");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      new Notice(`Assistant failed to start: ${msg}`);
      await this.stop(true);
    }
  }

  async stop(silent = false): Promise<void> {
    this.stopTick();
    this.audio.stopMic();
    this.client?.close();
    this.client = null;
    this.audio.flushPlayback();
    void this.releaseWakeLock();
    if (this.transcript.isActive()) {
      await this.transcript.endSession(new Date());
    }
    this.startedAt = null;
    this.pendingTools.clear();
    this.toolQueue = Promise.resolve();
    this.inputBuffer = "";
    this.outputBuffer = "";
    if (!silent) this.setState("idle");
    else this.state = "idle";
  }

  cancel(): void {
    this.audio.flushPlayback();
    if (this.state === "speaking") this.setState("listening");
  }

  sendText(text: string): void {
    if (!this.client) return;
    const ts = new Date();
    // Prepend [YYYY-MM-DD HH:mm:ss] so the model has an authoritative "now"
    // for relative dates ("tomorrow", "in two hours") even when the session
    // setup was sent earlier.
    const stampPattern = /^\s*\[\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d{2})?\]/;
    const stamped = stampPattern.test(text)
      ? text
      : `[${formatDateTimeStamp(ts)}] ${text}`;
    // Display the user's raw text in the panel/transcript; only the model sees the stamp.
    this.transcript.appendUser(text, ts);
    this.emitMessage({ kind: "user", text, ts: ts.getTime() });
    this.client.sendUserText(stamped);
    this.setState("thinking");
  }

  private async connectClient(): Promise<void> {
    const settings = this.plugin.settings.assistant;
    const tools = buildFunctionDeclarations();
    const client = new GeminiLiveClient({
      apiKey: settings.apiKey.trim(),
      model: settings.model,
      voice: settings.voice,
      systemInstruction: buildSystemInstruction({
        userName: settings.userName,
        override: settings.systemInstructionOverride,
      }),
      tools,
      resumeHandle: this.resumeHandle ?? undefined,
    });
    this.wireClient(client);
    await client.connect();
    this.client = client;
  }

  private wireClient(client: GeminiLiveClient): void {
    client.on("audio", (bytes) => {
      this.audio.enqueuePlayback(bytes);
      this.lastSpokenAt = Date.now();
      // First model audio after a user turn implies the user finished speaking,
      // so commit any pending input transcript before flipping to speaking.
      if (this.inputBuffer.trim()) this.flushInputBuffer();
      if (this.state === "thinking" || this.state === "listening") {
        this.setState("speaking");
      }
    });
    client.on("inputTranscript", ({ text, isFinal }) => {
      if (!text) return;
      // Gemini Live sends transcript deltas — accumulate, don't replace.
      this.inputBuffer += text;
      if (isFinal) {
        this.flushInputBuffer();
        this.setState("thinking");
      }
    });
    client.on("outputTranscript", ({ text, isFinal }) => {
      if (!text) return;
      this.outputBuffer += text;
      if (isFinal) this.flushOutputBuffer();
    });
    client.on("toolCall", (calls) => {
      // Serialize batches: if Gemini emits a second toolCall while the first
      // batch's confirmation modal is still open, the second handler must wait
      // — otherwise modals stack and an already-resolved approval can reappear
      // behind a newer one.
      this.toolQueue = this.toolQueue.then(() => this.handleToolCalls(calls));
      this.toolQueue.catch((err) => {
        console.error("handleToolCalls failed", err);
      });
    });
    client.on("toolCallCancelled", (ids) => {
      for (const id of ids) this.pendingTools.delete(id);
    });
    client.on("turnComplete", () => {
      // Belt-and-braces: if Gemini didn't send a final flag on either side,
      // commit whatever is in the buffer at end-of-turn.
      if (this.inputBuffer.trim()) this.flushInputBuffer();
      if (this.outputBuffer.trim()) this.flushOutputBuffer();
      if (this.pendingTools.size === 0) this.setState("listening");
    });
    client.on("interrupted", () => {
      this.audio.flushPlayback();
      // Barge-in: keep what the model already said (commit), drop only mid-flight audio.
      if (this.outputBuffer.trim()) this.flushOutputBuffer();
      this.setState("listening");
    });
    client.on("sessionResumption", ({ handle }) => {
      this.resumeHandle = handle;
    });
    client.on("goAway", () => {
      void this.reconnect();
    });
    client.on("close", ({ code }) => {
      if (this.state !== "idle" && code !== 1000) void this.reconnect();
    });
    client.on("error", ({ message }) => {
      new Notice(`Assistant error: ${message}`);
    });
  }

  private async handleToolCalls(calls: ClientFunctionCall[]): Promise<void> {
    // Drop any call whose id is already in flight. Gemini Live can resend the
    // same toolCall (e.g. after a session-resumption hiccup before our
    // sendToolResponses lands), and we don't want to re-prompt the user for
    // an approval they've already given.
    const fresh = calls.filter((c) => !c.id || !this.pendingTools.has(c.id));
    if (fresh.length === 0) return;

    // Commit any pre-amble the model said (or user input we haven't finalized)
    // before we record tool-call entries — otherwise the transcript shows the
    // tool line above the spoken text that introduced it.
    if (this.inputBuffer.trim()) this.flushInputBuffer();
    if (this.outputBuffer.trim()) this.flushOutputBuffer();

    const wasState = this.state;
    if (fresh.some((c) => isWriteTool(c.name))) this.setState("awaiting-confirmation");

    const responses: FunctionResponseItem[] = [];
    for (const call of fresh) {
      if (call.id) this.pendingTools.set(call.id, call);
      const response = await dispatch(
        call,
        { app: this.plugin.app, plugin: this.plugin },
        {
          onPropose: (c, preview) => {
            const ts = new Date();
            this.transcript.appendToolCall(c.name, preview, ts);
            this.emitMessage({
              kind: "tool-call",
              text: `${c.name}: ${preview}`,
              ts: ts.getTime(),
              id: c.id,
            });
          },
          onResolve: (c, summary, ok) => {
            const ts = new Date();
            this.transcript.appendToolResult(c.name, summary, ts);
            this.emitMessage({
              kind: "tool-result",
              text: `${ok ? "✓" : "✗"} ${c.name}: ${summary}`,
              ts: ts.getTime(),
              id: c.id,
            });
          },
        }
      );
      if (call.id && this.pendingTools.has(call.id)) {
        responses.push(response);
        this.pendingTools.delete(call.id);
      } else {
        // Cancelled mid-flight by server — drop.
      }
    }

    if (responses.length > 0) this.client?.sendToolResponses(responses);
    if (this.pendingTools.size === 0) {
      this.setState(wasState === "speaking" ? "speaking" : "thinking");
    }
  }

  private async reconnect(): Promise<void> {
    if (!this.startedAt) return;
    this.setState("reconnecting");
    this.audio.flushPlayback();
    this.client?.close();
    this.client = null;
    let attempt = 0;
    const maxAttempts = 4;
    while (attempt < maxAttempts) {
      const delay = 500 * Math.pow(2, attempt);
      await new Promise((r) => setTimeout(r, delay));
      try {
        await this.connectClient();
        this.reconnects += 1;
        this.setState("listening");
        return;
      } catch (err) {
        attempt += 1;
        this.plugin.app.workspace.trigger("kp-assistant:reconnect-error", err);
      }
    }
    new Notice("Assistant reconnect failed.");
    this.setState("error");
  }

  private startTick(): void {
    this.stopTick();
    this.tickHandle = window.setInterval(() => {
      const elapsed = this.startedAt ? Date.now() - this.startedAt : 0;
      this.opts.onTick?.(elapsed);
      if (elapsed >= SESSION_DURATION_MS - 30 * 1000 && this.state !== "reconnecting") {
        // Pre-emptive reconnect 30s before the hard 15-min cap.
        void this.reconnect();
      }
    }, 1000);
  }

  private stopTick(): void {
    if (this.tickHandle != null) {
      window.clearInterval(this.tickHandle);
      this.tickHandle = null;
    }
  }

  private setState(state: SessionState): void {
    if (this.state === state) return;
    this.state = state;
    this.opts.onState?.(state);
  }

  private flushInputBuffer(): void {
    const text = this.inputBuffer.trim();
    this.inputBuffer = "";
    if (!text) return;
    const ts = new Date();
    this.transcript.appendUser(text, ts);
    this.emitMessage({ kind: "user", text, ts: ts.getTime() });
  }

  private flushOutputBuffer(): void {
    const text = this.outputBuffer.trim();
    this.outputBuffer = "";
    if (!text) return;
    const ts = new Date();
    this.transcript.appendAssistant(text, ts);
    this.emitMessage({ kind: "assistant", text, ts: ts.getTime() });
  }

  private async acquireWakeLock(): Promise<void> {
    const wl = (navigator as unknown as {
      wakeLock?: { request: (type: string) => Promise<{ release: () => Promise<void> }> };
    }).wakeLock;
    if (!wl) return;
    try {
      this.wakeLock = await wl.request("screen");
    } catch {
      // Permission denied or unsupported — silently degrade.
      return;
    }
    // The OS releases wake locks when the document loses visibility; reacquire
    // when it returns so a session that backgrounds briefly stays alive.
    const handler = () => {
      if (document.visibilityState === "visible" && this.startedAt && !this.wakeLock) {
        void this.acquireWakeLock();
      }
    };
    this.wakeLockReacquireRef = handler;
    document.addEventListener("visibilitychange", handler);
  }

  private async releaseWakeLock(): Promise<void> {
    if (this.wakeLockReacquireRef) {
      document.removeEventListener("visibilitychange", this.wakeLockReacquireRef);
      this.wakeLockReacquireRef = null;
    }
    const lock = this.wakeLock;
    this.wakeLock = null;
    try {
      await lock?.release();
    } catch {
      // ignore
    }
  }

  private emitMessage(msg: SessionMessage): void {
    this.opts.onMessage?.(msg);
  }
}

const WRITE_TOOL_NAMES = new Set([
  "create_task",
  "update_task",
  "create_milestone",
  "create_project",
  "create_log",
  "create_event",
  "archive_item",
]);

function isWriteTool(name: string): boolean {
  return WRITE_TOOL_NAMES.has(name);
}

export async function testGeminiConnection(opts: {
  apiKey: string;
  model: string;
  voice: string;
}): Promise<void> {
  const client = new GeminiLiveClient({
    apiKey: opts.apiKey.trim(),
    model: opts.model,
    voice: opts.voice,
    tools: [],
  });
  await client.connect();
  await new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      reject(new Error("Timed out waiting for setupComplete"));
    }, 8000);
    const off = client.on("setupComplete", () => {
      window.clearTimeout(timer);
      off();
      resolve();
    });
    client.on("error", ({ message }) => {
      window.clearTimeout(timer);
      reject(new Error(message));
    });
    client.on("close", ({ code, reason }) => {
      if (code !== 1000) {
        window.clearTimeout(timer);
        reject(new Error(`closed (${code}): ${reason || "no reason"}`));
      }
    });
  });
  client.close();
}
