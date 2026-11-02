import { App, Modal, Notice } from "obsidian";
import type { ClassifiedItem, RenameSuggestion } from "./organizer";
import { sanitizeFolder, sanitizeFileName, sanitizeTag } from "./organizer";
import { colorFor } from "./palette";

interface Row {
  item: ClassifiedItem;
  checkbox: HTMLInputElement;
  folderInput: HTMLInputElement;
  tags: string[];
  chipsEl: HTMLElement;
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

    const moveCount = this.items.filter(
      (i) => i.targetFolder && i.targetFolder !== i.currentFolder
    ).length;
    contentEl.createEl("p", {
      text: `共 ${this.items.length} 篇 · 移动 ${moveCount} 篇 · 不移动 ${
        this.items.length - moveCount
      } 篇。可改目标文件夹（留空 = 不移动），取消勾选 = 跳过。`,
      cls: "aon-desc",
    });

    const list = contentEl.createDiv({ cls: "aon-list" });

    // 按目标文件夹分组
    const groups = new Map<string, ClassifiedItem[]>();
    for (const item of this.items) {
      const key =
        item.targetFolder && item.targetFolder !== item.currentFolder
          ? item.targetFolder
          : "不移动";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(item);
    }
    const order = [...groups.keys()].sort((a, b) => {
      if (a === "不移动") return 1;
      if (b === "不移动") return -1;
      return a.localeCompare(b, "zh");
    });

    for (const key of order) {
      const items = groups.get(key)!;
      const groupEl = list.createDiv({ cls: "aon-group" });
      groupEl.style.setProperty(
        "--group-accent",
        key === "不移动" ? "var(--text-muted)" : colorFor(key)
      );

      const header = groupEl.createDiv({ cls: "aon-group-header" });
      header.createSpan({ cls: "aon-dot" });
      header.createSpan({ text: key });
      header.createSpan({ cls: "aon-group-count", text: `${items.length} 篇` });

      for (const item of items) {
        const rowEl = groupEl.createDiv({ cls: "aon-row" });
        const cb = rowEl.createEl("input", { type: "checkbox" });
        cb.checked = true;

        const body = rowEl.createDiv({ cls: "aon-row-text" });
        body.createEl("div", { text: item.path, cls: "aon-path" });

        const edit = body.createDiv({ cls: "aon-edit-row" });
        const folderInput = edit.createEl("input", {
          type: "text",
          cls: "aon-folder-input",
        });
        folderInput.value = item.targetFolder;
        folderInput.placeholder = "留空则不移动";

        const chipsEl = body.createDiv({ cls: "aon-tagcloud aon-tag-edit" });
        const tags = [...item.tags];
        const renderChips = () => {
          chipsEl.empty();
          for (const t of tags) {
            const chip = chipsEl.createSpan({ cls: "aon-chip aon-chip-removable" });
            chip.createSpan({ text: t });
            const x = chip.createSpan({ cls: "aon-chip-x", text: "×" });
            x.addEventListener("click", () => {
              const i = tags.indexOf(t);
              if (i >= 0) tags.splice(i, 1);
              renderChips();
            });
          }
          const add = chipsEl.createEl("input", {
            type: "text",
            cls: "aon-tag-add",
            placeholder: "添加标签后回车",
          });
          add.addEventListener("keydown", (e) => {
            if (e.key === "Enter" && !e.isComposing) {
              const v = sanitizeTag(add.value);
              if (v && !tags.includes(v)) {
                tags.push(v);
                renderChips();
              }
            }
          });
        };
        renderChips();

        this.rows.push({ item, checkbox: cb, folderInput, tags, chipsEl });
      }
    }

    const footer = contentEl.createDiv({ cls: "aon-footer" });
    const applyBtn = footer.createEl("button", { text: "应用", cls: "mod-cta" });
    const cancelBtn = footer.createEl("button", { text: "取消" });

    applyBtn.addEventListener("click", async () => {
      const selected: ClassifiedItem[] = [];
      for (const row of this.rows) {
        if (!row.checkbox.checked) continue;
        selected.push({
          ...row.item,
          targetFolder: sanitizeFolder(row.folderInput.value),
          tags: row.tags,
        });
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
