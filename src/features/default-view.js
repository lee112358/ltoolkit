/* 打开笔记时按核心设置里的默认视图，不让上一篇的模式跟过来。
 *
 * Obsidian 的视图模式是**跟着标签页走的**：核心设置里那个「默认视图模式」只在
 * 标签页新建时用一次，之后这个标签页是什么模式就一直是什么模式。同一个标签页
 * 里切到下一篇，上一篇留下的模式照单全收——把 A 切进编辑视图，再从文件浏览器
 * 点开 B，B 也是编辑视图，尽管你的默认视图设的是阅读。
 *
 * 开着「预览标签页」时这件事格外明显：浏览本来就都在同一个标签页里进行，
 * 一旦有一次切进编辑，后面浏览的每一篇都成了编辑视图。
 *
 * 所以这里只做一件事：每次打开笔记，把它按回默认视图。
 *
 * 不记任何东西。「这篇我想一直用编辑视图」那种按笔记记忆的做法试过，不值得：
 * 切模式没有对应的工作区事件（Cmd+E 走 MarkdownView.toggleMode，
 * 视图头上那颗按钮又是另一份实现），要认出「是你切的还是我切的」得靠盯
 * DOM 属性和一堆时序判断，而收益只是省掉一次 Cmd+E。标签页只要开着就不会
 * 自己换模式，正在写的那篇本来就稳稳待在它自己的标签页里——配上「预览标签页」
 * 更是如此：你一编辑它就转正，后面的浏览会另开预览页，不会来打扰它。
 */

import { Component } from "obsidian";

export const ID = "defaultView";

export class DefaultView extends Component {
	constructor(app, plugin) {
		super();
		this.app = app;
		this.plugin = plugin;
	}

	onload() {
		this.registerEvent(this.app.workspace.on("file-open", () => this.apply()));
	}

	async apply() {
		try {
			// 从侧边栏点开时焦点还在文件浏览器上，取主区域最近活跃的那个才准
			const view = this.app.workspace.getMostRecentLeaf()?.view;
			if (view?.getViewType() !== "markdown" || !view.file) return;

			const want = this.defaultMode();
			if (view.getMode() === want) return; // 新建的标签页本来就是默认视图，不用动

			/* 只改 mode 一个字段。state 里还有 source（源码模式还是实时预览）
			 * 和 backlinks 之类，整个换掉会把它们一起抹平。 */
			const state = view.leaf.getViewState();
			state.state = { ...state.state, mode: want };
			await view.leaf.setViewState(state);
		} catch (err) {
			console.error("[ltoolkit] 切换默认视图失败", err);
		}
	}

	/* 核心设置里的「默认视图模式」。读不到就按 Obsidian 自己的出厂值算成阅读。 */
	defaultMode() {
		const value = this.app.vault.getConfig?.("defaultViewMode");
		return value === "source" ? "source" : "preview";
	}
}
