import { ItemView, MarkdownRenderer, WorkspaceLeaf, setIcon } from "obsidian";
import type AiNoteOrganizerPlugin from "./main";
import type { ChatMessage } from "./ai";

export const CHAT_VIEW_TYPE = "ai-note-organizer-chat";

const SUGGESTIONS = [
  "总结我最近修改的笔记",
  "这个库主要有哪些主题？",
  "帮我梳理一份学习路线",
  "给我一些整理建议",
];

export class ChatView extends ItemView {
  private historyContainer: HTMLElement;
  private input: HTMLTextAreaElement;
  private history: ChatMessage[] = [];

  constructor(leaf: WorkspaceLeaf, private plugin: AiNoteOrganizerPlugin) {
    super(leaf);
  }

  getViewType(): string {
    return CHAT_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "AI 问答";
  }

  getIcon(): string {
    return "message-circle";
  }

  async onOpen() {
    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();
    container.addClass("aon-chat");

    // 顶部导航栏（线图标）
    const topBar = container.createDiv({ cls: "aon-chat-topbar" });
    topBar.createSpan({ cls: "aon-chat-topbar-title", text: "AI 助手" });
    const spacer = topBar.createDiv({ cls: "aon-chat-topbar-spacer" });
    const clearBtn = topBar.createEl("button", { cls: "aon-icon-btn" });
    clearBtn.setAttribute("aria-label", "清空对话");
    setIcon(clearBtn, "eraser");
    clearBtn.addEventListener("click", () => this.clear());

    // 中部：对话 / 空状态
    this.historyContainer = container.createDiv({ cls: "aon-chat-history" });
    this.showEmptyState();

    // 底部：胶囊输入框 + 渐变发送按钮
    const inputRow = container.createDiv({ cls: "aon-chat-input-row" });
    this.input = inputRow.createEl("textarea", { cls: "aon-chat-textarea" });
    this.input.setAttribute("rows", "1");
    this.input.setAttribute("placeholder", "问我关于你笔记的问题…");
    this.input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        this.send();
      }
    });
    this.input.addEventListener("input", () => this.autoResize());
    const sendBtn = inputRow.createEl("button", { cls: "aon-send-btn" });
    sendBtn.setAttribute("aria-label", "发送");
    setIcon(sendBtn, "arrow-up");
    sendBtn.addEventListener("click", () => this.send());

    // 底部状态栏（细分隔线）
    const status = container.createDiv({ cls: "aon-chat-status" });
    status.createSpan({
      cls: "aon-status-item",
      text: `模型：${this.plugin.settings.model || "未配置"}`,
    });
    status.createSpan({ cls: "aon-status-sep" });
    status.createSpan({ cls: "aon-status-item", text: "基于你的笔记回答" });
  }

  private showEmptyState() {
    const empty = this.historyContainer.createDiv({ cls: "aon-chat-empty" });
    empty.createDiv({ cls: "aon-orb" });
    empty.createEl("div", { text: "你好，我是你的知识库助手", cls: "aon-chat-greeting" });
    empty.createEl("div", { text: "可以随便问，我会先检索你的笔记再回答", cls: "aon-chat-subtitle" });

    const chips = empty.createDiv({ cls: "aon-suggest" });
    for (const s of SUGGESTIONS) {
      const chip = chips.createEl("button", { cls: "aon-suggest-chip", text: s });
      chip.addEventListener("click", () => this.send(s));
    }
  }

  private clear() {
    this.history = [];
    this.historyContainer.empty();
    this.showEmptyState();
  }

  private async send(text?: string) {
    const q = (text ?? this.input.value).trim();
    if (!q) return;
    this.input.value = "";
    this.autoResize();
    if (this.history.length === 0) this.historyContainer.empty();

    this.addBubble("user", q);
    this.history.push({ role: "user", content: q });

    const bubble = this.addBubble("assistant");
    bubble.setText("思考中…");
    try {
      const answer = await this.plugin.askVault(q, this.history);
      bubble.empty();
      await MarkdownRenderer.render(this.app, answer, bubble, "", this);
      this.history.push({ role: "assistant", content: answer });
    } catch (e) {
      bubble.empty();
      bubble.setText("出错了：" + (e instanceof Error ? e.message : String(e)));
    }
    this.historyContainer.scrollTop = this.historyContainer.scrollHeight;
  }

  private autoResize() {
    this.input.style.height = "auto";
    this.input.style.height = Math.min(this.input.scrollHeight, 160) + "px";
  }

  private addBubble(role: "user" | "assistant", text?: string): HTMLElement {
    const msg = this.historyContainer.createDiv({
      cls: `aon-chat-msg aon-chat-${role}`,
    });
    const bubble = msg.createDiv({ cls: "aon-chat-bubble" });
    if (text !== undefined) bubble.setText(text);
    this.historyContainer.scrollTop = this.historyContainer.scrollHeight;
    return bubble;
  }

  async onClose() {
    (this.containerEl.children[1] as HTMLElement).empty();
  }
}
