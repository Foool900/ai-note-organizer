import { App, Modal, Notice } from "obsidian";
import type { ClassifiedItem, RenameSuggestion } from "./organizer";
import { sanitizeFolder, sanitizeFileName } from "./organizer";

interface Row {
  item: ClassifiedItem;
  checkbox: HTMLInputElement;
  folderInput: HTMLInputElement;
}

export class PreviewModal extends Modal {
  private rows: Row[] = [];

  constructor(
    app: App,
    private items: ClassifiedItem[],
    private onApply: (items: ClassifiedItem[]) => Promise<void>
  ) {
    super(app);
  }

  onOpen() {
    const { contentEl } = this;
    this.titleEl.setText("整理预览");
    contentEl.empty();
    this.rows = [];

    contentEl.createEl("p", {
      text: `共 ${this.items.length} 篇笔记。可修改目标文件夹（留空 = 不移动），取消勾选 = 跳过该笔记，确认后点「应用」。`,
      cls: "aon-desc",
    });

    const list = contentEl.createDiv({ cls: "aon-list" });

    for (const item of this.items) {
      const rowEl = list.createEl("div", { cls: "aon-row" });

      const cb = rowEl.createEl("input", { type: "checkbox" });
      cb.checked = true;

      const body = rowEl.createDiv({ cls: "aon-row-text" });
      body.createEl("div", { text: item.path, cls: "aon-path" });

      const edit = body.createEl("div", { cls: "aon-edit-row" });
      const folderInput = edit.createEl("input", {
        type: "text",
        cls: "aon-folder-input",
      });
      folderInput.value = item.targetFolder;
      folderInput.placeholder = "留空则不移动";

      if (item.tags.length) {
        edit.createEl("span", {
          text: item.tags.map((t) => `#${t}`).join(" "),
          cls: "aon-tags",
        });
      }

      this.rows.push({ item, checkbox: cb, folderInput });
    }

    const footer = contentEl.createDiv({ cls: "aon-footer" });
    const applyBtn = footer.createEl("button", { text: "应用", cls: "mod-cta" });
    const cancelBtn = footer.createEl("button", { text: "取消" });

    applyBtn.addEventListener("click", async () => {
      const selected: ClassifiedItem[] = [];
      for (const row of this.rows) {
        if (!row.checkbox.checked) continue;
        selected.push({ ...row.item, targetFolder: sanitizeFolder(row.folderInput.value) });
      }
      if (selected.length === 0) {
        new Notice("没有勾选任何笔记");
        return;
      }
      applyBtn.setText("应用中…");
      applyBtn.disabled = true;
      try {
        await this.onApply(selected);
        this.close();
      } catch (e) {
        new Notice("应用失败: " + (e instanceof Error ? e.message : String(e)));
        applyBtn.setText("应用");
        applyBtn.disabled = false;
      }
    });

    cancelBtn.addEventListener("click", () => this.close());
  }

  onClose() {
    this.contentEl.empty();
  }
}

interface RenameRow {
  item: RenameSuggestion;
  checkbox: HTMLInputElement;
  input: HTMLInputElement;
}

export class RenameModal extends Modal {
  private rows: RenameRow[] = [];

  constructor(
    app: App,
    private items: RenameSuggestion[],
    private onApply: (items: RenameSuggestion[]) => Promise<void>
  ) {
    super(app);
  }

  onOpen() {
    const { contentEl } = this;
    this.titleEl.setText("重命名预览");
    contentEl.empty();
    this.rows = [];

    contentEl.createEl("p", {
      text: `共 ${this.items.length} 篇笔记。可修改新标题，取消勾选 = 跳过，确认后点「应用」。`,
      cls: "aon-desc",
    });

    const list = contentEl.createDiv({ cls: "aon-list" });

    for (const item of this.items) {
      const rowEl = list.createEl("div", { cls: "aon-row" });
      const cb = rowEl.createEl("input", { type: "checkbox" });
      cb.checked = true;

      const body = rowEl.createDiv({ cls: "aon-row-text" });
      body.createEl("div", { text: item.file.basename, cls: "aon-path" });

      const edit = body.createEl("div", { cls: "aon-edit-row" });
      const input = edit.createEl("input", {
        type: "text",
        cls: "aon-folder-input",
      });
      input.value = item.newBasename;
      input.placeholder = "新标题（不含 .md）";

      this.rows.push({ item, checkbox: cb, input });
    }

    const footer = contentEl.createDiv({ cls: "aon-footer" });
    const applyBtn = footer.createEl("button", { text: "应用", cls: "mod-cta" });
    const cancelBtn = footer.createEl("button", { text: "取消" });

    applyBtn.addEventListener("click", async () => {
      const selected: RenameSuggestion[] = [];
      for (const row of this.rows) {
        if (!row.checkbox.checked) continue;
        selected.push({ ...row.item, newBasename: sanitizeFileName(row.input.value) });
      }
      if (selected.length === 0) {
        new Notice("没有勾选任何笔记");
        return;
      }
      applyBtn.setText("应用中…");
      applyBtn.disabled = true;
      try {
        await this.onApply(selected);
        this.close();
      } catch (e) {
        new Notice("重命名失败: " + (e instanceof Error ? e.message : String(e)));
        applyBtn.setText("应用");
        applyBtn.disabled = false;
      }
    });

    cancelBtn.addEventListener("click", () => this.close());
  }

  onClose() {
    this.contentEl.empty();
  }
}
