import { App, TFile, TFolder, normalizePath } from "obsidian";
import { chatCompletion } from "./ai";
import { sanitizeFileName, parseJsonLoose } from "./organizer";
import type { AiNoteOrganizerSettings } from "./settings";

export interface GeneratedCard {
  front: string;
  back: string;
  source: string;
}

export interface Flashcard {
  file: TFile;
  front: string;
  back: string;
  source: string;
  due: string; // "YYYY-MM-DD"
  interval: number;
  ease: number;
  reps: number;
}

export type Grade = "again" | "hard" | "good" | "easy";

const CARDS_SYSTEM_PROMPT = `你是一名学习助手。根据给定的笔记内容，抽取 3~8 个最适合做成闪卡的知识点，每个做成「问题 → 答案」的问答对。要求：
1. 问题要具体、能独立回答；答案要准确、简洁。
2. 代码、公式等保留原样。
3. 只输出 JSON，格式：{"cards":[{"front":"问题","back":"答案"}]}`;

export class FlashcardManager {
  constructor(
    private app: App,
    private getSettings: () => AiNoteOrganizerSettings
  ) {}

  deckFolder(): string {
    return this.getSettings().deckFolder || "闪卡";
  }

  async generateCards(
    files: TFile[],
    onProgress?: (done: number, total: number) => void
  ): Promise<GeneratedCard[]> {
    const settings = this.getSettings();
    if (!settings.apiKey) throw new Error("请先在插件设置里填写 API Key");
    if (!settings.baseUrl) throw new Error("请先在插件设置里填写接口地址");
    if (!settings.model) throw new Error("请先在插件设置里填写模型名");

    const results: GeneratedCard[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const content = (await this.app.vault.cachedRead(file)).slice(0, 6000);
      const raw = await chatCompletion(settings, [
        { role: "system", content: CARDS_SYSTEM_PROMPT },
        {
          role: "user",
          content: `笔记标题：${file.basename}\n内容：\n${content || "(空)"}`,
        },
      ]);
      const parsed = parseJsonLoose(raw);
      const cards: any[] = Array.isArray(parsed?.cards) ? parsed.cards : [];
      for (const c of cards) {
        const front = String(c?.front ?? "").trim();
        const back = String(c?.back ?? "").trim();
        if (front && back) results.push({ front, back, source: file.basename });
      }
      onProgress?.(i + 1, files.length);
    }
    return results;
  }

  async saveCards(cards: GeneratedCard[]): Promise<number> {
    const folder = this.deckFolder();
    await this.ensureFolder(folder);
    const today = toDateStr(new Date());
    let saved = 0;
    for (const c of cards) {
      const name = (sanitizeFileName(c.front) || "卡片").slice(0, 50);
      const path = await this.resolveAvailablePath(folder, `${name}.md`);
      const content = buildCardContent(c, {
        due: today,
        interval: 0,
        ease: 2.5,
        reps: 0,
      });
      await this.app.vault.create(path, content);
      saved++;
    }
    return saved;
  }

  async scanDeck(): Promise<Flashcard[]> {
    const folder = this.app.vault.getAbstractFileByPath(this.deckFolder());
    if (!(folder instanceof TFolder)) return [];
    const cards: Flashcard[] = [];
    for (const child of folder.children) {
      if (!(child instanceof TFile) || child.extension !== "md") continue;
      const cache = this.app.metadataCache.getFileCache(child);
      const fm = cache?.frontmatter;
      if (!fm || fm.type !== "flashcard") continue;
      const raw = await this.app.vault.read(child);
      const { front, back } = parseCardBody(stripFrontmatter(raw));
      cards.push({
        file: child,
        front,
        back,
        source: String(fm.source ?? ""),
        due: String(fm.due ?? ""),
        interval: Number(fm.interval ?? 0),
        ease: Number(fm.ease ?? 2.5),
        reps: Number(fm.reps ?? 0),
      });
    }
    return cards;
  }

  async getDueCards(): Promise<Flashcard[]> {
    const today = toDateStr(new Date());
    const cards = await this.scanDeck();
    return cards
      .filter((c) => !c.due || c.due <= today)
      .sort((a, b) => a.due.localeCompare(b.due));
  }

  async gradeCard(card: Flashcard, grade: Grade): Promise<void> {
    const today = toDateStr(new Date());
    const s = schedule(card.interval, card.ease, card.reps, grade, today);
    await this.app.fileManager.processFrontMatter(card.file, (fm) => {
      fm.due = s.due;
      fm.interval = s.interval;
      fm.ease = s.ease;
      fm.reps = s.reps;
    });
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

function buildCardContent(
  c: GeneratedCard,
  s: { due: string; interval: number; ease: number; reps: number }
): string {
  return `---
type: flashcard
source: "${c.source}"
due: "${s.due}"
interval: ${s.interval}
ease: ${s.ease}
reps: ${s.reps}
---

${c.front}

---

${c.back}
`;
}

function stripFrontmatter(raw: string): string {
  return raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
}

function parseCardBody(body: string): { front: string; back: string } {
  const idx = body.search(/\r?\n---\r?\n/);
  if (idx === -1) return { front: body.trim(), back: "" };
  const front = body.slice(0, idx).trim();
  const back = body.slice(idx).replace(/^\r?\n---\r?\n/, "").trim();
  return { front, back };
}

function schedule(
  interval: number,
  ease: number,
  reps: number,
  grade: Grade,
  today: string
): { interval: number; ease: number; reps: number; due: string } {
  const q = { again: 0, hard: 3, good: 4, easy: 5 }[grade];
  let newInterval = interval;
  let newReps = reps;

  if (q < 3) {
    newReps = 0;
    newInterval = 1;
  } else {
    if (newReps === 0) newInterval = 1;
    else if (newReps === 1) newInterval = 6;
    else newInterval = Math.round(newInterval * ease);
    if (grade === "hard") newInterval = Math.max(1, Math.round(newInterval * 1.2));
    if (grade === "easy") newInterval = Math.round(newInterval * 1.4);
    newReps += 1;
  }

  const newEase = Math.max(1.3, ease + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)));
  const due = addDaysStr(today, newInterval);
  return {
    interval: newInterval,
    ease: Math.round(newEase * 100) / 100,
    reps: newReps,
    due,
  };
}

export function toDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function addDaysStr(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(y, m - 1, d + n);
  return toDateStr(dt);
}
