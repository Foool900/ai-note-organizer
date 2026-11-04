import { App, TFile } from "obsidian";
import { chatCompletion, ChatMessage } from "./ai";
import type { AiNoteOrganizerSettings } from "./settings";

const CHAT_SYSTEM_PROMPT = `你是一个全能的中文 AI 助手，同时可以访问用户 Obsidian 知识库里的笔记。回答规则：
1. 如果问题与笔记相关，优先基于「检索到的相关笔记」回答，并引用笔记标题（用【标题】标注来源）。
2. 如果问题与笔记无关（例如通用知识、编程、写作、翻译、头脑风暴等），用你自己的知识直接回答，不要拘泥于笔记。
3. 笔记仅供参考，若不相关请忽略，不要强行引用。
4. 保持简洁、结构清晰，用中文回答。`;

const MAX_CONTEXT_NOTES = 8;
const MAX_NOTE_CHARS = 1500;

interface IndexedNote {
  file: TFile;
  title: string;
  text: string;
}

export class VaultChat {
  private index: IndexedNote[] = [];
  private indexed = false;

  constructor(
    private app: App,
    private getSettings: () => AiNoteOrganizerSettings
  ) {}

  async ask(question: string, history: ChatMessage[]): Promise<string> {
    const settings = this.getSettings();
    if (!settings.apiKey) throw new Error("请先在插件设置里填写 API Key");
    if (!settings.baseUrl) throw new Error("请先在插件设置里填写接口地址");
    if (!settings.model) throw new Error("请先在插件设置里填写模型名");

    if (!this.indexed) {
      await this.rebuildIndex();
      this.indexed = true;
    }

    const related = await this.retrieve(question);
    const context = related.length
      ? related.map((n) => `【${n.title}】\n${n.content}`).join("\n\n")
      : "（没有检索到相关笔记）";

    const messages: ChatMessage[] = [
      { role: "system", content: CHAT_SYSTEM_PROMPT },
      ...history.slice(-6),
      {
        role: "user",
        content: `知识库中可能相关的笔记（仅供参考，不相关请忽略）：\n\n${context}\n\n用户问题：${question}`,
      },
    ];
    return await chatCompletion(settings, messages);
  }

  private async rebuildIndex(): Promise<void> {
    const isHidden = (p: string) => p.split("/").some((seg) => seg.startsWith("."));
    const files = this.app.vault.getMarkdownFiles().filter((f) => !isHidden(f.path));
    this.index = [];
    for (const f of files) {
      const cache = this.app.metadataCache.getFileCache(f);
      let summary =
        typeof cache?.frontmatter?.summary === "string"
          ? cache.frontmatter.summary
          : "";
      let excerpt = "";
      if (!summary) {
        excerpt = (await this.app.vault.cachedRead(f))
          .replace(/\s+/g, " ")
          .slice(0, 600);
      }
      const text = `${f.basename} ${summary} ${excerpt}`.toLowerCase();
      this.index.push({ file: f, title: f.basename, text });
    }
  }

  private async retrieve(
    question: string
  ): Promise<{ title: string; content: string }[]> {
    const q = question.toLowerCase();
    const terms = this.buildTerms(q);
    const scored = this.index
      .map((n) => ({ n, s: this.score(n, q, terms) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, MAX_CONTEXT_NOTES);

    const result: { title: string; content: string }[] = [];
    for (const { n } of scored) {
      const content = (await this.app.vault.cachedRead(n.file)).slice(0, MAX_NOTE_CHARS);
      result.push({ title: n.title, content });
    }
    return result;
  }

  private buildTerms(q: string): Set<string> {
    const terms = new Set<string>();
    const cleaned = q.replace(/[^一-龥a-z0-9]+/g, " ");
    cleaned.split(/\s+/).forEach((t) => {
      if (t.length >= 2) terms.add(t);
    });
    for (let i = 0; i < cleaned.length - 1; i++) {
      const bg = cleaned.slice(i, i + 2);
      if (/^[一-龥a-z0-9]{2}$/.test(bg)) terms.add(bg);
    }
    return terms;
  }

  private score(n: IndexedNote, q: string, terms: Set<string>): number {
    let s = 0;
    if (q.length >= 3 && n.text.includes(q)) s += 5;
    for (const t of terms) if (n.text.includes(t)) s += 1;
    if (n.title.toLowerCase().includes(q.trim())) s += 3;
    return s;
  }
}
