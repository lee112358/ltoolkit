/* Option + 点击 → 固定在同一个侧栏里打开，永远只多出一个标签组。
 *
 * Obsidian 自带的 Option+Cmd+点击是「新建分栏」，它每次都**再劈一刀**：
 * 点三次就是四个标签组。想要「左边清单、右边跟着换」这种看法，官方的办法是
 * 把左边那个标签页固定住 —— 固定之后它 canNavigate() 为假，Obsidian 找不到
 * 能用的标签页，就会去找另一个没被固定的，于是落到右边并复用它。
 *
 * 能用，但别扭在两处：得先手动分栏、再记得去固定；而且固定是**标签页的状态**，
 * 你在左边想临时跳走一下都不行，得先解除固定。
 *
 * 这个功能把那套行为收进一个修饰键：按住 Option 点，就走「侧栏」这条路；
 * 不按，一切照旧。不用固定任何标签页。
 *
 * ── 为什么补丁打在 getLeaf 上 ────────────────────
 *
 * Obsidian 决定「在哪打开」只有一个岔路口：
 *
 *   Workspace.prototype.getLeaf(kind)
 *     "split"  → splitActiveLeaf()        再劈一刀
 *     "tab"    → createLeafInTabGroup()   新标签页
 *     "window" → openPopoutLeaf()         新窗口
 *     其它     → getUnpinnedLeaf()        复用当前这个（或另一个没固定的）
 *
 * 而 kind 是各处点击自己算出来的，算法都是 Keymap.isModEvent(evt)：Cmd 给
 * "tab"，Cmd+Option 给 "split"，**单按 Option 它返回 false** —— 也就是掉进
 * 最后那条「复用当前这个」。所以单按 Option 本来什么也不做，这个键是空的，
 * 拿来用不抢别人的。
 *
 * 点链接、点文件树、点搜索结果、点书签、点 Bases 表格里的文件名，最后都汇到
 * getLeaf。补在这里一处就够，不用去认每种点击各自的处理函数。
 *
 * ── 怎么知道这一次是按着 Option 点的 ─────────────
 *
 * getLeaf 只收到一个 kind，看不见鼠标事件。所以在捕获阶段先记一笔：
 *
 *   捕获阶段的 click（比 Obsidian 的处理函数早）→ 记下「这一拨要走侧栏」
 *   → Obsidian 的处理函数跑 → 调 getLeaf → 我们认出标记，交出侧栏标签页
 *   → setTimeout(0) 把标记抹掉
 *
 * 靠的是 click 这一整串处理是**同步**跑完的：捕获、冒泡、openLinkText、
 * getLeaf 全在同一个任务里，排在 setTimeout(0) 前面。所以标记不会漏到下一次
 * 点击，也不会被别处顺手调的 getLeaf 捡走。
 *
 * ── 只认链接和文件项 ─────────────────────────────
 *
 * 编辑器里 Option+点击是 CodeMirror 的多光标，那个不能抢。所以先看这一下点在
 * 什么上面：是链接或文件项才记标记，点在正文上直接放行，多光标照旧。
 *
 * ── 侧栏是「认领」来的，不是每次新建 ─────────────
 *
 * 记着上次用的那个标签页，还活着就继续用它 —— 这是「右边跟着换」的关键。
 * 它被关掉之后按这个顺序找下一个：
 *
 *   1. 主编辑区里已经有别的标签组 → 认领它，不再劈
 *   2. 只有一个标签组 → 这时才劈一刀
 *
 * 第 1 条是为了「不要三四个标签组」：你手动分过栏，它就用你分好的那个。
 *
 * ── 焦点默认不跟过去 ─────────────────────────────
 *
 * 留在左边才能接着点下一行，这是「清单 + 预览」这种看法的重点。想让焦点跟
 * 过去的，把「点击后切到侧栏」打开。
 */

import { Component } from "obsidian";

export const ID = "sidePreview";

/* 点在这些东西上才算「要打开一篇笔记」。正文里的普通文字不在其中，
 * 于是编辑器的 Option+点击多光标不受影响。 */
const OPENERS = [
	"a",
	".internal-link",
	"[data-href]",
	".nav-file-title",
	".tree-item-self",
	".search-result-file-title",
	".bookmark-item",
].join(",");

export class SidePreview extends Component {
	constructor(app, plugin) {
		super();
		this.app = app;
		this.plugin = plugin;
		/* 这一拨点击要走侧栏。只在一个 click 的同步处理期间为真 */
		this.routing = false;
		/* 上次用的侧栏标签页；被关掉了就重新认领 */
		this.side = null;
		/* 点击发生时的那个标签页，用来把焦点还回去 */
		this.origin = null;
	}

	onload() {
		this.registerDomEvent(document, "click", (e) => this.onClick(e), { capture: true });
		this.app.workspace.onLayoutReady(() => this.patchGetLeaf());
	}

	onClick(e) {
		if (!e.altKey || e.metaKey || e.ctrlKey || e.shiftKey) return;
		if (e.button !== 0) return;
		if (!e.target?.closest?.(OPENERS)) return;

		this.routing = true;
		this.origin = this.app.workspace.activeLeaf ?? null;
		/* click 的整串处理是同步的，排在这个 0 毫秒之前跑完 */
		window.setTimeout(() => {
			this.routing = false;
			this.origin = null;
		}, 0);
	}

	patchGetLeaf() {
		const workspace = this.app.workspace;
		const proto = Object.getPrototypeOf(workspace);
		const original = proto.getLeaf;
		if (typeof original !== "function") {
			console.error("[ltoolkit] 侧栏预览未生效：取不到 Workspace.getLeaf");
			return;
		}

		this.original = original;
		const self = this;

		const patched = function (...args) {
			if (!self.routing) return original.apply(this, args);
			/* 一次点击只接管第一次 getLeaf。之后若功能内部还要劈栏，
			 * 走的是 self.original，不会再绕回来 */
			self.routing = false;
			try {
				const leaf = self.resolve();
				if (leaf) {
					self.restoreFocusLater();
					return leaf;
				}
			} catch (err) {
				console.error("[ltoolkit] 侧栏预览失败，按默认方式打开", err);
			}
			return original.apply(this, args);
		};

		proto.getLeaf = patched;
		this.register(() => {
			if (proto.getLeaf !== patched) return; // 别人后来又打了补丁，不动
			proto.getLeaf = original;
		});
	}

	/* 这次该用哪个标签页当侧栏 */
	resolve() {
		if (this.side && this.alive(this.side)) return this.side;

		const adopted = this.adopt();
		if (adopted) {
			this.side = adopted;
			return adopted;
		}

		this.side = this.split();
		return this.side;
	}

	/* 主编辑区里已经有别的标签组，就用它，别再劈 */
	adopt() {
		const workspace = this.app.workspace;
		const here = workspace.activeLeaf?.parent ?? null;
		let found = null;
		workspace.iterateRootLeaves((leaf) => {
			if (found || !leaf?.parent) return;
			if (leaf.parent !== here && !leaf.pinned) found = leaf;
		});
		return found;
	}

	/* 只有一个标签组时才劈。劈之前把活跃标签页挪回主编辑区 ——
	 * 从文件树点过来时活跃的是侧边栏，直接劈会劈错地方。 */
	split() {
		const workspace = this.app.workspace;
		const anchor = workspace.getMostRecentLeaf();
		if (anchor) workspace.setActiveLeaf(anchor, { focus: false });
		return this.original.call(workspace, "split", "vertical");
	}

	alive(leaf) {
		let ok = false;
		this.app.workspace.iterateAllLeaves((l) => {
			if (l === leaf) ok = true;
		});
		return ok;
	}

	/* 默认把焦点还给点击时所在的那一侧，这样可以接着点下一行。
	 * 放到下一轮：此刻 openFile 还没跑，现在设焦点会被它盖掉。 */
	restoreFocusLater() {
		if (this.plugin.getOption(ID, "focus") === true) return;
		const origin = this.origin;
		if (!origin) return;
		window.setTimeout(() => {
			if (this.alive(origin)) this.app.workspace.setActiveLeaf(origin, { focus: true });
		}, 0);
	}
}
