import { App, Modal, Notice } from "obsidian";
import type { GeneratedCard, FlashcardManager } from "./flashcards";

interface CardRow {
  card: GeneratedCard;
  checkbox: HTMLInputElement;
  frontInput: HTMLInputElement;
  backInput: HTMLTextAreaElement;
}

export class CardPreviewModal extends Modal {
  private rows: CardRow[] = [];

  constructor(
    app: App,
    private manager: FlashcardManager,
    private cards: GeneratedCard[],
    private onSaved: () => void
  ) {
    super(app);
  }

  onOpen() {
    this.titleEl.setText("生成闪卡预览");
    const { contentEl } = this;
    contentEl.empty();
    this.rows = [];

    contentEl.createEl("p", {
      text: `共 ${this.cards.length} 张卡。可修改问题和答案，取消勾选 = 不保存，确认后写入「${this.manager.deckFolder()}」文件夹。`,
      cls: "aon-desc",
    });

    const list = contentEl.createDiv({ cls: "aon-list" });

    for (const card of this.cards) {
      const rowEl = list.createDiv({ cls: "aon-row aon-card-row" });
      const cb = rowEl.createEl("input", { type: "checkbox" });
      cb.checked = true;

      const body = rowEl.createDiv({ cls: "aon-row-text" });
      const frontInput = body.createEl("input", {
        type: "text",
        cls: "aon-folder-input",
      });
      frontInput.value = card.front;
      frontInput.placeholder = "问题";

      const backInput = body.createEl("textarea", { cls: "aon-card-back-input" });
      backInput.value = card.back;
      backInput.placeholder = "答案";

      body.createEl("div", { cls: "aon-path", text: `来源：${card.source}` });

      this.rows.push({ card, checkbox: cb, frontInput, backInput });
    }

    const footer = contentEl.createDiv({ cls: "aon-footer" });
    const saveBtn = footer.createEl("button", { text: "保存", cls: "mod-cta" });
    const cancelBtn = footer.createEl("button", { text: "取消" });

    saveBtn.addEventListener("click", async () => {
      const selected = this.rows
        .filter((r) => r.checkbox.checked)
        .map((r) => ({
          ...r.card,
          front: r.frontInput.value.trim(),
          back: r.backInput.value.trim(),
        }))
        .filter((c) => c.front && c.back);
      if (selected.length === 0) {
        new Notice("没有可保存的卡片");
        return;
      }
      saveBtn.setText("保存中…");
      saveBtn.disabled = true;
      try {
        const n = await this.manager.saveCards(selected);
        this.close();
        new Notice(`已保存 ${n} 张闪卡`);
        this.onSaved();
      } catch (e) {
        new Notice("保存失败: " + (e instanceof Error ? e.message : String(e)));
        saveBtn.setText("保存");
        saveBtn.disabled = false;
      }
    });

    cancelBtn.addEventListener("click", () => this.close());
  }

  onClose() {
    this.contentEl.empty();
  }
}
