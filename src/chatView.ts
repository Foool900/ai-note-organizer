import { ItemView, WorkspaceLeaf } from "obsidian";
import type AiNoteOrganizerPlugin from "./main";
import type { ChatMessage } from "./ai";

export const CHAT_VIEW_TYPE = "ai-note-organizer-chat";

export class ChatView extends ItemView {
  private historyContainer: HTMLElement;
  private input: HTMLInputElement;
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

    this.historyContainer = container.createDiv({ cls: "aon-chat-history" });
    this.historyContainer.createEl("div", {
      text: "问我关于你笔记的问题吧，比如「我关于指针的笔记都写了什么」。",
      cls: "aon-chat-hint",
    });

    const inputRow = container.createDiv({ cls: "aon-chat-input-row" });
    this.input = inputRow.createEl("input", { type: "text", placeholder: "输入问题…" });
    this.input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.isComposing) this.send();
    });
    const sendBtn = inputRow.createEl("button", { text: "发送", cls: "mod-cta" });
    sendBtn.addEventListener("click", () => this.send());
  }

  private async send() {
    const q = this.input.value.trim();
    if (!q) return;
    this.input.value = "";

    this.addBubble("user", q);
    this.history.push({ role: "user", content: q });

    const bubble = this.addBubble("assistant", "思考中…");
    try {
      const answer = await this.plugin.askVault(q, this.history);
      bubble.setText(answer);
      this.history.push({ role: "assistant", content: answer });
    } catch (e) {
      bubble.setText("出错了：" + (e instanceof Error ? e.message : String(e)));
    }
  }

  private addBubble(role: "user" | "assistant", text: string): HTMLElement {
    const msg = this.historyContainer.createDiv({
      cls: `aon-chat-msg aon-chat-${role}`,
    });
    const bubble = msg.createDiv({ cls: "aon-chat-bubble" });
    bubble.setText(text);
    this.historyContainer.scrollTop = this.historyContainer.scrollHeight;
    return bubble;
  }

  async onClose() {
    (this.containerEl.children[1] as HTMLElement).empty();
  }
}
