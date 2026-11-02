import { Plugin } from "obsidian";

/** 底部状态栏里的可视进度条。 */
export class ProgressBar {
  private el: HTMLElement;
  private label: HTMLElement;
  private bar: HTMLProgressElement;
  private count: HTMLElement;

  constructor(plugin: Plugin) {
    this.el = plugin.addStatusBarItem();
    this.el.addClass("aon-progress");
    this.label = this.el.createSpan({ cls: "aon-progress-label" });
    this.bar = this.el.createEl("progress", { cls: "aon-progress-bar" });
    this.bar.max = 100;
    this.count = this.el.createSpan({ cls: "aon-progress-count" });
    this.el.style.display = "none";
  }

  /** 显示；未调用 update 前为不确定进度（来回滚动）。 */
  show(label: string) {
    this.label.setText(label);
    this.count.setText("");
    this.bar.removeAttribute("value");
    this.el.style.display = "flex";
  }

  update(done: number, total: number) {
    this.bar.value = total > 0 ? (done / total) * 100 : 0;
    this.count.setText(`${done}/${total}`);
  }

  hide() {
    this.el.style.display = "none";
  }
}
