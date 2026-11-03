import { ItemView, Notice, WorkspaceLeaf } from "obsidian";
import type AiNoteOrganizerPlugin from "./main";
import { CardEditModal } from "./cardManager";
import { toDateStr } from "./flashcards";

export const FLASHCARD_VIEW_TYPE = "ai-note-organizer-flashcards";

export class FlashcardView extends ItemView {
  constructor(leaf: WorkspaceLeaf, private plugin: AiNoteOrganizerPlugin) {
    super(leaf);
  }

  getViewType(): string {
    return FLASHCARD_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "闪卡";
  }

  getIcon(): string {
    return "layers";
  }

  async onOpen() {
    await this.render();
  }

  private async render() {
    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();
    container.addClass("aon-dash");

    const cards = await this.plugin.flashcards.scanDeck();
    const today = toDateStr(new Date());
    const due = cards.filter((c) => !c.due || c.due <= today).length;
    const stats = this.plugin.getReviewStats();

    const hero = container.createDiv({ cls: "aon-dash-hero" });
    hero.createSpan({ cls: "aon-hero-num", text: String(cards.length) });
    hero.createSpan({ cls: "aon-hero-label", text: `张卡片 · 今日到期 ${due} 张` });

    const statsRow = container.createDiv({ cls: "aon-fc-stats" });
    statsRow.createSpan({ text: `累计复习 ${stats.totalReviewed} 张` });
    statsRow.createSpan({ cls: "aon-fc-dot", text: "·" });
    statsRow.createSpan({ text: `连续 ${stats.streak} 天` });

    const actions = container.createDiv({ cls: "aon-dash-actions" });
    const reviewBtn = actions.createEl("button", {
      text: due > 0 ? `开始复习（${due}）` : "开始复习",
      cls: "mod-cta",
    });
    reviewBtn.disabled = due === 0;
    reviewBtn.addEventListener("click", () => this.plugin.startReview());
    const addBtn = actions.createEl("button", { text: "添加卡片" });
    addBtn.addEventListener("click", () => this.plugin.addCard());
    const refreshBtn = actions.createEl("button", { text: "刷新" });
    refreshBtn.addEventListener("click", () => this.render());

    const section = container.createDiv({ cls: "aon-dash-section" });
    section.createEl("h3", { text: "全部卡片" });
    const list = section.createDiv({ cls: "aon-mgr-list" });
    if (cards.length === 0) {
      list.createEl("div", {
        text: "还没有闪卡。点「添加卡片」手动创建，或右键笔记「AI 生成闪卡」。",
        cls: "aon-empty",
      });
      return;
    }

    cards.sort((a, b) => a.due.localeCompare(b.due));
    for (const card of cards) {
      const row = list.createDiv({ cls: "aon-mgr-row" });
      const body = row.createDiv({ cls: "aon-mgr-body" });
      body.createEl("div", { text: card.front, cls: "aon-mgr-front" });
      body.createEl("div", {
        text: `到期 ${card.due || "—"} · 间隔 ${card.interval} 天${card.source ? " · 来源 " + card.source : ""}`,
        cls: "aon-mgr-meta",
      });
      const openEdit = () =>
        new CardEditModal(this.app, this.plugin.flashcards, card, () => this.render()).open();
      body.addEventListener("click", openEdit);

      const act = row.createDiv({ cls: "aon-mgr-actions" });
      const editBtn = act.createEl("button", { text: "编辑" });
      editBtn.addEventListener("click", openEdit);
      const delBtn = act.createEl("button", { text: "删除", cls: "mod-warning" });
      delBtn.addEventListener("click", async () => {
        if (delBtn.textContent !== "确认删除") {
          delBtn.textContent = "确认删除";
          setTimeout(() => {
            if (delBtn.textContent === "确认删除") delBtn.textContent = "删除";
          }, 3000);
        } else {
          await this.plugin.flashcards.deleteCard(card);
          new Notice("已删除（可在 .trash 找回）");
          await this.render();
        }
      });
    }
  }

  async onClose() {
    (this.containerEl.children[1] as HTMLElement).empty();
  }
}
