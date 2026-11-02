import { App, Modal, MarkdownRenderer, Notice } from "obsidian";
import type { Flashcard, FlashcardManager, Grade } from "./flashcards";

export class ReviewModal extends Modal {
  private index = 0;
  private cardEl: HTMLElement;
  private frontFace: HTMLElement;
  private backFace: HTMLElement;
  private progressText: HTMLElement;
  private progressFill: HTMLElement;
  private showBtn: HTMLElement;
  private gradeRow: HTMLElement;

  constructor(
    app: App,
    private manager: FlashcardManager,
    private queue: Flashcard[]
  ) {
    super(app);
  }

  async onOpen() {
    this.titleEl.setText("复习闪卡");
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("aon-review");

    const top = contentEl.createDiv({ cls: "aon-review-top" });
    this.progressText = top.createDiv({ cls: "aon-review-progress-text" });
    const track = top.createDiv({ cls: "aon-review-track" });
    this.progressFill = track.createDiv({ cls: "aon-review-fill" });

    const scene = contentEl.createDiv({ cls: "aon-card-scene" });
    this.cardEl = scene.createDiv({ cls: "aon-card" });
    this.frontFace = this.cardEl.createDiv({ cls: "aon-card-face aon-card-front" });
    this.backFace = this.cardEl.createDiv({ cls: "aon-card-face aon-card-back" });

    const actions = contentEl.createDiv({ cls: "aon-review-actions" });
    this.showBtn = actions.createEl("button", {
      text: "显示答案（空格）",
      cls: "mod-cta",
    });
    this.showBtn.addEventListener("click", () => this.flip());

    this.gradeRow = actions.createDiv({ cls: "aon-grade-row" });
    this.gradeRow.style.display = "none";
    const grades: [Grade, string, string][] = [
      ["again", "忘记", "1"],
      ["hard", "模糊", "2"],
      ["good", "记得", "3"],
      ["easy", "轻松", "4"],
    ];
    for (const [g, label, key] of grades) {
      const b = this.gradeRow.createEl("button", {
        cls: `aon-grade-btn aon-grade-${g}`,
      });
      b.setText(`${label} (${key})`);
      b.addEventListener("click", () => this.grade(g));
    }

    this.scope.register([], " ", () => this.flip());
    this.scope.register([], "1", () => this.grade("again"));
    this.scope.register([], "2", () => this.grade("hard"));
    this.scope.register([], "3", () => this.grade("good"));
    this.scope.register([], "4", () => this.grade("easy"));

    await this.showCard(0);
  }

  private async showCard(i: number) {
    this.index = i;
    const card = this.queue[i];
    this.frontFace.empty();
    this.backFace.empty();
    await MarkdownRenderer.render(this.app, card.front, this.frontFace, "", null as any);
    await MarkdownRenderer.render(this.app, card.back, this.backFace, "", null as any);
    this.cardEl.removeClass("is-flipped");
    this.showBtn.style.display = "";
    this.gradeRow.style.display = "none";
    this.progressText.setText(
      `第 ${i + 1} / ${this.queue.length} 张 · 来源：${card.source || "—"}`
    );
    this.progressFill.style.width = `${Math.round((i / this.queue.length) * 100)}%`;
  }

  private flip() {
    if (this.cardEl.hasClass("is-flipped")) return;
    this.cardEl.addClass("is-flipped");
    this.showBtn.style.display = "none";
    this.gradeRow.style.display = "flex";
  }

  private async grade(g: Grade) {
    const card = this.queue[this.index];
    try {
      await this.manager.gradeCard(card, g);
    } catch (e) {
      new Notice("保存复习进度失败: " + (e instanceof Error ? e.message : String(e)));
    }
    if (this.index + 1 < this.queue.length) {
      await this.showCard(this.index + 1);
    } else {
      this.showDone();
    }
  }

  private showDone() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("aon-review");
    contentEl.createDiv({ cls: "aon-review-done-orb" });
    contentEl.createEl("div", { cls: "aon-review-done-title", text: "复习完成！" });
    contentEl.createEl("div", {
      cls: "aon-review-done-sub",
      text: `本次复习了 ${this.queue.length} 张卡片，按记忆曲线安排好了下次复习。`,
    });
    const btn = contentEl.createEl("button", { text: "关闭", cls: "mod-cta" });
    btn.addEventListener("click", () => this.close());
  }

  onClose() {
    this.contentEl.empty();
  }
}
