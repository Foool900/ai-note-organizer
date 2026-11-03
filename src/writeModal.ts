import { App, Modal, Notice } from "obsidian";

export type WriteOp =
  | "polish"
  | "expand"
  | "shorten"
  | "translate_en"
  | "translate_zh"
  | "continue";

export interface WriteOpDef {
  id: WriteOp;
  label: string;
  desc: string;
  system: string;
}

export const WRITE_OPS: WriteOpDef[] = [
  {
    id: "polish",
    label: "润色",
    desc: "让表达更清晰流畅",
    system: "润色下面的文字，使其表达更清晰流畅，保持原意不变。只输出结果，不要解释。",
  },
  {
    id: "expand",
    label: "扩写",
    desc: "补充细节和例子",
    system: "扩写下面的文字，补充细节和例子，使内容更丰富。只输出结果，不要解释。",
  },
  {
    id: "shorten",
    label: "缩写",
    desc: "压缩成简洁版本",
    system: "压缩下面的文字，保留核心信息，使其更简洁。只输出结果，不要解释。",
  },
  {
    id: "translate_en",
    label: "翻译成英文",
    desc: "中 → 英",
    system: "把下面的文字翻译成英文。只输出结果，不要解释。",
  },
  {
    id: "translate_zh",
    label: "翻译成中文",
    desc: "英 → 中",
    system: "把下面的文字翻译成中文。只输出结果，不要解释。",
  },
  {
    id: "continue",
    label: "续写",
    desc: "从光标处接着写",
    system: "接着下面的文字继续写，保持风格和主题一致。只输出续写的内容，不要解释。",
  },
];

export function writeOpDef(id: WriteOp): WriteOpDef {
  return WRITE_OPS.find((o) => o.id === id)!;
}

export class WriteOpModal extends Modal {
  constructor(app: App, private onChoose: (op: WriteOp) => void) {
    super(app);
  }

  onOpen() {
    this.titleEl.setText("AI 写作");
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("p", {
      text: "选择要对选中文字做的操作（续写则看光标位置）：",
      cls: "aon-desc",
    });
    const list = contentEl.createDiv({ cls: "aon-write-ops" });
    for (const op of WRITE_OPS) {
      const btn = list.createEl("button", { cls: "aon-write-op" });
      btn.createSpan({ cls: "aon-write-op-label", text: op.label });
      btn.createSpan({ cls: "aon-write-op-desc", text: op.desc });
      btn.addEventListener("click", () => {
        this.close();
        this.onChoose(op.id);
      });
    }
  }

  onClose() {
    this.contentEl.empty();
  }
}

export class WritePreviewModal extends Modal {
  constructor(
    app: App,
    private result: string,
    private onReplace: (text: string) => void
  ) {
    super(app);
  }

  onOpen() {
    this.titleEl.setText("AI 结果（可编辑）");
    const { contentEl } = this;
    contentEl.empty();

    const ta = contentEl.createEl("textarea", { cls: "aon-write-result" });
    ta.value = this.result;

    const footer = contentEl.createDiv({ cls: "aon-footer" });
    const replaceBtn = footer.createEl("button", { text: "替换", cls: "mod-cta" });
    const copyBtn = footer.createEl("button", { text: "复制" });
    const cancelBtn = footer.createEl("button", { text: "取消" });

    replaceBtn.addEventListener("click", () => {
      this.onReplace(ta.value);
      this.close();
    });
    copyBtn.addEventListener("click", async () => {
      await navigator.clipboard.writeText(ta.value);
      new Notice("已复制");
    });
    cancelBtn.addEventListener("click", () => this.close());
  }

  onClose() {
    this.contentEl.empty();
  }
}
