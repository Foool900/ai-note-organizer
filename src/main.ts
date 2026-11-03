import {
  App,
  FuzzySuggestModal,
  MarkdownView,
  Notice,
  Plugin,
  TFile,
  TFolder,
} from "obsidian";
import {
  AiNoteOrganizerSettings,
  DEFAULT_SETTINGS,
  SettingsTab,
} from "./settings";
import { Organizer } from "./organizer";
import type { AppliedOperation } from "./organizer";
import { PreviewModal, RenameModal } from "./previewModal";
import { chatCompletion } from "./ai";
import type { ChatMessage } from "./ai";
import { VaultChat } from "./chat";
import { ChatView, CHAT_VIEW_TYPE } from "./chatView";
import { DashboardView, DASHBOARD_VIEW_TYPE } from "./dashboardView";
import { ProgressBar } from "./progress";
import { FlashcardManager, toDateStr, addDaysStr } from "./flashcards";
import { ReviewModal } from "./reviewModal";
import { CardPreviewModal } from "./cardPreviewModal";
import { CardEditModal, CardManagerModal } from "./cardManager";
import { WriteOpModal, WritePreviewModal, writeOpDef } from "./writeModal";
import type { WriteOp } from "./writeModal";
import { KnowledgeReview, ReviewRangeModal } from "./review";

interface PluginData {
  settings?: AiNoteOrganizerSettings;
  undoLog?: AppliedOperation[] | null;
  reviewStats?: ReviewStats;
}

interface ReviewStats {
  totalReviewed: number;
  lastReviewDate: string;
  streak: number;
}

export default class AiNoteOrganizerPlugin extends Plugin {
  settings: AiNoteOrganizerSettings;
  private organizer: Organizer;
  private vaultChat: VaultChat;
  private progress: ProgressBar;
  private flashcards: FlashcardManager;
  private review: KnowledgeReview;
  private reviewStats: ReviewStats = { totalReviewed: 0, lastReviewDate: "", streak: 0 };
  private undoLog: AppliedOperation[] | null = null;

  async onload() {
    await this.loadSettings();
    this.organizer = new Organizer(this.app, () => this.settings);
    this.vaultChat = new VaultChat(this.app, () => this.settings);
    this.progress = new ProgressBar(this);
    this.flashcards = new FlashcardManager(this.app, () => this.settings);
    this.review = new KnowledgeReview(this.app, () => this.settings);

    this.addSettingTab(new SettingsTab(this.app, this));

    this.registerView(CHAT_VIEW_TYPE, (leaf) => new ChatView(leaf, this));
    this.addRibbonIcon("message-circle", "AI 问答", () => this.activateChatView());

    this.registerView(DASHBOARD_VIEW_TYPE, (leaf) => new DashboardView(leaf, this));
    this.addRibbonIcon("bar-chart-3", "库概览", () => this.activateDashboard());
    this.addRibbonIcon("layers", "复习闪卡", () => this.startReview());

    this.addCommand({
      id: "organize-current-note",
      name: "整理当前笔记",
      callback: () => this.organizeFiles(this.currentFiles()),
    });

    this.addCommand({
      id: "organize-vault",
      name: "整理整个库",
      callback: () => this.organizeFiles(this.vaultFiles()),
    });

    this.addCommand({
      id: "organize-folder",
      name: "整理指定文件夹…",
      callback: () => this.pickFolder(),
    });

    this.addCommand({
      id: "undo-last-organize",
      name: "撤销上次整理",
      callback: () => this.undoLast(),
    });

    this.addCommand({
      id: "summarize-current-note",
      name: "为当前笔记生成摘要",
      callback: () => this.summarizeFiles(this.currentFiles()),
    });

    this.addCommand({
      id: "retitle-current-note",
      name: "为当前笔记重命名（AI 起标题）",
      callback: () => this.retitleFiles(this.currentFiles()),
    });

    this.addCommand({
      id: "link-current-note",
      name: "为当前笔记添加相关链接",
      callback: () => this.linkFiles(this.currentFiles()),
    });

    this.addCommand({
      id: "generate-moc",
      name: "生成 MOC 索引页…",
      callback: () => this.pickFolderForMoc(),
    });

    this.addCommand({
      id: "open-chat",
      name: "打开 AI 问答面板",
      callback: () => this.activateChatView(),
    });

    this.addCommand({
      id: "open-dashboard",
      name: "打开库概览",
      callback: () => this.activateDashboard(),
    });

    this.addCommand({
      id: "generate-flashcards",
      name: "为当前笔记生成闪卡",
      callback: () => this.generateFlashcards(this.currentFiles()),
    });

    this.addCommand({
      id: "start-review",
      name: "开始复习闪卡",
      callback: () => this.startReview(),
    });

    this.addCommand({
      id: "add-flashcard",
      name: "添加闪卡",
      callback: () => this.addCard(),
    });

    this.addCommand({
      id: "manage-flashcards",
      name: "管理闪卡",
      callback: () => this.openCardManager(),
    });

    this.addCommand({
      id: "ai-write",
      name: "AI 改写 / 续写…",
      callback: () => this.openWriteMenu(),
    });

    this.addCommand({
      id: "generate-review",
      name: "生成知识回顾",
      callback: () => this.generateReview(),
    });

    this.registerEvent(
      this.app.workspace.on("file-menu", (menu, file) => {
        if (file instanceof TFile && file.extension === "md") {
          const selected = this.getSelectedFiles();
          const files = selected.length > 0 ? selected : [file];

          menu.addItem((item) => {
            item
              .setTitle(
                files.length > 1
                  ? `AI 整理选中的笔记（${files.length} 篇）`
                  : "AI 整理此笔记"
              )
              .setIcon("sparkles")
              .onClick(() => this.organizeFiles(files));
          });

          menu.addItem((item) => {
            item
              .setTitle(
                files.length > 1
                  ? `AI 生成摘要（${files.length} 篇）`
                  : "AI 生成摘要"
              )
              .setIcon("file-text")
              .onClick(() => this.summarizeFiles(files));
          });

          menu.addItem((item) => {
            item
              .setTitle(
                files.length > 1
                  ? `AI 重命名（起标题，${files.length} 篇）`
                  : "AI 重命名（起标题）"
              )
              .setIcon("pencil")
              .onClick(() => this.retitleFiles(files));
          });

          menu.addItem((item) => {
            item
              .setTitle(
                files.length > 1
                  ? `AI 添加相关链接（${files.length} 篇）`
                  : "AI 添加相关链接"
              )
              .setIcon("link")
              .onClick(() => this.linkFiles(files));
          });

          menu.addItem((item) => {
            item
              .setTitle(
                files.length > 1
                  ? `AI 生成闪卡（${files.length} 篇）`
                  : "AI 生成闪卡"
              )
              .setIcon("layers")
              .onClick(() => this.generateFlashcards(files));
          });
        } else if (file instanceof TFolder) {
          const folderFiles = () =>
            this.app.vault
              .getMarkdownFiles()
              .filter(
                (f) =>
                  f.path.startsWith(file.path + "/") && !this.isHidden(f.path)
              );

          menu.addItem((item) => {
            item
              .setTitle("AI 整理此文件夹")
              .setIcon("sparkles")
              .onClick(() => this.organizeFiles(folderFiles()));
          });

          menu.addItem((item) => {
            item
              .setTitle("AI 生成此文件夹摘要")
              .setIcon("file-text")
              .onClick(() => this.summarizeFiles(folderFiles()));
          });

          menu.addItem((item) => {
            item
              .setTitle("AI 重命名此文件夹内笔记")
              .setIcon("pencil")
              .onClick(() => this.retitleFiles(folderFiles()));
          });

          menu.addItem((item) => {
            item
              .setTitle("AI 为此文件夹内笔记添加相关链接")
              .setIcon("link")
              .onClick(() => this.linkFiles(folderFiles()));
          });

          menu.addItem((item) => {
            item
              .setTitle("AI 生成 MOC 索引页")
              .setIcon("map")
              .onClick(() => this.mocForFolder(file as TFolder));
          });

          menu.addItem((item) => {
            item
              .setTitle("AI 为此文件夹生成闪卡")
              .setIcon("layers")
              .onClick(() => this.generateFlashcards(folderFiles()));
          });
        }
      })
    );

    this.registerEvent(
      this.app.workspace.on("editor-menu", (menu, _editor, view) => {
        const file = view.file;
        if (!(file instanceof TFile) || file.extension !== "md") return;

        menu.addItem((item) => {
          item
            .setTitle("AI 整理此笔记")
            .setIcon("sparkles")
            .onClick(() => this.organizeFiles([file]));
        });
        menu.addItem((item) => {
          item
            .setTitle("AI 生成摘要")
            .setIcon("file-text")
            .onClick(() => this.summarizeFiles([file]));
        });
        menu.addItem((item) => {
          item
            .setTitle("AI 重命名（起标题）")
            .setIcon("pencil")
            .onClick(() => this.retitleFiles([file]));
        });
        menu.addItem((item) => {
          item
            .setTitle("AI 添加相关链接")
            .setIcon("link")
            .onClick(() => this.linkFiles([file]));
        });
        menu.addItem((item) => {
          item
            .setTitle("AI 生成闪卡")
            .setIcon("layers")
            .onClick(() => this.generateFlashcards([file]));
        });
        menu.addSeparator();
        menu.addItem((item) => {
          item
            .setTitle("AI 改写 / 续写…")
            .setIcon("pen-tool")
            .onClick(() => this.openWriteMenu());
        });
      })
    );
  }

  async loadSettings() {
    const raw = await this.loadData();
    const data = raw as PluginData | AiNoteOrganizerSettings | null;
    if (data && typeof data === "object" && "settings" in data) {
      this.settings = Object.assign({}, DEFAULT_SETTINGS, (data as PluginData).settings);
      this.undoLog = (data as PluginData).undoLog ?? null;
      this.reviewStats = (data as PluginData).reviewStats ?? {
        totalReviewed: 0,
        lastReviewDate: "",
        streak: 0,
      };
    } else {
      this.settings = Object.assign({}, DEFAULT_SETTINGS, (data as AiNoteOrganizerSettings) ?? {});
      this.undoLog = null;
      this.reviewStats = { totalReviewed: 0, lastReviewDate: "", streak: 0 };
    }
  }

  async saveSettings() {
    const data: PluginData = {
      settings: this.settings,
      undoLog: this.undoLog,
      reviewStats: this.reviewStats,
    };
    await this.saveData(data);
  }

  async testConnection(): Promise<void> {
    if (!this.settings.apiKey) throw new Error("请先填写 API Key");
    await chatCompletion(this.settings, [
      { role: "user", content: "只回复两个字：OK" },
    ]);
  }

  async activateChatView() {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(CHAT_VIEW_TYPE)[0];
    if (!leaf) {
      leaf = workspace.getRightLeaf(false)!;
      await leaf.setViewState({ type: CHAT_VIEW_TYPE, active: true });
    }
    workspace.revealLeaf(leaf);
  }

  async activateDashboard() {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(DASHBOARD_VIEW_TYPE)[0];
    if (!leaf) {
      leaf = workspace.getRightLeaf(false)!;
      await leaf.setViewState({ type: DASHBOARD_VIEW_TYPE, active: true });
    }
    workspace.revealLeaf(leaf);
  }

  async organizeCurrentNote() {
    await this.organizeFiles(this.currentFiles());
  }

  async organizeVault() {
    await this.organizeFiles(this.vaultFiles());
  }

  organizeFolder() {
    this.pickFolder();
  }

  async generateFlashcards(files: TFile[]) {
    files = files.filter((f) => f.extension === "md");
    if (files.length === 0) {
      new Notice("没有可处理的笔记");
      return;
    }
    if (!this.settings.apiKey) {
      new Notice("请先在「设置 → AI 笔记整理」里填写 API Key");
      return;
    }

    this.progress.show("生成闪卡");
    try {
      const cards = await this.flashcards.generateCards(files, (done, total) =>
        this.progress.update(done, total)
      );
      this.progress.hide();
      if (cards.length === 0) {
        new Notice("没有生成任何卡片");
        return;
      }
      new CardPreviewModal(this.app, this.flashcards, cards, () => {}).open();
    } catch (e) {
      this.progress.hide();
      new Notice("生成闪卡失败: " + (e instanceof Error ? e.message : String(e)), 10000);
      console.error(e);
    }
  }

  async startReview() {
    const due = await this.flashcards.getDueCards();
    if (due.length === 0) {
      new Notice("今天没有到期的闪卡 🎉");
      return;
    }
    new ReviewModal(this.app, this.flashcards, due, {
      getStats: () => ({
        totalReviewed: this.reviewStats.totalReviewed,
        streak: this.reviewStats.streak,
      }),
      onGrade: () => this.recordReview(),
    }).open();
  }

  private recordReview() {
    const today = toDateStr(new Date());
    const s = this.reviewStats;
    if (s.lastReviewDate !== today) {
      s.streak = s.lastReviewDate === addDaysStr(today, -1) ? s.streak + 1 : 1;
      s.lastReviewDate = today;
    }
    s.totalReviewed++;
    this.saveSettings();
  }

  async getDueCount(): Promise<number> {
    return (await this.flashcards.getDueCards()).length;
  }

  async addCard() {
    new CardEditModal(this.app, this.flashcards, null, () => {}).open();
  }

  async openCardManager() {
    new CardManagerModal(this.app, this.flashcards, () => {}, () => this.startReview()).open();
  }

  async generateReview() {
    if (!this.settings.apiKey) {
      new Notice("请先在「设置 → AI 笔记整理」里填写 API Key");
      return;
    }
    new ReviewRangeModal(this.app, async (days) => {
      this.progress.show("生成知识回顾");
      try {
        const { markdown } = await this.review.generate(days);
        const folder = "回顾";
        if (!this.app.vault.getAbstractFileByPath(folder)) {
          await this.app.vault.createFolder(folder);
        }
        const date = toDateStr(new Date());
        let path = `${folder}/${date} 知识回顾.md`;
        if (this.app.vault.getAbstractFileByPath(path)) {
          for (let i = 2; ; i++) {
            const p = `${folder}/${date} 知识回顾 ${i}.md`;
            if (!this.app.vault.getAbstractFileByPath(p)) {
              path = p;
              break;
            }
          }
        }
        const file = await this.app.vault.create(path, markdown);
        this.progress.hide();
        const leaf = this.app.workspace.getLeaf(false);
        await leaf.openFile(file);
      } catch (e) {
        this.progress.hide();
        new Notice("生成知识回顾失败: " + (e instanceof Error ? e.message : String(e)), 10000);
        console.error(e);
      }
    }).open();
  }

  private openWriteMenu() {
    new WriteOpModal(this.app, (op) => this.writeWithAI(op)).open();
  }

  private async writeWithAI(op: WriteOp) {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view) {
      new Notice("请先打开一篇笔记");
      return;
    }
    const editor = view.editor;
    const opDef = writeOpDef(op);

    let inputText: string;
    if (op === "continue") {
      const cursor = editor.getCursor();
      const start = { line: Math.max(0, cursor.line - 40), ch: 0 };
      inputText = editor.getRange(start, cursor).trim();
      if (!inputText) {
        new Notice("光标前没有内容可续写");
        return;
      }
    } else {
      inputText = editor.getSelection().trim();
      if (!inputText) {
        new Notice("请先选中要处理的文字");
        return;
      }
    }

    if (!this.settings.apiKey) {
      new Notice("请先在「设置 → AI 笔记整理」里填写 API Key");
      return;
    }

    this.progress.show(opDef.label);
    try {
      const result = await chatCompletion(this.settings, [
        { role: "system", content: opDef.system },
        { role: "user", content: `文本：\n${inputText.slice(0, 4000)}` },
      ]);
      this.progress.hide();
      new WritePreviewModal(this.app, result.trim(), (text) => {
        if (op === "continue") {
          editor.replaceRange(text, editor.getCursor(), editor.getCursor());
        } else {
          editor.replaceSelection(text);
        }
      }).open();
    } catch (e) {
      this.progress.hide();
      new Notice("AI 写作失败: " + (e instanceof Error ? e.message : String(e)), 10000);
      console.error(e);
    }
  }

  async askVault(question: string, history: ChatMessage[]): Promise<string> {
    return this.vaultChat.ask(question, history);
  }

  private currentFiles(): TFile[] {
    const f = this.app.workspace.getActiveFile();
    return f ? [f] : [];
  }

  private vaultFiles(): TFile[] {
    return this.app.vault.getMarkdownFiles().filter((f) => !this.isHidden(f.path));
  }

  private isHidden(path: string): boolean {
    return path.split("/").some((seg) => seg.startsWith("."));
  }

  private getSelectedFiles(): TFile[] {
    const files: TFile[] = [];
    document
      .querySelectorAll(".tree-item-self.is-selected[data-path]")
      .forEach((el) => {
        const path = el.getAttribute("data-path");
        if (!path) return;
        const f = this.app.vault.getAbstractFileByPath(path);
        if (f instanceof TFile && f.extension === "md") files.push(f);
      });
    return files;
  }

  private pickFolder() {
    new FolderSuggestModal(this.app, (folderPath) => {
      const files = this.app.vault
        .getMarkdownFiles()
        .filter((f) => f.path.startsWith(folderPath + "/") && !this.isHidden(f.path));
      this.organizeFiles(files);
    }).open();
  }

  private async organizeFiles(files: TFile[]) {
    if (files.length === 0) {
      new Notice("没有可整理的笔记");
      return;
    }
    if (!this.settings.apiKey) {
      new Notice("请先在「设置 → AI 笔记整理」里填写 API Key");
      return;
    }

    this.progress.show("整理分类");
    try {
      const items = await this.organizer.classify(files, (done, total) =>
        this.progress.update(done, total)
      );
      this.progress.hide();
      if (items.length === 0) {
        new Notice("没有生成任何分类结果");
        return;
      }
      new PreviewModal(this.app, items, async (selected) => {
        const result = await this.organizer.apply(selected);
        this.undoLog = result.operations;
        await this.saveSettings();
        new Notice(
          `完成：移动 ${result.moved} 篇，加标签 ${result.tagged} 篇` +
            (result.skipped ? `，失败 ${result.skipped} 篇` : "")
        );
      }).open();
    } catch (e) {
      this.progress.hide();
      new Notice("整理失败: " + (e instanceof Error ? e.message : String(e)), 10000);
      console.error(e);
    }
  }

  private async summarizeFiles(files: TFile[]) {
    files = files.filter((f) => f.extension === "md");
    if (files.length === 0) {
      new Notice("没有可处理的笔记");
      return;
    }
    if (!this.settings.apiKey) {
      new Notice("请先在「设置 → AI 笔记整理」里填写 API Key");
      return;
    }

    this.progress.show("生成摘要");
    try {
      const res = await this.organizer.summarize(files, (done, total) => {
        this.progress.update(done, total);
      });
      this.progress.hide();
      new Notice(
        `完成：已写摘要 ${res.written} 篇${res.failed ? `，失败 ${res.failed} 篇` : ""}`
      );
    } catch (e) {
      this.progress.hide();
      new Notice("生成摘要失败: " + (e instanceof Error ? e.message : String(e)), 10000);
      console.error(e);
    }
  }

  private async retitleFiles(files: TFile[]) {
    files = files.filter((f) => f.extension === "md");
    if (files.length === 0) {
      new Notice("没有可处理的笔记");
      return;
    }
    if (!this.settings.apiKey) {
      new Notice("请先在「设置 → AI 笔记整理」里填写 API Key");
      return;
    }

    this.progress.show("生成标题");
    try {
      const suggestions = await this.organizer.suggestTitles(files, (done, total) => {
        this.progress.update(done, total);
      });
      this.progress.hide();
      if (suggestions.length === 0) {
        new Notice("没有生成任何标题建议");
        return;
      }
      new RenameModal(this.app, suggestions, async (selected) => {
        const res = await this.organizer.renameFiles(selected);
        new Notice(
          `完成：重命名 ${res.renamed} 篇` +
            (res.skipped ? `，跳过 ${res.skipped} 篇` : "") +
            (res.failed ? `，失败 ${res.failed} 篇` : "")
        );
      }).open();
    } catch (e) {
      this.progress.hide();
      new Notice("生成标题失败: " + (e instanceof Error ? e.message : String(e)), 10000);
      console.error(e);
    }
  }

  private async linkFiles(files: TFile[]) {
    files = files.filter((f) => f.extension === "md");
    if (files.length === 0) {
      new Notice("没有可处理的笔记");
      return;
    }
    if (!this.settings.apiKey) {
      new Notice("请先在「设置 → AI 笔记整理」里填写 API Key");
      return;
    }

    this.progress.show("添加相关链接");
    try {
      const res = await this.organizer.linkRelated(files, (done, total) => {
        this.progress.update(done, total);
      });
      this.progress.hide();
      new Notice(
        `完成：处理 ${res.notes} 篇，添加 ${res.links} 条相关链接` +
          (res.failed ? `，失败 ${res.failed} 篇` : "")
      );
    } catch (e) {
      this.progress.hide();
      new Notice("添加链接失败: " + (e instanceof Error ? e.message : String(e)), 10000);
      console.error(e);
    }
  }

  private pickFolderForMoc() {
    new FolderSuggestModal(this.app, (folderPath) => {
      const folder = this.app.vault.getAbstractFileByPath(folderPath);
      if (folder instanceof TFolder) this.mocForFolder(folder);
    }).open();
  }

  private async mocForFolder(folder: TFolder) {
    if (!this.settings.apiKey) {
      new Notice("请先在「设置 → AI 笔记整理」里填写 API Key");
      return;
    }
    this.progress.show("生成 MOC");
    try {
      const file = await this.organizer.generateMoc(folder);
      this.progress.hide();
      new Notice(`已生成：${file.path}`);
    } catch (e) {
      this.progress.hide();
      new Notice("生成 MOC 失败: " + (e instanceof Error ? e.message : String(e)), 10000);
      console.error(e);
    }
  }

  private async undoLast() {
    if (!this.undoLog || this.undoLog.length === 0) {
      new Notice("没有可撤销的整理操作");
      return;
    }
    const ops = [...this.undoLog].reverse();
    const notice = new Notice("正在撤销…", 0);
    try {
      const res = await this.organizer.undo(ops);
      notice.hide();
      this.undoLog = null;
      await this.saveSettings();
      new Notice(
        `已撤销：还原 ${res.movedBack} 篇，移除标签 ${res.tagsRemoved} 篇` +
          (res.skipped ? `，跳过 ${res.skipped} 篇` : "")
      );
    } catch (e) {
      notice.hide();
      new Notice("撤销失败: " + (e instanceof Error ? e.message : String(e)), 10000);
      console.error(e);
    }
  }
}

class FolderSuggestModal extends FuzzySuggestModal<TFolder> {
  constructor(app: App, private onChoose: (path: string) => void) {
    super(app);
  }

  getItems(): TFolder[] {
    return this.app.vault
      .getAllLoadedFiles()
      .filter((f): f is TFolder => f instanceof TFolder && f.path !== "/");
  }

  getItemText(item: TFolder): string {
    return item.path;
  }

  onChooseItem(item: TFolder): void {
    this.onChoose(item.path);
  }
}
