import { ItemView, WorkspaceLeaf, TFile, getAllTags } from "obsidian";
import type AiNoteOrganizerPlugin from "./main";
import { colorFor } from "./palette";

export const DASHBOARD_VIEW_TYPE = "ai-note-organizer-dashboard";

export class DashboardView extends ItemView {
  constructor(leaf: WorkspaceLeaf, private plugin: AiNoteOrganizerPlugin) {
    super(leaf);
  }

  getViewType(): string {
    return DASHBOARD_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "库概览";
  }

  getIcon(): string {
    return "bar-chart-3";
  }

  async onOpen() {
    await this.render();
  }

  private async render() {
    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();
    container.addClass("aon-dash");

    const files = this.app.vault
      .getMarkdownFiles()
      .filter((f) => !this.isHidden(f.path));

    // 顶部：总数 + 快捷操作
    const hero = container.createDiv({ cls: "aon-dash-hero" });
    hero.createSpan({ cls: "aon-hero-num", text: String(files.length) });
    hero.createSpan({ cls: "aon-hero-label", text: "篇笔记" });

    const actions = container.createDiv({ cls: "aon-dash-actions" });
    this.addQuickAction(actions, "整理当前笔记", () => this.plugin.organizeCurrentNote());
    this.addQuickAction(actions, "整理整个库", () => this.plugin.organizeVault());
    this.addQuickAction(actions, "整理指定文件夹", () => this.plugin.organizeFolder());
    this.addQuickAction(actions, "打开 AI 问答", () => this.plugin.activateChatView());
    this.addQuickAction(actions, "生成知识回顾", () => this.plugin.generateReview());
    this.addQuickAction(actions, "管理闪卡", () => this.plugin.openCardManager());
    const refreshBtn = actions.createEl("button", { text: "刷新" });
    refreshBtn.addEventListener("click", () => this.render());

    await this.renderReview(container);
    this.renderFolders(container, files);
    this.renderTags(container, files);
    this.renderRecent(container, files);
  }

  private async renderReview(container: HTMLElement) {
    const due = await this.plugin.getDueCount();
    const sec = container.createDiv({ cls: "aon-dash-section aon-review-banner" });
    const row = sec.createDiv({ cls: "aon-review-banner-row" });
    row.createSpan({ cls: "aon-review-banner-num", text: String(due) });
    row.createSpan({
      cls: "aon-review-banner-label",
      text: due === 0 ? "张卡片待复习，今天都复习完了 🎉" : "张卡片待复习",
    });
    if (due > 0) {
      const btn = row.createEl("button", { text: "开始复习", cls: "mod-cta" });
      btn.addEventListener("click", () => this.plugin.startReview());
    }
  }

  private renderFolders(container: HTMLElement, files: TFile[]) {
    const sec = container.createDiv({ cls: "aon-dash-section" });
    sec.createEl("h3", { text: "文件夹分布" });

    const counts = new Map<string, number>();
    for (const f of files) {
      const key = f.path.includes("/") ? f.path.split("/")[0] : "根目录";
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const entries = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    if (entries.length === 0) {
      sec.createEl("div", { text: "暂无笔记", cls: "aon-empty" });
      return;
    }
    const max = entries[0][1];
    for (const [name, count] of entries) {
      const row = sec.createDiv({ cls: "aon-bar-row" });
      row.createSpan({ cls: "aon-bar-label", text: name });
      const track = row.createDiv({ cls: "aon-bar-track" });
      const fill = track.createDiv({ cls: "aon-bar-fill" });
      fill.style.width = `${Math.max(2, Math.round((count / max) * 100))}%`;
      row.createSpan({ cls: "aon-bar-count", text: String(count) });
    }
  }

  private renderTags(container: HTMLElement, files: TFile[]) {
    const sec = container.createDiv({ cls: "aon-dash-section" });
    sec.createEl("h3", { text: "标签云" });

    const counts = new Map<string, number>();
    for (const f of files) {
      const cache = this.app.metadataCache.getFileCache(f);
      if (!cache) continue;
      const tags = getAllTags(cache);
      if (tags) {
        for (const t of tags) {
          const key = t.replace(/^#/, "");
          counts.set(key, (counts.get(key) ?? 0) + 1);
        }
      }
    }
    const entries = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30);
    if (entries.length === 0) {
      sec.createEl("div", { text: "暂无标签", cls: "aon-empty" });
      return;
    }

    const max = entries[0][1];
    const min = entries[entries.length - 1][1];
    const cloud = sec.createDiv({ cls: "aon-tagcloud" });
    for (const [tag, count] of entries) {
      const item = cloud.createSpan({ cls: "aon-tagcloud-item" });
      const size = min === max ? 1 : 0.85 + 0.75 * ((count - min) / (max - min));
      item.style.fontSize = `${size.toFixed(2)}em`;
      const dot = item.createSpan({ cls: "aon-dot" });
      dot.style.background = colorFor(tag);
      item.createSpan({ text: tag });
      item.createSpan({ text: ` ${count}`, cls: "aon-recent-meta" });
    }
  }

  private renderRecent(container: HTMLElement, files: TFile[]) {
    const sec = container.createDiv({ cls: "aon-dash-section" });
    sec.createEl("h3", { text: "最近修改" });

    const recent = [...files]
      .sort((a, b) => (b.stat?.mtime ?? 0) - (a.stat?.mtime ?? 0))
      .slice(0, 8);
    if (recent.length === 0) {
      sec.createEl("div", { text: "暂无笔记", cls: "aon-empty" });
      return;
    }
    for (const f of recent) {
      const item = sec.createDiv({ cls: "aon-recent-item" });
      item.createEl("div", { text: f.basename, cls: "aon-recent-title" });
      item.createEl("div", {
        text: `${f.path} · ${this.relTime(f.stat?.mtime)}`,
        cls: "aon-recent-meta",
      });
    }
  }

  private addQuickAction(container: HTMLElement, label: string, callback: () => void) {
    const btn = container.createEl("button", { text: label });
    btn.addEventListener("click", () => callback());
  }

  private isHidden(path: string): boolean {
    return path.split("/").some((seg) => seg.startsWith("."));
  }

  private relTime(ms?: number): string {
    if (!ms) return "";
    const diff = Date.now() - ms;
    const m = Math.floor(diff / 60000);
    if (m < 1) return "刚刚";
    if (m < 60) return `${m} 分钟前`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h} 小时前`;
    const d = Math.floor(h / 24);
    if (d < 30) return `${d} 天前`;
    return new Date(ms).toLocaleDateString();
  }

  async onClose() {
    (this.containerEl.children[1] as HTMLElement).empty();
  }
}
