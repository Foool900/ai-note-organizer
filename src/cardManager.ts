import { App, Modal, Notice, Setting } from "obsidian";
import type { Flashcard, FlashcardManager } from "./flashcards";

export class CardEditModal extends Modal {
  private frontInput: HTMLInputElement;
  private backInput: HTMLTextAreaElement;
  private sourceInput: HTMLInputElement;

  constructor(
    app: App,
    private manager: FlashcardManager,
    private existing: Flashcard | null,
    private onDone: () => void
  ) {
    super(app);
  }

  onOpen() {
    this.titleEl.setText(this.existing ? "编辑闪卡" : "添加闪卡");
    const { contentEl } = this;
    contentEl.empty();

    new Setting(contentEl).setName("问题").addText((t) => {
      this.frontInput = t.inputEl;
      t.setValue(this.existing?.front ?? "").setPlaceholder("问题");
    });

    new Setting(contentEl).setName("答案").addTextArea((t) => {
      this.backInput = t.inputEl;
      this.backInput.rows = 5;
      t.setValue(this.existing?.back ?? "").setPlaceholder("答案");
    });

    new Setting(contentEl).setName("来源（可选）").addText((t) => {
      this.sourceInput = t.inputEl;
      t.setValue(this.existing?.source ?? "").setPlaceholder("来源笔记名");
    });

    const footer = contentEl.createDiv({ cls: "aon-footer" });
    const saveBtn = footer.createEl("button", { text: "保存", cls: "mod-cta" });
    const cancelBtn = footer.createEl("button", { text: "取消" });

    saveBtn.addEventListener("click", async () => {
      const front = this.frontInput.value.trim();
      const back = this.backInput.value.trim();
      if (!front || !back) {
        new Notice("问题和答案都不能为空");
        return;
      }
      saveBtn.disabled = true;
      try {
        if (this.existing) {
          await this.manager.updateCard(this.existing, front, back);
        } else {
          await this.manager.addCard(front, back, this.sourceInput.value.trim());
        }
        this.close();
        this.onDone();
      } catch (e) {
        new Notice("保存失败: " + (e instanceof Error ? e.message : String(e)));
        saveBtn.disabled = false;
      }
    });

    cancelBtn.addEventListener("click", () => this.close());
  }

  onClose() {
    this.contentEl.empty();
  }
}
