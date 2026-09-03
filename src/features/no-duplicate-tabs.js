/* 同一标签组里不重复打开同一个文件。
 *
 * 一个窗口里把同一篇笔记开出两份是 Obsidian 的默认行为，不是 bug —— 它开文件时
 * 只关心「哪个标签页可以被替换」（getLeaf(false) → getUnpinnedLeaf），从不检查
 * 这个文件是不是已经开着了。
 *
 * 这里在 file-open 之后补一道检查：同组已经有标签页开着它，就切过去用那个，
 * 把刚打开的这一个让位 —— 有历史就退回上一篇（连带滚动位置一起恢复，走的是
 * Obsidian 自己存在历史条目里的 eState），是新建出来的就直接关掉。
 *
 * 只在同一个标签组内去重。左右分栏对照看同一篇是正当用法，不该拦。
 */

import { Component } from "obsidian";

export const ID = "noDuplicateTabs";

export class NoDuplicateTabs extends Component {
	constructor(app, plugin) {
		super();
		this.app = app;
		this.plugin = plugin;
		/* 让位这几步自己会触发 file-open，用它挡住重入 */
		this.settling = false;
	}

	onload() {
		this.registerEvent(this.app.workspace.on("file-open", () => this.onFileOpen()));
	}

	async onFileOpen() {
		if (this.settling) return;
		try {
			await this.dedupe();
		} catch (err) {
			console.error("[ltoolkit] 标签页去重失败", err);
		}
	}

	async dedupe() {
		// 从侧边栏点开时焦点还在文件浏览器上，取主区域最近活跃的那个才准
		const leaf = this.app.workspace.getMostRecentLeaf();
		const path = leaf?.view?.file?.path;
		if (!path) return;

		const siblings = leaf.parent?.children;
		if (!Array.isArray(siblings)) return;

		const twin = siblings.find((other) => other !== leaf && other.view?.file?.path === path);
		if (!twin) return;

		this.settling = true;
		try {
			if (leaf.history?.backHistory?.length > 0) await leaf.history.back();
			else leaf.detach();

			await this.app.workspace.revealLeaf(twin);
			this.app.workspace.setActiveLeaf(twin, { focus: true });
		} finally {
			// 让上面这几步触发的 file-open 先走完，再放开重入
			window.setTimeout(() => (this.settling = false), 0);
		}
	}
}
