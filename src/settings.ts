import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import type AiNoteOrganizerPlugin from "./main";

export interface AiNoteOrganizerSettings {
  apiKey: string;
  baseUrl: string;
  model: string;
  categories: string;
}

export const PROVIDERS = [
  {
    name: "DeepSeek",
    baseUrl: "https://api.deepseek.com/v1",
    model: "deepseek-chat",
  },
  {
    name: "硅基流动 (SiliconFlow)",
    baseUrl: "https://api.siliconflow.cn/v1",
    model: "deepseek-ai/DeepSeek-V3",
  },
  {
    name: "自定义",
    baseUrl: "",
    model: "",
  },
] as const;

export const DEFAULT_SETTINGS: AiNoteOrganizerSettings = {
  apiKey: "",
  baseUrl: PROVIDERS[0].baseUrl,
  model: PROVIDERS[0].model,
  categories: "",
};

export class SettingsTab extends PluginSettingTab {
  plugin: AiNoteOrganizerPlugin;

  constructor(app: App, plugin: AiNoteOrganizerPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "AI 笔记整理 · 设置" });

    new Setting(containerEl)
      .setName("服务商")
      .setDesc("选择 API 服务商，会自动填入默认的接口地址和模型名。")
      .addDropdown((dd) => {
        for (const p of PROVIDERS) dd.addOption(p.name, p.name);
        const current = PROVIDERS.find((p) => p.baseUrl === this.plugin.settings.baseUrl);
        dd.setValue(current ? current.name : "自定义");
        dd.onChange(async (value) => {
          const p = PROVIDERS.find((x) => x.name === value);
          if (p && p.baseUrl) {
            this.plugin.settings.baseUrl = p.baseUrl;
            this.plugin.settings.model = p.model;
            await this.plugin.saveSettings();
            this.display();
          }
        });
      });

    new Setting(containerEl)
      .setName("接口地址 (Base URL)")
      .setDesc("OpenAI 兼容接口地址，例如 https://api.deepseek.com/v1")
      .addText((t) =>
        t
          .setPlaceholder("https://api.deepseek.com/v1")
          .setValue(this.plugin.settings.baseUrl)
          .onChange(async (v) => {
            this.plugin.settings.baseUrl = v.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("模型 (Model)")
      .setDesc("模型名称，例如 deepseek-chat 或 deepseek-ai/DeepSeek-V3")
      .addText((t) =>
        t
          .setPlaceholder("deepseek-chat")
          .setValue(this.plugin.settings.model)
          .onChange(async (v) => {
            this.plugin.settings.model = v.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("API Key")
      .setDesc("你的云 API Key。密钥会明文保存在本地插件数据文件 data.json 中，请勿分享该文件。")
      .addText((t) => {
        t.inputEl.type = "password";
        t.setPlaceholder("sk-...")
          .setValue(this.plugin.settings.apiKey)
          .onChange(async (v) => {
            this.plugin.settings.apiKey = v.trim();
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("分类体系（可选）")
      .setDesc(
        "每行一个分类，作为笔记的顶层文件夹。留空则由 AI 自行判断。填写后 AI 只会把你指定的这些分类作为顶层文件夹（可加子文件夹）。例如：\n学习\n工作\n生活\n编程"
      )
      .addTextArea((ta) => {
        ta.setPlaceholder("学习\n工作\n生活\n编程")
          .setValue(this.plugin.settings.categories)
          .onChange(async (v) => {
            this.plugin.settings.categories = v;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("测试连接")
      .setDesc("发送一条极短请求，验证接口地址、模型和 Key 是否可用。")
      .addButton((btn) =>
        btn.setButtonText("测试").onClick(async () => {
          btn.setButtonText("测试中…");
          btn.setDisabled(true);
          try {
            await this.plugin.testConnection();
            new Notice("✅ 连接成功，接口可用");
          } catch (e) {
            new Notice("❌ 连接失败: " + (e instanceof Error ? e.message : String(e)));
          } finally {
            btn.setButtonText("测试");
            btn.setDisabled(false);
          }
        })
      );
  }
}
