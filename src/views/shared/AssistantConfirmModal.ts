import { App, Modal, Setting } from "obsidian";

export interface ContextSection {
  heading: string;
  rows: Array<[string, string]>;
}

export interface AssistantConfirmModalOptions {
  title: string;
  preview: string;
  args: Record<string, unknown>;
  /** Tool name (e.g. "create_task") so the modal can pull richer context. */
  toolName?: string;
  /** Optional pre-resolved context blocks (e.g. existing item being modified). */
  context?: ContextSection[];
  onAccept: () => void;
  onDecline: () => void;
}

export class AssistantConfirmModal extends Modal {
  private opts: AssistantConfirmModalOptions;
  private resolved = false;

  constructor(app: App, opts: AssistantConfirmModalOptions) {
    super(app);
    this.opts = opts;
  }

  onOpen(): void {
    this.modalEl.addClass("kp-assistant-confirm");

    this.contentEl.createEl("h2", { text: this.opts.title });
    this.contentEl.createEl("p", {
      cls: "kp-assistant-confirm__preview",
      text: this.opts.preview,
    });

    const argEntries = Object.entries(this.opts.args).filter(
      ([, v]) => v !== undefined && v !== null && v !== ""
    );
    if (argEntries.length > 0) {
      this.renderSection("Proposed", argEntries.map(([k, v]) => [k, formatValue(v)]));
    }

    if (this.opts.context && this.opts.context.length > 0) {
      for (const section of this.opts.context) {
        if (section.rows.length === 0) continue;
        this.renderSection(section.heading, section.rows);
      }
    }

    new Setting(this.contentEl)
      .addButton((b) =>
        b.setButtonText("Decline").onClick(() => {
          this.resolve(false);
        })
      )
      .addButton((b) =>
        b
          .setCta()
          .setButtonText("Approve")
          .onClick(() => {
            this.resolve(true);
          })
      );
  }

  onClose(): void {
    if (!this.resolved) {
      this.resolved = true;
      this.opts.onDecline();
    }
    this.contentEl.empty();
  }

  cancelExternally(): void {
    if (this.resolved) return;
    this.resolve(false);
  }

  private resolve(accepted: boolean): void {
    if (this.resolved) return;
    this.resolved = true;
    this.close();
    if (accepted) this.opts.onAccept();
    else this.opts.onDecline();
  }

  private renderSection(heading: string, rows: Array<[string, string]>): void {
    const section = this.contentEl.createDiv({ cls: "kp-assistant-confirm__section" });
    section.createEl("h3", {
      cls: "kp-assistant-confirm__section-heading",
      text: heading,
    });
    const dl = section.createEl("dl", { cls: "kp-assistant-confirm__fields" });
    for (const [key, value] of rows) {
      dl.createEl("dt", { text: prettyKey(key) });
      dl.createEl("dd", { text: value });
    }
  }
}

function prettyKey(key: string): string {
  return key
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .replace(/^./, (c) => c.toUpperCase());
}

function formatValue(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (Array.isArray(v)) {
    if (v.length === 0) return "—";
    return v.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(", ");
  }
  if (typeof v === "object") return JSON.stringify(v);
  if (typeof v === "boolean") return v ? "yes" : "no";
  return String(v);
}
