// Gemini Live (Bidi) WebSocket transport.
//
// Handles only the wire protocol: setup, audio/text turns, tool calls/responses,
// session resumption, and lifecycle events. No audio capture or UI here.
//
// Docs:
//   https://ai.google.dev/api/live
//   https://ai.google.dev/gemini-api/docs/live-api/get-started-websocket
//   https://ai.google.dev/gemini-api/docs/live-api/capabilities

const WS_BASE =
  "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent";

export interface FunctionDeclaration {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ToolResponseItem {
  id?: string;
  name: string;
  response: Record<string, unknown>;
}

export interface FunctionCall {
  id?: string;
  name: string;
  args: Record<string, unknown>;
}

export interface ClientOptions {
  apiKey: string;
  model: string;
  voice: string;
  systemInstruction?: string;
  tools: FunctionDeclaration[];
  resumeHandle?: string;
  onLog?: (line: string) => void;
}

type Listener<T> = (payload: T) => void;

interface EventMap {
  open: void;
  setupComplete: void;
  audio: Uint8Array;
  inputTranscript: { text: string; isFinal: boolean };
  outputTranscript: { text: string; isFinal: boolean };
  toolCall: FunctionCall[];
  toolCallCancelled: string[];
  turnComplete: void;
  interrupted: void;
  goAway: { timeLeftMs: number };
  sessionResumption: { handle: string };
  error: { message: string };
  close: { code: number; reason: string };
}

function base64Encode(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + 0x8000)));
  }
  return btoa(binary);
}

function base64Decode(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

export class GeminiLiveClient {
  private ws: WebSocket | null = null;
  private opts: ClientOptions;
  private listeners: { [K in keyof EventMap]?: Set<Listener<EventMap[K]>> } = {};
  private setupSent = false;
  private setupCompleteResolved = false;

  constructor(opts: ClientOptions) {
    this.opts = opts;
  }

  on<K extends keyof EventMap>(name: K, listener: Listener<EventMap[K]>): () => void {
    let set = this.listeners[name] as Set<Listener<EventMap[K]>> | undefined;
    if (!set) {
      set = new Set();
      this.listeners[name] = set as never;
    }
    set.add(listener);
    return () => set!.delete(listener);
  }

  private emit<K extends keyof EventMap>(name: K, payload: EventMap[K]): void {
    const set = this.listeners[name] as Set<Listener<EventMap[K]>> | undefined;
    if (!set) return;
    for (const fn of Array.from(set)) {
      try {
        fn(payload);
      } catch (err) {
        this.opts.onLog?.(`listener error in ${name}: ${String(err)}`);
      }
    }
  }

  isOpen(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const url = `${WS_BASE}?key=${encodeURIComponent(this.opts.apiKey)}`;
      let ws: WebSocket;
      try {
        ws = new WebSocket(url);
      } catch (err) {
        reject(err);
        return;
      }
      ws.binaryType = "arraybuffer";
      this.ws = ws;
      ws.onopen = () => {
        this.emit("open", undefined);
        try {
          this.sendSetup();
        } catch (err) {
          reject(err);
          return;
        }
        resolve();
      };
      ws.onerror = (ev) => {
        this.emit("error", { message: `WebSocket error: ${(ev as Event).type}` });
      };
      ws.onclose = (ev) => {
        this.emit("close", { code: ev.code, reason: ev.reason });
      };
      ws.onmessage = (ev) => this.handleMessage(ev.data);
    });
  }

  private sendSetup(): void {
    if (this.setupSent) return;
    const setup: Record<string, unknown> = {
      model: this.opts.model.startsWith("models/")
        ? this.opts.model
        : `models/${this.opts.model}`,
      generationConfig: {
        responseModalities: ["AUDIO"],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: this.opts.voice },
          },
        },
      },
      inputAudioTranscription: {},
      outputAudioTranscription: {},
      sessionResumption: this.opts.resumeHandle
        ? { handle: this.opts.resumeHandle }
        : {},
    };
    if (this.opts.systemInstruction) {
      setup.systemInstruction = {
        parts: [{ text: this.opts.systemInstruction }],
      };
    }
    if (this.opts.tools && this.opts.tools.length > 0) {
      setup.tools = [{ functionDeclarations: this.opts.tools }];
    }
    this.send({ setup });
    this.setupSent = true;
  }

  sendAudioChunk(buf: ArrayBuffer): void {
    if (!this.isOpen()) return;
    this.send({
      realtimeInput: {
        audio: {
          mimeType: "audio/pcm;rate=16000",
          data: base64Encode(buf),
        },
      },
    });
  }

  sendUserText(text: string): void {
    if (!this.isOpen()) return;
    this.send({
      clientContent: {
        turns: [{ role: "user", parts: [{ text }] }],
        turnComplete: true,
      },
    });
  }

  sendToolResponses(items: ToolResponseItem[]): void {
    if (!this.isOpen()) return;
    this.send({
      toolResponse: {
        functionResponses: items.map((it) => ({
          id: it.id,
          name: it.name,
          response: it.response,
        })),
      },
    });
  }

  close(): void {
    try {
      this.ws?.close(1000, "client closed");
    } catch {
      // ignore
    }
    this.ws = null;
  }

  private send(payload: unknown): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify(payload));
  }

  private async handleMessage(raw: unknown): Promise<void> {
    let text: string;
    if (raw instanceof ArrayBuffer) text = new TextDecoder().decode(raw);
    else if (raw instanceof Blob) text = await raw.text();
    else text = String(raw);
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(text) as Record<string, unknown>;
    } catch (err) {
      this.opts.onLog?.(`unparsable frame: ${String(err)}`);
      return;
    }
    if (msg.setupComplete) {
      this.setupCompleteResolved = true;
      this.emit("setupComplete", undefined);
      return;
    }
    if (msg.serverContent) {
      this.handleServerContent(msg.serverContent as Record<string, unknown>);
      return;
    }
    if (msg.toolCall) {
      const tc = msg.toolCall as { functionCalls?: FunctionCall[] };
      if (tc.functionCalls && tc.functionCalls.length > 0) {
        this.emit("toolCall", tc.functionCalls);
      }
      return;
    }
    if (msg.toolCallCancellation) {
      const ids = (msg.toolCallCancellation as { ids?: string[] }).ids ?? [];
      this.emit("toolCallCancelled", ids);
      return;
    }
    if (msg.goAway) {
      const ms = parseGoAwayDuration((msg.goAway as { timeLeft?: string }).timeLeft);
      this.emit("goAway", { timeLeftMs: ms });
      return;
    }
    if (msg.sessionResumptionUpdate) {
      const upd = msg.sessionResumptionUpdate as { newHandle?: string; resumable?: boolean };
      if (upd.newHandle && upd.resumable !== false) {
        this.emit("sessionResumption", { handle: upd.newHandle });
      }
      return;
    }
  }

  private handleServerContent(content: Record<string, unknown>): void {
    const interrupted = content.interrupted === true;
    if (interrupted) this.emit("interrupted", undefined);

    const inputT = content.inputTranscription as
      | { text?: string; finished?: boolean }
      | undefined;
    if (inputT && typeof inputT.text === "string") {
      this.emit("inputTranscript", {
        text: inputT.text,
        isFinal: inputT.finished === true,
      });
    }
    const outputT = content.outputTranscription as
      | { text?: string; finished?: boolean }
      | undefined;
    if (outputT && typeof outputT.text === "string") {
      this.emit("outputTranscript", {
        text: outputT.text,
        isFinal: outputT.finished === true,
      });
    }

    const modelTurn = content.modelTurn as
      | { parts?: Array<{ inlineData?: { mimeType?: string; data?: string }; text?: string }> }
      | undefined;
    if (modelTurn?.parts) {
      for (const part of modelTurn.parts) {
        const inline = part.inlineData;
        if (inline?.data && inline.mimeType?.startsWith("audio/")) {
          const bytes = base64Decode(inline.data);
          this.emit("audio", bytes);
        }
      }
    }

    if (content.turnComplete === true) {
      this.emit("turnComplete", undefined);
    }
  }
}

function parseGoAwayDuration(s: string | undefined): number {
  // Format like "12.5s" or "120s".
  if (!s) return 0;
  const m = s.match(/^(\d+(?:\.\d+)?)s$/);
  if (!m) return 0;
  return Math.floor(parseFloat(m[1]) * 1000);
}
