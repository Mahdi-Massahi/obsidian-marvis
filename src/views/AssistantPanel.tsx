import * as React from "react";
import * as ReactDOM from "react-dom";
import { TFile } from "obsidian";
import { usePlugin } from "./context";
import { Icon } from "./shared/Icon";
import type {
  AssistantSession,
  SessionMessage,
  SessionState,
} from "../services/assistant/assistantSession";

interface Props {
  open: boolean;
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

const VOICE_PROMPT: Record<SessionState, string> = {
  idle: "Tap to talk",
  connecting: "Connecting…",
  listening: "Listening — tap to stop",
  thinking: "Thinking…",
  speaking: "Speaking…",
  "awaiting-confirmation": "Awaiting confirmation…",
  reconnecting: "Reconnecting…",
  error: "Tap to retry",
};

const SESSION_DURATION_MS = 15 * 60 * 1000;

function fmtClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export const AssistantPanel: React.FC<Props> = ({ open, onClose, session }) => {
  const { app, settings } = usePlugin();
  const [state, setState] = React.useState<SessionState>(session.getState());
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
        }
      },
      onMessage: (m) => {
        setMessages((prev) => [...prev, m]);
        if (transcriptPath == null) {
          // The transcript service may have just opened a file — refresh path lazily.
        }
      },
      onTick: (ms) => setElapsed(ms),
    });
  }, [session, transcriptPath]);

  React.useEffect(() => {
    if (!open) return;
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, open]);

  React.useEffect(() => {
    if (!open) return;
    if (state === "idle" && messages.length === 0) {
      void session.start();
    }
  }, [open, state, session, messages.length]);

  const startStop = async () => {
    if (state === "idle" || state === "error") {
      setMessages([]);
      await session.start();
    } else {
      await session.stop();
    }
  };

  const submitText = () => {
    const value = textInput.trim();
    if (!value) return;
    if (state === "idle" || state === "error") {
      void (async () => {
        await session.start();
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

  if (!open) return null;

  const timerClass =
    elapsed >= SESSION_DURATION_MS - 30 * 1000
      ? "is-critical"
      : elapsed >= SESSION_DURATION_MS - 2 * 60 * 1000
      ? "is-warn"
      : "";
  const isActive = state !== "idle" && state !== "error";

  return ReactDOM.createPortal(
    <div className="kp-portal">
      <div className="kp-assistant" role="dialog" aria-label="Marvis assistant">
        <header className="kp-assistant__header">
          <span className={`kp-assistant__pill kp-assistant__pill--${state}`}>
            {STATE_LABEL[state]}
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
              Tap the mic and start talking. Marvis can summarize today, create tasks,
              log progress, and more — every change is confirmed before it touches
              your vault.
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
                className={`kp-assistant__bigmic kp-assistant__bigmic--${state} ${isActive ? "is-active" : ""}`}
                onClick={() => void startStop()}
                title={isActive ? "End session" : "Start session"}
                aria-label={isActive ? "End session" : "Start session"}
              >
                <Icon name="mic" size={32} />
              </button>
            )}
            <div className="kp-assistant__voicestate" aria-live="polite">
              {VOICE_PROMPT[state]}
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
              className="kp-iconbtn"
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
    </div>,
    document.body
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
