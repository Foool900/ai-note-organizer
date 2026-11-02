import { requestUrl } from "obsidian";
import type { AiNoteOrganizerSettings } from "./settings";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/**
 * 调用 OpenAI 兼容的 /chat/completions 接口。
 * 适用于 DeepSeek、硅基流动、OpenAI、Moonshot 等。
 */
export async function chatCompletion(
  settings: AiNoteOrganizerSettings,
  messages: ChatMessage[]
): Promise<string> {
  const base = settings.baseUrl.replace(/\/+$/, "");
  const url = `${base}/chat/completions`;

  const response = await requestUrl({
    url,
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${settings.apiKey}`,
    },
    body: JSON.stringify({
      model: settings.model,
      messages,
      temperature: 0.2,
      stream: false,
    }),
    throw: false,
  });

  if (response.status < 200 || response.status >= 300) {
    const detail = response.text ?? JSON.stringify(response.json ?? {});
    throw new Error(`HTTP ${response.status}: ${detail}`);
  }

  const data = response.json as any;
  const content = data?.choices?.[0]?.message?.content;
  if (!content || typeof content !== "string") {
    throw new Error("接口返回里没有文本内容: " + JSON.stringify(data).slice(0, 500));
  }
  return content;
}
