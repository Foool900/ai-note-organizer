import { App, Modal, Notice, Setting } from "obsidian";
import type { Flashcard, FlashcardManager } from "./flashcards";
import { toDateStr } from "./flashcards";

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

export class CardManagerModal extends Modal {
  private listEl: HTMLElement;
  private statsEl: HTMLElement;

  constructor(
    app: App,
    private manager: FlashcardManager,
    private onChanged: () => void,
    private onReview: () => void
  ) {
    super(app);
  }

  async onOpen() {
    this.titleEl.setText("闪卡管理");
    const { contentEl } = this;
    contentEl.empty();

    const header = contentEl.createDiv({ cls: "aon-mgr-header" });
    this.statsEl = header.createDiv({ cls: "aon-mgr-stats" });
    const reviewBtn = header.createEl("button", { text: "复习到期卡片" });
    reviewBtn.addEventListener("click", () => this.onReview());
    const addBtn = header.createEl("button", { text: "添加卡片", cls: "mod-cta" });
    addBtn.addEventListener("click", () => {
      new CardEditModal(this.app, this.manager, null, () => {
        this.refresh();
        this.onChanged();
      }).open();
    });

    this.listEl = contentEl.createDiv({ cls: "aon-mgr-list" });
    await this.refresh();
  }

  private async refresh() {
    const cards = await this.manager.scanDeck();
    const today = toDateStr(new Date());
    const due = cards.filter((c) => !c.due || c.due <= today).length;
    this.statsEl.setText(`共 ${cards.length} 张 · 今日到期 ${due} 张`);

    this.listEl.empty();
    if (cards.length === 0) {
      this.listEl.createEl("div", {
        text: "还没有闪卡，点「添加卡片」手动创建，或右键笔记「AI 生成闪卡」。",
        cls: "aon-empty",
      });
      return;
    }

    cards.sort((a, b) => a.due.localeCompare(b.due));
    for (const card of cards) {
      const row = this.listEl.createDiv({ cls: "aon-mgr-row" });
      const body = row.createDiv({ cls: "aon-mgr-body" });
      body.createEl("div", { text: card.front, cls: "aon-mgr-front" });
      body.createEl("div", {
        text: `到期 ${card.due || "—"} · 间隔 ${card.interval} 天${card.source ? " · 来源 " + card.source : ""}`,
        cls: "aon-mgr-meta",
      });
      body.addEventListener("click", () => {
        new CardEditModal(this.app, this.manager, card, () => this.refresh()).open();
      });

      const actions = row.createDiv({ cls: "aon-mgr-actions" });
      const editBtn = actions.createEl("button", { text: "编辑" });
      editBtn.addEventListener("click", () => {
        new CardEditModal(this.app, this.manager, card, () => this.refresh()).open();
      });
      const delBtn = actions.createEl("button", { text: "删除", cls: "mod-warning" });
      delBtn.addEventListener("click", async () => {
        if (delBtn.textContent !== "确认删除") {
          delBtn.textContent = "确认删除";
          setTimeout(() => {
            if (delBtn.textContent === "确认删除") delBtn.textContent = "删除";
          }, 3000);
        } else {
          await this.manager.deleteCard(card);
          new Notice("已删除（可在 .trash 找回）");
          await this.refresh();
          this.onChanged();
        }
      });
    }
  }

  onClose() {
    this.contentEl.empty();
  }
}
