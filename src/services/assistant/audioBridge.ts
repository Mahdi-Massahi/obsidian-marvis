// Mic capture + speaker playback for the Gemini Live assistant.
//
// Capture pipeline (16 kHz PCM16 mono):
//   getUserMedia → MediaStreamSource → AudioWorklet → Int16 frames → onChunk
//
// Playback pipeline (24 kHz PCM16 mono):
//   raw chunks (Uint8Array LE) → AudioWorklet ring buffer → output device
//
// Worklet code is kept in this file as inline strings so the bundler doesn't
// have to ship a separate asset. Loaded via Blob URL at runtime.

const CAPTURE_WORKLET_SOURCE = `
class CaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._buf = [];
    this._target = 480; // 30 ms at 16 kHz
  }
  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0) return true;
    const ch = input[0];
    if (!ch) return true;
    for (let i = 0; i < ch.length; i++) this._buf.push(ch[i]);
    while (this._buf.length >= this._target) {
      const chunk = this._buf.splice(0, this._target);
      const i16 = new Int16Array(chunk.length);
      for (let i = 0; i < chunk.length; i++) {
        let s = chunk[i];
        if (s > 1) s = 1;
        else if (s < -1) s = -1;
        i16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
      }
      this.port.postMessage(i16.buffer, [i16.buffer]);
    }
    return true;
  }
}
registerProcessor("kp-capture", CaptureProcessor);
`;

const PLAYBACK_WORKLET_SOURCE = `
class PlaybackProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._queue = [];     // array of Float32Arrays
    this._head = 0;       // sample offset within first chunk
    this.port.onmessage = (e) => {
      const d = e.data;
      if (!d) return;
      if (d.type === "flush") {
        this._queue = [];
        this._head = 0;
        return;
      }
      if (d.type === "chunk" && d.data instanceof Float32Array) {
        this._queue.push(d.data);
      }
    };
  }
  process(_inputs, outputs) {
    const out = outputs[0];
    if (!out || out.length === 0) return true;
    const ch = out[0];
    let i = 0;
    while (i < ch.length) {
      if (this._queue.length === 0) {
        for (; i < ch.length; i++) ch[i] = 0;
        break;
      }
      const cur = this._queue[0];
      const remain = cur.length - this._head;
      const need = ch.length - i;
      const take = Math.min(remain, need);
      for (let k = 0; k < take; k++) ch[i + k] = cur[this._head + k];
      this._head += take;
      i += take;
      if (this._head >= cur.length) {
        this._queue.shift();
        this._head = 0;
      }
    }
    return true;
  }
}
registerProcessor("kp-playback", PlaybackProcessor);
`;

function workletUrl(source: string): string {
  const blob = new Blob([source], { type: "application/javascript" });
  return URL.createObjectURL(blob);
}

function pcm16BytesToFloat32(bytes: Uint8Array): Float32Array {
  // Treat as little-endian Int16 → Float32 [-1,1].
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const samples = Math.floor(bytes.byteLength / 2);
  const out = new Float32Array(samples);
  for (let i = 0; i < samples; i++) {
    const v = view.getInt16(i * 2, true);
    out[i] = v < 0 ? v / 0x8000 : v / 0x7fff;
  }
  return out;
}

export class AudioBridge {
  private captureCtx: AudioContext | null = null;
  private captureStream: MediaStream | null = null;
  private captureSource: MediaStreamAudioSourceNode | null = null;
  private captureNode: AudioWorkletNode | null = null;

  private playbackCtx: AudioContext | null = null;
  private playbackNode: AudioWorkletNode | null = null;

  private captureUrl: string | null = null;
  private playbackUrl: string | null = null;

  isMicActive(): boolean {
    return this.captureNode !== null;
  }

  async startMic(onChunk: (pcm16: ArrayBuffer) => void): Promise<void> {
    if (this.captureNode) return;
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      video: false,
    });
    const ctx = new AudioContext({ sampleRate: 16000 });
    if (ctx.state === "suspended") await ctx.resume();
    if (!this.captureUrl) this.captureUrl = workletUrl(CAPTURE_WORKLET_SOURCE);
    await ctx.audioWorklet.addModule(this.captureUrl);
    const node = new AudioWorkletNode(ctx, "kp-capture");
    const src = ctx.createMediaStreamSource(stream);
    src.connect(node);
    // node intentionally not connected to ctx.destination (we don't echo mic to speaker)
    node.port.onmessage = (e) => {
      const buf = e.data as ArrayBuffer;
      onChunk(buf);
    };
    this.captureCtx = ctx;
    this.captureStream = stream;
    this.captureSource = src;
    this.captureNode = node;
  }

  stopMic(): void {
    this.captureNode?.disconnect();
    this.captureSource?.disconnect();
    this.captureStream?.getTracks().forEach((t) => t.stop());
    this.captureNode = null;
    this.captureSource = null;
    this.captureStream = null;
    if (this.captureCtx) {
      void this.captureCtx.close();
      this.captureCtx = null;
    }
  }

  async ensurePlayback(): Promise<void> {
    if (this.playbackNode) return;
    const ctx = new AudioContext({ sampleRate: 24000 });
    if (ctx.state === "suspended") await ctx.resume();
    if (!this.playbackUrl) this.playbackUrl = workletUrl(PLAYBACK_WORKLET_SOURCE);
    await ctx.audioWorklet.addModule(this.playbackUrl);
    const node = new AudioWorkletNode(ctx, "kp-playback");
    node.connect(ctx.destination);
    this.playbackCtx = ctx;
    this.playbackNode = node;
  }

  enqueuePlayback(pcm16: Uint8Array): void {
    if (!this.playbackNode) return;
    const f32 = pcm16BytesToFloat32(pcm16);
    this.playbackNode.port.postMessage({ type: "chunk", data: f32 }, [f32.buffer]);
  }

  flushPlayback(): void {
    this.playbackNode?.port.postMessage({ type: "flush" });
  }

  destroy(): void {
    this.stopMic();
    this.playbackNode?.disconnect();
    this.playbackNode = null;
    if (this.playbackCtx) {
      void this.playbackCtx.close();
      this.playbackCtx = null;
    }
    if (this.captureUrl) {
      URL.revokeObjectURL(this.captureUrl);
      this.captureUrl = null;
    }
    if (this.playbackUrl) {
      URL.revokeObjectURL(this.playbackUrl);
      this.playbackUrl = null;
    }
  }
}
