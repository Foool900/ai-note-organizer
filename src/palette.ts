// 色盲安全的分类色板（浅色 / 深色各 8 档，固定顺序，不循环）。
// 用于「身份」类着色（分组、标签点），文本永远自带标签，颜色只是辅助。
export const CATEGORICAL_LIGHT = [
  "#2a78d6", "#eb6834", "#1baf7a", "#eda100",
  "#e87ba4", "#008300", "#4a3aa7", "#e34948",
];

export const CATEGORICAL_DARK = [
  "#3987e5", "#d95926", "#199e70", "#c98500",
  "#d55181", "#008300", "#9085e9", "#e66767",
];

/** 稳定地把一个字符串映射到某个色板档位（同一实体永远同一色，与排序无关）。 */
export function colorIndex(key: string): number {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0;
  return Math.abs(h) % CATEGORICAL_LIGHT.length;
}

export function isDark(): boolean {
  return document.body.classList.contains("theme-dark");
}

export function colorFor(key: string): string {
  const arr = isDark() ? CATEGORICAL_DARK : CATEGORICAL_LIGHT;
  return arr[colorIndex(key)];
}
