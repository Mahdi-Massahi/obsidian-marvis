import * as React from "react";
import { TFile } from "obsidian";
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
  const scrollRef = React.useRef<HTMLDivElement>(null);

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
    if (!value) return;
    if (!session.isActive() || state === "error") {
      void (async () => {
        if (state === "error") setMessages([]);
        await session.start({ withMic: false });
        session.sendText(value);
        setTextInput("");
      })();
    } else {
      session.sendText(value);
      setTextInput("");
    }
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
          <div className="kp-assistant__textrow">
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
              disabled={!textInput.trim()}
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
      <span className="kp-assistant__bubble-text">{message.text}</span>
    </div>
  );
};
