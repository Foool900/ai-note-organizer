import {
  App,
  FuzzySuggestModal,
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

interface PluginData {
  settings?: AiNoteOrganizerSettings;
  undoLog?: AppliedOperation[] | null;
}

export default class AiNoteOrganizerPlugin extends Plugin {
  settings: AiNoteOrganizerSettings;
  private organizer: Organizer;
  private vaultChat: VaultChat;
  private progress: ProgressBar;
  private undoLog: AppliedOperation[] | null = null;

  async onload() {
    await this.loadSettings();
    this.organizer = new Organizer(this.app, () => this.settings);
    this.vaultChat = new VaultChat(this.app, () => this.settings);
    this.progress = new ProgressBar(this);

    this.addSettingTab(new SettingsTab(this.app, this));

    this.registerView(CHAT_VIEW_TYPE, (leaf) => new ChatView(leaf, this));
    this.addRibbonIcon("message-circle", "AI 问答", () => this.activateChatView());

    this.registerView(DASHBOARD_VIEW_TYPE, (leaf) => new DashboardView(leaf, this));
    this.addRibbonIcon("bar-chart-3", "库概览", () => this.activateDashboard());

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
        }
      })
    );
  }

  async loadSettings() {
    const raw = await this.loadData();
    const data = raw as PluginData | AiNoteOrganizerSettings | null;
    if (data && typeof data === "object" && "settings" in data) {
      this.settings = Object.assign({}, DEFAULT_SETTINGS, (data as PluginData).settings);
      this.undoLog = (data as PluginData).undoLog ?? null;
    } else {
      this.settings = Object.assign({}, DEFAULT_SETTINGS, (data as AiNoteOrganizerSettings) ?? {});
      this.undoLog = null;
    }
  }

  async saveSettings() {
    const data: PluginData = { settings: this.settings, undoLog: this.undoLog };
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
