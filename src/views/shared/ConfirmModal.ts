import { App, Modal, Setting } from "obsidian";

export class ConfirmModal extends Modal {
  private title_: string;
  private message: string;
  private onConfirm: () => void | Promise<void>;
  private confirmLabel: string;

  constructor(
    app: App,
    title: string,
    message: string,
    onConfirm: () => void | Promise<void>,
    confirmLabel = "Delete"
  ) {
    super(app);
    this.title_ = title;
    this.message = message;
    this.onConfirm = onConfirm;
    this.confirmLabel = confirmLabel;
  }

  onOpen(): void {
    this.contentEl.createEl("h2", { text: this.title_ });
    this.contentEl.createEl("p", { text: this.message });
    new Setting(this.contentEl)
      .addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()))
      .addButton((b) =>
        b
          .setButtonText(this.confirmLabel)
          .setWarning()
          .onClick(() => {
            this.close();
            void this.onConfirm();
          })
      );
  }
}
