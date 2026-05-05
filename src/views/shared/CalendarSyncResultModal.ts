import { App, Modal, Setting } from "obsidian";
import type { SyncResult } from "../../services/calendar/syncEngine";

export class CalendarSyncResultModal extends Modal {
  private heading: string;
  private result: SyncResult;

  constructor(app: App, heading: string, result: SyncResult) {
    super(app);
    this.heading = heading;
    this.result = result;
  }

  onOpen(): void {
    this.modalEl.addClass("kp-calsync-result");
    this.contentEl.createEl("h2", { text: this.heading });

    const summary = this.contentEl.createEl("p", {
      cls: "kp-calsync-result__summary",
    });
    const r = this.result;
    summary.setText(
      `${r.created} created · ${r.updated} updated · ${r.archived} archived` +
        (r.failed ? ` · ${r.failed} failed` : "")
    );

    const total = r.created + r.updated + r.archived + r.failed;
    if (total === 0) {
      this.contentEl.createEl("p", {
        cls: "kp-calsync-result__empty",
        text: "No changes — your calendar is already in sync.",
      });
    } else {
      this.renderSection("Created", r.details.created, "kp-calsync-result__created");
      this.renderSection("Updated", r.details.updated, "kp-calsync-result__updated");
      this.renderSection("Archived", r.details.archived, "kp-calsync-result__archived");
      this.renderSection("Failed", r.details.failed, "kp-calsync-result__failed");
    }

    new Setting(this.contentEl).addButton((b) =>
      b
        .setCta()
        .setButtonText("Close")
        .onClick(() => this.close())
    );
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private renderSection(label: string, items: string[], cls: string): void {
    if (items.length === 0) return;
    const section = this.contentEl.createDiv({
      cls: `kp-calsync-result__section ${cls}`,
    });
    section.createEl("h3", { text: `${label} (${items.length})` });
    const list = section.createEl("ul", { cls: "kp-calsync-result__list" });
    for (const title of items) {
      list.createEl("li", { text: title || "(untitled)" });
    }
  }
}
