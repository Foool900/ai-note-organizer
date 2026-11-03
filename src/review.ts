import { App, Modal } from "obsidian";
import { chatCompletion } from "./ai";
import type { AiNoteOrganizerSettings } from "./settings";

const REVIEW_SYSTEM_PROMPT = `你是一名知识管理助手。根据用户最近一段时间新增/修改的笔记列表，生成一份「知识回顾」报告。要求：
1. 用 markdown 输出，以一级标题开头（含时间范围）。
2. 开头一段话总结这段时间写了多少笔记、主要围绕什么主题。
3. 把笔记按主题分组（二级标题），每组列出相关笔记，用「- [[标题]]：一句话说明」的形式。
4. 最后加一段「本周建议」：指出可能值得补充或深化的地方（信息不足就简短带过）。
5. 直接输出 markdown 正文，不要用代码块包裹。`;

export class KnowledgeReview {
  constructor(
    private app: App,
    private getSettings: () => AiNoteOrganizerSettings
  ) {}

  async generate(days: number): Promise<{ markdown: string; count: number }> {
    const settings = this.getSettings();
    if (!settings.apiKey) throw new Error("请先在插件设置里填写 API Key");
    if (!settings.baseUrl) throw new Error("请先在插件设置里填写接口地址");
    if (!settings.model) throw new Error("请先在插件设置里填写模型名");

    const cutoff = Date.now() - days * 86400000;
    const isHidden = (p: string) => p.split("/").some((seg) => seg.startsWith("."));
    const files = this.app.vault
      .getMarkdownFiles()
      .filter((f) => !isHidden(f.path) && (f.stat?.mtime ?? 0) >= cutoff)
      .sort((a, b) => (b.stat?.mtime ?? 0) - (a.stat?.mtime ?? 0));

    if (files.length === 0) {
      throw new Error("这段时间没有新增或修改的笔记");
    }

    const notes: { title: string; summary: string }[] = [];
    for (const f of files) {
      const cache = this.app.metadataCache.getFileCache(f);
      let summary =
        typeof cache?.frontmatter?.summary === "string"
          ? cache.frontmatter.summary
          : "";
      if (!summary) {
        summary = (await this.app.vault.cachedRead(f))
          .replace(/\s+/g, " ")
          .slice(0, 150);
      }
      notes.push({ title: f.basename, summary });
    }

    const listText = notes
      .map((n) => `标题：${n.title}\n摘要：${n.summary || "(无)"}`)
      .join("\n\n");

    const raw = await chatCompletion(settings, [
      { role: "system", content: REVIEW_SYSTEM_PROMPT },
      {
        role: "user",
        content: `时间范围：最近 ${days} 天\n\n笔记列表（${notes.length} 篇）：\n\n${listText}`,
      },
    ]);

    return { markdown: stripFence(raw.trim()), count: notes.length };
  }
}

export class ReviewRangeModal extends Modal {
  constructor(app: App, private onChoose: (days: number) => void) {
    super(app);
  }

  onOpen() {
    this.titleEl.setText("生成知识回顾");
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("p", {
      text: "选择回顾的时间范围（扫描这段时间新增/修改的笔记）：",
      cls: "aon-desc",
    });
    const list = contentEl.createDiv({ cls: "aon-write-ops" });
    const ranges: [number, string][] = [
      [7, "最近 7 天"],
      [14, "最近 14 天"],
      [30, "最近 30 天"],
    ];
    for (const [days, label] of ranges) {
      const btn = list.createEl("button", { cls: "aon-write-op" });
      btn.createSpan({ cls: "aon-write-op-label", text: label });
      btn.addEventListener("click", () => {
        this.close();
        this.onChoose(days);
      });
    }
  }

  onClose() {
    this.contentEl.empty();
  }
}

function stripFence(s: string): string {
  const m = s.match(/^```(?:markdown|md)?\s*\n?([\s\S]*?)\n?```\s*$/i);
  return m ? m[1].trim() : s;
}
