import { App, TFile, TFolder, getAllTags, normalizePath } from "obsidian";
import { chatCompletion } from "./ai";
import type { AiNoteOrganizerSettings } from "./settings";

export interface NoteRecord {
  id: number;
  file: TFile;
  path: string;
  title: string;
  content: string;
}

export interface ClassifiedItem {
  id: number;
  file: TFile;
  path: string;
  name: string;
  currentFolder: string;
  targetFolder: string; // "" 表示不移动
  tags: string[];
}

export interface AppliedOperation {
  originalPath: string;
  newPath: string;
  moved: boolean;
  addedTags: string[];
}

export interface RenameSuggestion {
  file: TFile;
  newBasename: string;
}

const MAX_CONTENT_LEN = 2000;
const BATCH_SIZE = 20;

const SYSTEM_PROMPT = `你是一名专业的笔记整理助手。你会收到一个笔记库的「现有文件夹列表」和「现有标签列表」，以及一批待整理的笔记（每篇含唯一 id、文件路径、标题、内容）。

你的任务：为每篇笔记判断一个最合适的「目标文件夹」和 1~4 个「分类标签」。

规则：
1. 尽量复用现有文件夹和标签，保持结构一致；若确实没有合适的，可新建语义清晰、简短的文件夹或标签。
2. 目标文件夹用 / 分隔层级，例如「学习/编程/Python」。如果笔记放在根目录即可，folder 设为空字符串 ""。
3. 标签不要带 # 前缀，用小写短词（中文标签则用简短中文词），1~4 个。
4. 只输出一个 JSON 对象，不要输出任何解释文字，格式：
{"items":[{"id":0,"folder":"目标文件夹","tags":["标签1","标签2"]}]}`;

const SUMMARY_SYSTEM_PROMPT = `你是一名笔记摘要助手。根据笔记标题和内容，写一句简洁的中文摘要（不超过 40 字），概括这篇笔记的核心内容。只输出摘要本身，不要任何解释、引号或前缀。`;

const TITLE_SYSTEM_PROMPT = `你是一名笔记标题助手。根据笔记的当前标题和内容，起一个简洁、准确的中文标题（15 字以内），能概括这篇笔记的主题。不要带文件扩展名、标点符号或序号前缀，只输出标题本身。`;

const LINK_SYSTEM_PROMPT = `你是一名知识关联助手。给定一篇目标笔记，以及库中其他笔记的标题和开头摘要，找出与目标笔记内容最相关的 3~6 篇笔记，用于在目标笔记里建立双链。只输出 JSON，格式：{"ids":[序号1,序号2,...]}，序号按相关度从高到低排列。`;

const MOC_SYSTEM_PROMPT = `你是一名知识库整理助手。根据给定文件夹里的笔记列表，生成一个 MOC（Map of Content）索引页。要求：
1. 用 markdown 输出，以一级标题（# 文件夹名）开头。
2. 写一句简短说明。
3. 把笔记按主题分组（二级标题 ## 分组名），每组列出相关笔记，每篇用「- [[标题]]：一句说明」的形式。
4. 直接输出 markdown 正文，不要用代码块包裹。`;

export class Organizer {
  constructor(
    private app: App,
    private getSettings: () => AiNoteOrganizerSettings
  ) {}

  async classify(
    files: TFile[],
    onProgress?: (done: number, total: number) => void
  ): Promise<ClassifiedItem[]> {
    const records: NoteRecord[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const content = (await this.app.vault.cachedRead(file)).slice(0, MAX_CONTENT_LEN);
      records.push({
        id: i,
        file,
        path: file.path,
        title: file.basename,
        content,
      });
    }

    const folders = this.collectFolders();
    const tags = this.collectTags();

    const results: ClassifiedItem[] = [];
    for (let start = 0; start < records.length; start += BATCH_SIZE) {
      const batch = records.slice(start, start + BATCH_SIZE);
      results.push(...(await this.classifyBatch(batch, folders, tags)));
      onProgress?.(Math.min(start + BATCH_SIZE, records.length), records.length);
    }
    return results;
  }

  private collectFolders(): string[] {
    const folders: string[] = [];
    for (const f of this.app.vault.getAllLoadedFiles()) {
      if (f instanceof TFolder && f.path !== "/") folders.push(f.path);
    }
    return folders;
  }

  private collectTags(): string[] {
    const set = new Set<string>();
    for (const file of this.app.vault.getMarkdownFiles()) {
      const cache = this.app.metadataCache.getFileCache(file);
      if (!cache) continue;
      const tags = getAllTags(cache);
      if (tags) for (const t of tags) set.add(t.replace(/^#/, ""));
    }
    return [...set].filter((t) => t.length > 0);
  }

  private async classifyBatch(
    records: NoteRecord[],
    folders: string[],
    tags: string[]
  ): Promise<ClassifiedItem[]> {
    const settings = this.getSettings();
    if (!settings.apiKey) throw new Error("请先在插件设置里填写 API Key");
    if (!settings.baseUrl) throw new Error("请先在插件设置里填写接口地址");
    if (!settings.model) throw new Error("请先在插件设置里填写模型名");

    const categories = parseCategories(settings.categories);

    const content = await chatCompletion(settings, [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: buildUserPrompt(records, folders, tags, categories) },
    ]);

    const parsed = parseJsonLoose(content);
    const rawItems: any[] = parsed?.items ?? [];
    if (!Array.isArray(rawItems)) throw new Error("AI 返回格式不正确，缺少 items 数组");

    const byId = new Map<number, any>();
    for (const it of rawItems) {
      const id = Number(it?.id);
      if (!Number.isNaN(id)) byId.set(id, it);
    }

    return records.map((rec) => {
      const raw = byId.get(rec.id) ?? {};
      const targetFolder = sanitizeFolder(String(raw.folder ?? ""));
      const rawTags: string[] = Array.isArray(raw.tags)
        ? (raw.tags as any[]).map((t) => String(t))
        : [];
      const cleanTags = rawTags.map(sanitizeTag).filter((t) => t.length > 0);
      return {
        id: rec.id,
        file: rec.file,
        path: rec.path,
        name: rec.file.name,
        currentFolder: rec.file.parent?.path ?? "",
        targetFolder,
        tags: dedupe(cleanTags),
      };
    });
  }

  async apply(
    items: ClassifiedItem[]
  ): Promise<{
    moved: number;
    tagged: number;
    skipped: number;
    operations: AppliedOperation[];
  }> {
    let moved = 0;
    let tagged = 0;
    let skipped = 0;
    const operations: AppliedOperation[] = [];
    for (const item of items) {
      try {
        let file: TFile = item.file;
        const originalPath = item.path;
        let newPath = item.path;
        let didMove = false;

        if (item.targetFolder && item.targetFolder !== item.currentFolder) {
          await this.ensureFolder(item.targetFolder);
          newPath = await this.resolveAvailablePath(item.targetFolder, item.name);
          await this.app.vault.rename(file, newPath);
          file = this.app.vault.getAbstractFileByPath(newPath) as TFile;
          didMove = true;
          moved++;
        }

        let addedTags: string[] = [];
        if (item.tags.length > 0) {
          addedTags = await this.addTags(file, item.tags);
          if (addedTags.length > 0) tagged++;
        }

        if (didMove || addedTags.length > 0) {
          operations.push({ originalPath, newPath, moved: didMove, addedTags });
        }
      } catch (e) {
        console.error("apply failed for", item.path, e);
        skipped++;
      }
    }
    return { moved, tagged, skipped, operations };
  }

  /** 合并标签，返回本次实际新增的标签（用于撤销时精确移除）。 */
  private async addTags(file: TFile, newTags: string[]): Promise<string[]> {
    let added: string[] = [];
    await this.app.fileManager.processFrontMatter(file, (fm) => {
      let existing: string[] = [];
      const t = fm.tags;
      if (Array.isArray(t)) existing = t.map((x) => String(x));
      else if (typeof t === "string")
        existing = t
          .split(/[,，]/)
          .map((s) => s.trim())
          .filter(Boolean);
      added = newTags.filter((tag) => !existing.includes(tag));
      if (added.length > 0) fm.tags = dedupe([...existing, ...added]);
    });
    return added;
  }

  async undo(
    operations: AppliedOperation[]
  ): Promise<{ movedBack: number; tagsRemoved: number; skipped: number }> {
    let movedBack = 0;
    let tagsRemoved = 0;
    let skipped = 0;
    for (const op of operations) {
      try {
        let file = this.getFileAt(op.newPath) ?? this.getFileAt(op.originalPath);
        if (!file) {
          skipped++;
          continue;
        }

        if (op.moved && op.newPath !== op.originalPath) {
          const target = await this.resolveUndoPath(op.originalPath);
          if (target) {
            await this.app.vault.rename(file, target);
            file = this.app.vault.getAbstractFileByPath(target) as TFile;
            movedBack++;
          }
        }

        if (op.addedTags.length > 0) {
          await this.app.fileManager.processFrontMatter(file, (fm) => {
            let existing: string[] = [];
            const t = fm.tags;
            if (Array.isArray(t)) existing = t.map((x) => String(x));
            else if (typeof t === "string")
              existing = t
                .split(/[,，]/)
                .map((s) => s.trim())
                .filter(Boolean);
            const toRemove = new Set(op.addedTags);
            const remaining = existing.filter((tag) => !toRemove.has(tag));
            if (remaining.length === 0) delete fm.tags;
            else fm.tags = remaining;
          });
          tagsRemoved++;
        }
      } catch (e) {
        console.error("undo failed for", op.newPath, e);
        skipped++;
      }
    }
    return { movedBack, tagsRemoved, skipped };
  }

  async summarize(
    files: TFile[],
    onProgress?: (done: number, total: number) => void
  ): Promise<{ written: number; failed: number }> {
    const settings = this.getSettings();
    if (!settings.apiKey) throw new Error("请先在插件设置里填写 API Key");
    if (!settings.baseUrl) throw new Error("请先在插件设置里填写接口地址");
    if (!settings.model) throw new Error("请先在插件设置里填写模型名");

    let written = 0;
    let failed = 0;
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      try {
        const content = (await this.app.vault.cachedRead(file)).slice(0, MAX_CONTENT_LEN);
        const summary = await chatCompletion(settings, [
          { role: "system", content: SUMMARY_SYSTEM_PROMPT },
          {
            role: "user",
            content: `笔记标题：${file.basename}\n内容：\n${content || "(空)"}`,
          },
        ]);
        await this.app.fileManager.processFrontMatter(file, (fm) => {
          fm.summary = summary.trim();
        });
        written++;
      } catch (e) {
        console.error("summarize failed for", file.path, e);
        failed++;
      }
      onProgress?.(i + 1, files.length);
    }
    return { written, failed };
  }

  async suggestTitles(
    files: TFile[],
    onProgress?: (done: number, total: number) => void
  ): Promise<RenameSuggestion[]> {
    const settings = this.getSettings();
    if (!settings.apiKey) throw new Error("请先在插件设置里填写 API Key");
    if (!settings.baseUrl) throw new Error("请先在插件设置里填写接口地址");
    if (!settings.model) throw new Error("请先在插件设置里填写模型名");

    const results: RenameSuggestion[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const content = (await this.app.vault.cachedRead(file)).slice(0, MAX_CONTENT_LEN);
      const title = await chatCompletion(settings, [
        { role: "system", content: TITLE_SYSTEM_PROMPT },
        {
          role: "user",
          content: `当前标题：${file.basename}\n内容：\n${content || "(空)"}`,
        },
      ]);
      results.push({ file, newBasename: sanitizeFileName(title) });
      onProgress?.(i + 1, files.length);
    }
    return results;
  }

  async renameFiles(
    items: RenameSuggestion[]
  ): Promise<{ renamed: number; skipped: number; failed: number }> {
    let renamed = 0;
    let skipped = 0;
    let failed = 0;
    for (const it of items) {
      try {
        const clean = sanitizeFileName(it.newBasename);
        if (!clean || clean === it.file.basename) {
          skipped++;
          continue;
        }
        const folder = it.file.parent?.path ?? "";
        const newPath = await this.resolveAvailablePath(folder, clean + ".md");
        await this.app.vault.rename(it.file, newPath);
        renamed++;
      } catch (e) {
        console.error("rename failed for", it.file.path, e);
        failed++;
      }
    }
    return { renamed, skipped, failed };
  }

  async linkRelated(
    files: TFile[],
    onProgress?: (done: number, total: number) => void
  ): Promise<{ notes: number; links: number; failed: number }> {
    const settings = this.getSettings();
    if (!settings.apiKey) throw new Error("请先在插件设置里填写 API Key");
    if (!settings.baseUrl) throw new Error("请先在插件设置里填写接口地址");
    if (!settings.model) throw new Error("请先在插件设置里填写模型名");

    const isHidden = (p: string) => p.split("/").some((seg) => seg.startsWith("."));
    const all = this.app.vault.getMarkdownFiles().filter((f) => !isHidden(f.path));

    // 候选池（标题 + 开头摘要）只构建一次，供所有目标复用
    const candidates: { file: TFile; excerpt: string }[] = [];
    for (const f of all.slice(0, 500)) {
      const excerpt = (await this.app.vault.cachedRead(f))
        .replace(/\s+/g, " ")
        .slice(0, 120);
      candidates.push({ file: f, excerpt });
    }

    let notes = 0;
    let links = 0;
    let failed = 0;
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      try {
        const content = (await this.app.vault.cachedRead(file)).slice(0, MAX_CONTENT_LEN);
        const cands = candidates.filter((c) => c.file.path !== file.path);
        const raw = await chatCompletion(settings, [
          { role: "system", content: LINK_SYSTEM_PROMPT },
          { role: "user", content: buildLinkPrompt(file, content, cands) },
        ]);
        const parsed = parseJsonLoose(raw);
        const ids: number[] = Array.isArray(parsed?.ids)
          ? parsed.ids.map((n: any) => Number(n))
          : [];
        const related = dedupe(ids)
          .filter((n) => Number.isInteger(n) && n >= 0 && n < cands.length)
          .slice(0, 6)
          .map((n) => cands[n].file);

        if (related.length > 0) {
          await this.updateRelatedSection(file, related);
          links += related.length;
        }
        notes++;
      } catch (e) {
        console.error("linkRelated failed for", file.path, e);
        failed++;
      }
      onProgress?.(i + 1, files.length);
    }
    return { notes, links, failed };
  }

  /** 在笔记末尾写入（或刷新）「相关笔记」小节。 */
  private async updateRelatedSection(file: TFile, related: TFile[]): Promise<void> {
    const content = await this.app.vault.read(file);
    const heading = "## 相关笔记";
    const lines = content.split(/\r?\n/);
    const out: string[] = [];
    let inSection = false;
    for (const line of lines) {
      if (/^#{1,3}\s+(相关笔记|相关链接|Related)\s*$/i.test(line)) {
        inSection = true;
        continue;
      }
      if (inSection && /^#{1,3}\s+/.test(line)) {
        inSection = false;
      }
      if (!inSection) out.push(line);
    }
    const body = out.join("\n").replace(/\n+$/, "");
    const links = related.map((f) => `- [[${f.basename}]]`).join("\n");
    await this.app.vault.modify(file, `${body}\n\n${heading}\n\n${links}\n`);
  }

  async generateMoc(folder: TFolder): Promise<TFile> {
    const settings = this.getSettings();
    if (!settings.apiKey) throw new Error("请先在插件设置里填写 API Key");
    if (!settings.baseUrl) throw new Error("请先在插件设置里填写接口地址");
    if (!settings.model) throw new Error("请先在插件设置里填写模型名");

    const isHidden = (p: string) => p.split("/").some((seg) => seg.startsWith("."));
    const prefix = folder.path === "/" ? "" : folder.path + "/";
    const files = this.app.vault
      .getMarkdownFiles()
      .filter((f) => f.path.startsWith(prefix) && !isHidden(f.path));

    if (files.length === 0) throw new Error("该文件夹下没有笔记");

    const notes: { file: TFile; summary: string }[] = [];
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
      notes.push({ file: f, summary });
    }

    const listText = notes
      .map((n) => `标题：${n.file.basename}\n摘要：${n.summary || "(无)"}`)
      .join("\n\n");
    const raw = await chatCompletion(settings, [
      { role: "system", content: MOC_SYSTEM_PROMPT },
      {
        role: "user",
        content: `文件夹：${folder.name}\n\n笔记列表：\n\n${listText}`,
      },
    ]);
    const md = stripFence(raw.trim());

    const folderPath = folder.path === "/" ? "" : folder.path;
    const targetPath = await this.resolveAvailablePath(folderPath, `${folder.name} MOC.md`);
    return await this.app.vault.create(targetPath, md);
  }

  private getFileAt(path: string): TFile | null {
    const f = this.app.vault.getAbstractFileByPath(path);
    return f instanceof TFile ? f : null;
  }

  private async resolveUndoPath(originalPath: string): Promise<string | null> {
    if (this.app.vault.getAbstractFileByPath(originalPath)) return null; // 原路径已被占用，跳过
    const dir = originalPath.split("/").slice(0, -1).join("/");
    if (dir) await this.ensureFolder(dir);
    return normalizePath(originalPath);
  }

  private async ensureFolder(path: string): Promise<void> {
    const segments = path.split("/").filter(Boolean);
    let cur = "";
    for (const seg of segments) {
      cur = cur ? `${cur}/${seg}` : seg;
      if (!this.app.vault.getAbstractFileByPath(cur)) {
        await this.app.vault.createFolder(cur);
      }
    }
  }

  private async resolveAvailablePath(folder: string, name: string): Promise<string> {
    const candidate = normalizePath(`${folder}/${name}`);
    if (!this.app.vault.getAbstractFileByPath(candidate)) return candidate;
    const dot = name.lastIndexOf(".");
    const base = dot > 0 ? name.slice(0, dot) : name;
    const ext = dot > 0 ? name.slice(dot) : "";
    for (let i = 2; ; i++) {
      const p = normalizePath(`${folder}/${base} ${i}${ext}`);
      if (!this.app.vault.getAbstractFileByPath(p)) return p;
    }
  }
}

function buildUserPrompt(
  records: NoteRecord[],
  folders: string[],
  tags: string[],
  categories: string[]
): string {
  const categorySection = categories.length
    ? `必须使用的分类体系（每篇笔记必须归入其中一个作为顶层文件夹，可加子文件夹，但不要新建这些之外的其他顶层分类）：
${categories.map((c) => `- ${c}`).join("\n")}

`
    : "";
  const folderList = folders.length
    ? folders.map((f) => `- ${f}`).join("\n")
    : "（当前没有文件夹，可自行规划）";
  const tagList = tags.length ? tags.slice(0, 200).join(", ") : "（当前没有标签，可自行创建）";

  const notes = records
    .map(
      (r) =>
        `[${r.id}] 路径: ${r.path}\n标题: ${r.title}\n内容:\n${r.content || "(空)"}`
    )
    .join("\n\n---\n\n");

  return `${categorySection}现有文件夹：
${folderList}

现有标签：
${tagList}

待整理笔记：
${notes}`;
}

function buildLinkPrompt(
  file: TFile,
  content: string,
  cands: { file: TFile; excerpt: string }[]
): string {
  const candidateLines = cands
    .map((c, idx) => `[${idx}] ${c.file.basename}：${c.excerpt}`)
    .join("\n");
  return `目标笔记：
标题：${file.basename}
内容：
${content || "(空)"}

候选笔记（其他笔记的标题和开头摘要）：
${candidateLines}`;
}

function stripFence(s: string): string {
  const m = s.match(/^```(?:markdown|md)?\s*\n?([\s\S]*?)\n?```\s*$/i);
  return m ? m[1].trim() : s;
}

export function parseJsonLoose(text: string): any {
  let s = text.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  try {
    return JSON.parse(s);
  } catch {
    /* fall through */
  }
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(s.slice(start, end + 1));
    } catch {
      /* fall through */
    }
  }
  throw new Error("无法解析 AI 返回的 JSON");
}

export function sanitizeFolder(s: string): string {
  return s
    .replace(/[\\:*?"<>|]/g, "")
    .replace(/^\/+|\/+$/g, "")
    .replace(/\/+/g, "/")
    .replace(/^\.+/, "")
    .trim();
}

export function sanitizeFileName(s: string): string {
  return s
    .replace(/[\\/:*?"<>|]/g, "")
    .replace(/[\r\n]+/g, " ")
    .replace(/\.+$/, "")
    .trim()
    .slice(0, 80);
}

export function sanitizeTag(s: string): string {
  return s.replace(/^#+/, "").replace(/[#[\]\n]/g, "").trim();
}

function dedupe<T>(arr: T[]): T[] {
  return [...new Set(arr)];
}

function parseCategories(s: string): string[] {
  return dedupe(
    s
      .split(/\r?\n/)
      .map((x) => x.trim())
      .filter((x) => x.length > 0)
  );
}
