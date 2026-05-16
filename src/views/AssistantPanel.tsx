import * as React from "react";
import { TFile, Notice } from "obsidian";
import { usePlugin } from "./context";
import { Icon } from "./shared/Icon";
import type {
  AssistantSession,
  SessionMessage,
  SessionState,
} from "../services/assistant/assistantSession";

interface Props {
  onClose: () => void;
  session: AssistantSession;
}

interface PendingImage {
  name: string;
  mimeType: string;
  base64: string;
  dataUrl: string;
}

const SUPPORTED_IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/heic",
  "image/heif",
]);
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

async function fileToPendingImage(file: File): Promise<PendingImage | null> {
  if (!SUPPORTED_IMAGE_TYPES.has(file.type)) return null;
  if (file.size > MAX_IMAGE_BYTES) return null;
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + 0x8000)));
  }
  const base64 = btoa(binary);
  return {
    name: file.name,
    mimeType: file.type,
    base64,
    dataUrl: `data:${file.type};base64,${base64}`,
  };
}

const STATE_LABEL: Record<SessionState, string> = {
  idle: "Idle",
  connecting: "Connecting…",
  listening: "Listening",
  thinking: "Thinking",
  speaking: "Speaking",
  "awaiting-confirmation": "Awaiting confirmation",
  reconnecting: "Reconnecting…",
  error: "Error",
};

function statePillLabel(state: SessionState, micActive: boolean): string {
  if (state === "listening" && !micActive) return "Ready";
  return STATE_LABEL[state];
}

function voicePrompt(state: SessionState, micActive: boolean): string {
  if (!micActive) {
    if (state === "idle") return "Type below or tap mic for voice";
    if (state === "error") return "Tap to retry";
    if (state === "connecting") return "Connecting…";
    if (state === "reconnecting") return "Reconnecting…";
    if (state === "listening") return "Type below or tap mic for voice";
    if (state === "thinking") return "Thinking…";
    if (state === "speaking") return "Speaking…";
    if (state === "awaiting-confirmation") return "Awaiting confirmation…";
    return "";
  }
  switch (state) {
    case "idle":
      return "Tap to talk";
    case "connecting":
      return "Connecting…";
    case "listening":
      return "Listening — tap to mute";
    case "thinking":
      return "Thinking…";
    case "speaking":
      return "Speaking…";
    case "awaiting-confirmation":
      return "Awaiting confirmation…";
    case "reconnecting":
      return "Reconnecting…";
    case "error":
      return "Tap to retry";
  }
}

const SESSION_DURATION_MS = 15 * 60 * 1000;

function fmtClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export const AssistantPanel: React.FC<Props> = ({ onClose, session }) => {
  const { app, settings } = usePlugin();
  const [state, setState] = React.useState<SessionState>(session.getState());
  const [micActive, setMicActive] = React.useState<boolean>(session.isMicActive());
  const [messages, setMessages] = React.useState<SessionMessage[]>([]);
  const [elapsed, setElapsed] = React.useState(0);
  const [textInput, setTextInput] = React.useState("");
  const [transcriptPath, setTranscriptPath] = React.useState<string | null>(null);
  const [pendingImages, setPendingImages] = React.useState<PendingImage[]>([]);
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    session.configure({
      onState: (s) => {
        setState(s);
        if (s === "idle") {
          setElapsed(0);
          setTranscriptPath(null);
          setMicActive(false);
        }
      },
      onMessage: (m) => {
        setMessages((prev) => [...prev, m]);
        if (transcriptPath == null) {
          // The transcript service may have just opened a file — refresh path lazily.
        }
      },
      onTick: (ms) => setElapsed(ms),
      onMic: (active) => setMicActive(active),
    });
  }, [session, transcriptPath]);

  React.useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const toggleMic = async () => {
    if (state === "speaking") {
      session.cancel();
      return;
    }
    if (!session.isActive() || state === "error") {
      if (state === "error") setMessages([]);
      await session.start({ withMic: true });
      return;
    }
    if (session.isMicActive()) {
      session.disableMic();
    } else {
      await session.enableMic();
    }
  };

  const submitText = () => {
    const value = textInput.trim();
    if (!value && pendingImages.length === 0) return;
    const payload = value || "(image)";
    const images = pendingImages.map((p) => ({ mimeType: p.mimeType, data: p.base64 }));
    if (!session.isActive() || state === "error") {
      void (async () => {
        if (state === "error") setMessages([]);
        await session.start({ withMic: false });
        session.sendText(payload, images);
        setTextInput("");
        setPendingImages([]);
      })();
    } else {
      session.sendText(payload, images);
      setTextInput("");
      setPendingImages([]);
    }
  };

  const onPickFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const next: PendingImage[] = [];
    let skipped = 0;
    for (let i = 0; i < files.length; i++) {
      const img = await fileToPendingImage(files[i]);
      if (img) next.push(img);
      else skipped += 1;
    }
    if (skipped > 0) {
      new Notice(`Skipped ${skipped} unsupported or oversized image${skipped === 1 ? "" : "s"}.`);
    }
    if (next.length > 0) setPendingImages((prev) => [...prev, ...next]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const removePendingImage = (idx: number) => {
    setPendingImages((prev) => prev.filter((_, i) => i !== idx));
  };

  const openTranscript = () => {
    if (!transcriptPath) return;
    const file = app.vault.getAbstractFileByPath(transcriptPath);
    if (file instanceof TFile) {
      void app.workspace.getLeaf(false).openFile(file);
    }
  };

  const timerClass =
    elapsed >= SESSION_DURATION_MS - 30 * 1000
      ? "is-critical"
      : elapsed >= SESSION_DURATION_MS - 2 * 60 * 1000
      ? "is-warn"
      : "";
  const isActive = state !== "idle" && state !== "error";

  return (
    <div className="kp-assistant kp-assistant--embedded" role="region" aria-label="Marvis assistant">
        <header className="kp-assistant__header">
          <span className={`kp-assistant__pill kp-assistant__pill--${state}`}>
            {statePillLabel(state, micActive)}
          </span>
          {settings.assistant.showTimer && isActive && (
            <span
              className={`kp-assistant__timer ${timerClass}`}
              title={`Session limit ${fmtClock(SESSION_DURATION_MS)}`}
            >
              {fmtClock(elapsed)}
            </span>
          )}
          <span className="kp-assistant__spacer" />
          {transcriptPath && (
            <button
              className="kp-iconbtn"
              title="Open transcript"
              aria-label="Open transcript"
              onClick={openTranscript}
            >
              <Icon name="externalLink" size={14} />
            </button>
          )}
          <button
            className="kp-iconbtn"
            title="Close"
            aria-label="Close"
            onClick={onClose}
          >
            <Icon name="x" size={14} />
          </button>
        </header>

        <div className="kp-assistant__body" ref={scrollRef}>
          {messages.length === 0 && (
            <div className="kp-assistant__hint">
              Type a message below — or tap the mic to talk. Marvis can summarize
              today, create tasks, log progress, and more — every change is confirmed
              before it touches your vault.
            </div>
          )}
          {messages.map((m, i) => (
            <Bubble key={`${m.ts}-${i}`} message={m} />
          ))}
        </div>

        <footer className="kp-assistant__footer">
          <div className="kp-assistant__voicewell">
            {state === "speaking" ? (
              <button
                className="kp-assistant__bigmic kp-assistant__bigmic--stop"
                onClick={() => session.cancel()}
                title="Interrupt"
                aria-label="Interrupt"
              >
                <Icon name="pause" size={32} />
              </button>
            ) : (
              <button
                className={`kp-assistant__bigmic kp-assistant__bigmic--${state} ${micActive ? "is-active" : ""}`}
                onClick={() => void toggleMic()}
                title={micActive ? "Mute mic" : "Tap to talk"}
                aria-label={micActive ? "Mute microphone" : "Enable microphone"}
                aria-pressed={micActive}
              >
                <Icon name={micActive ? "mic" : "micOff"} size={32} />
              </button>
            )}
            <div className="kp-assistant__voicestate" aria-live="polite">
              {voicePrompt(state, micActive)}
            </div>
          </div>
          {pendingImages.length > 0 && (
            <div className="kp-assistant__attachments" aria-label="Pending image attachments">
              {pendingImages.map((img, i) => (
                <div className="kp-assistant__chip" key={`${img.name}-${i}`}>
                  <img
                    className="kp-assistant__chip-thumb"
                    src={img.dataUrl}
                    alt={img.name}
                  />
                  <span className="kp-assistant__chip-name" title={img.name}>
                    {img.name}
                  </span>
                  <button
                    className="kp-assistant__chip-remove"
                    title="Remove attachment"
                    aria-label={`Remove ${img.name}`}
                    onClick={() => removePendingImage(i)}
                  >
                    <Icon name="x" size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="kp-assistant__textrow">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/heic,image/heif"
              multiple
              className="kp-assistant__fileinput"
              onChange={(e) => void onPickFiles(e.target.files)}
            />
            <button
              className="kp-iconbtn kp-iconbtn--round kp-assistant__attach"
              title="Attach image"
              aria-label="Attach image"
              onClick={() => fileInputRef.current?.click()}
            >
              <Icon name="image" size={14} />
            </button>
            <input
              type="text"
              className="kp-assistant__textinput"
              placeholder="Type a message…"
              value={textInput}
              onChange={(e) => setTextInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submitText();
              }}
            />
            <button
              className="kp-iconbtn kp-iconbtn--round kp-assistant__send"
              title="Send"
              aria-label="Send"
              onClick={submitText}
              disabled={!textInput.trim() && pendingImages.length === 0}
            >
              <Icon name="send" size={14} />
            </button>
          </div>
        </footer>
    </div>
  );
};

const Bubble: React.FC<{ message: SessionMessage }> = ({ message }) => {
  const time = new Date(message.ts).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const cls =
    message.kind === "user"
      ? "kp-assistant__bubble kp-assistant__bubble--user"
      : message.kind === "assistant"
      ? "kp-assistant__bubble kp-assistant__bubble--assistant"
      : message.kind === "tool-call"
      ? "kp-assistant__bubble kp-assistant__bubble--tool"
      : message.kind === "tool-result"
      ? "kp-assistant__bubble kp-assistant__bubble--toolresult"
      : "kp-assistant__bubble kp-assistant__bubble--note";
  return (
    <div className={cls}>
      <span className="kp-assistant__bubble-time">{time}</span>
      {message.images && message.images.length > 0 && (
        <div className="kp-assistant__bubble-images">
          {message.images.map((img, i) => (
            <img
              key={i}
              className="kp-assistant__bubble-image"
              src={img.dataUrl}
              alt=""
            />
          ))}
        </div>
      )}
      {message.text && <span className="kp-assistant__bubble-text">{message.text}</span>}
    </div>
  );
};
