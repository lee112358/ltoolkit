/* 同一标签组里不重复打开同一个文件。
 *
 * 一个窗口里把同一篇笔记开出两份是 Obsidian 的默认行为，不是 bug —— 它开文件时
 * 只关心「哪个标签页可以被替换」（getLeaf(false) → getUnpinnedLeaf），从不检查
 * 这个文件是不是已经开着了。
 *
 * ── 拦在打开之前，不再事后补救 ───────────────────
 *
 * 第一版是事后补救：等 file-open 触发，发现同组已经有标签页开着这篇，就把刚
 * 打开的那个退回上一篇（history.back）或者关掉，再切到已有的那个。能用，但有
 * 三样毛病是这个做法自带的，改不掉：
 *
 *   1. 看得见的两跳。焦点先落到刚打开的那个标签页，等它加载完才跳到已有的那个。
 *   2. 视图白建两次。刚打开的那个真把文件读了一遍、建了视图、恢复了滚动位置，
 *      然后立刻被 history.back 推倒重建成上一篇。
 *   3. 那一刻常常还动不了手。file-open 由 requestActiveLeafEvents =
 *      debounce(activeLeafEvents, 0) 发出来，通常比 setViewState 跑完更早到，
 *      这时 leaf.working 还是 true：Obsidian 会把 history.go() 原地挡掉、弹一个
 *      「当前标签页正忙，请稍后再试」（核心的 msgTabBusy），setViewState() 则是
 *      静默丢弃。于是还得先轮询等它闲下来，再动手。
 *
 * 三样都是「已经开错了再改回来」带来的。所以改成拦在打开之前：
 *
 *   这篇已经开着了 → 不开在这里，开在那个已经开着它的标签页里。
 *
 * 三样于是一起消失，连带 settling 重入锁、等闲下来的轮询也不用了。
 *
 * ── 为什么拦在 openFile 上 ───────────────────────
 *
 * 去重判断的是 (标签页, 文件) 这一对，同时知道这两样、又在打开之前的位置只有
 * 一个：WorkspaceLeaf.prototype.openFile。Obsidian 里所有「打开文件」——侧边栏、
 * 快速切换器、搜索结果、书签、正文链接、每日笔记、URI——最后都落到它；而前进后退
 * 走的是 leaf.setViewState({ popstate: true })，压根不经过它，于是「在一个标签页里
 * 翻它自己的历史」天然不会被当成重复。边界正好。
 *
 * 补丁只能打在原型上：标签页是随时新建的，逐个实例打不住。obsidian.d.ts 不导出
 * WorkspaceLeaf，原型从一个活着的标签页身上取 —— 所以等布局就绪再打。
 *
 * ── 激活交给 Obsidian 自己做 ─────────────────────
 *
 * 换了标签页之后焦点要不要跟过去，不用自己判断：把 openFile 的 state 原样转给
 * 那个已有的标签页就行，唯一要自己算的是 active —— 它的默认值是「this 是不是
 * 活跃标签页」，标签页一换这个默认就错了，所以按调用方原本挑的那个标签页算好、
 * 显式传下去，剩下的 setViewState 自己会做（active 为真时它就是
 * setActiveLeaf(this, { focus: true })）。
 *
 * state 原样转过去还顺带修好一件事：搜索结果的高亮、链接里的 #小标题、书签的
 * 位置都装在 eState 里，事后补救那一版把它们丢了（切过去的标签页停在原处），
 * 现在跟着一起过去。
 *
 * 只在同一个标签组内去重。左右分栏对照看同一篇是正当用法，不该拦；侧边栏里的
 * 标签页也不参与。
 */

import { Component } from "obsidian";

export const ID = "noDuplicateTabs";

export class NoDuplicateTabs extends Component {
	constructor(app, plugin) {
		super();
		this.app = app;
		this.plugin = plugin;
		/* onLayoutReady 可能在功能已经关掉之后才回调，那时再打补丁就没人还原了 */
		this.stopped = false;
	}

	onload() {
		this.register(() => (this.stopped = true));
		this.app.workspace.onLayoutReady(() => {
			if (!this.stopped) this.patchOpenFile();
		});
	}

	patchOpenFile() {
		const proto = this.leafPrototype();
		if (!proto) {
			console.error("[ltoolkit] 标签页去重未生效：取不到 WorkspaceLeaf 原型");
			return;
		}

		const original = proto.openFile;
		const self = this;

		const patched = function (file, state, ...rest) {
			const twin = self.twinOf(this, file);
			if (!twin) return original.call(this, file, state, ...rest);

			/* 空标签页（多半是刚为这次打开新建出来的）留着就是个空格子，收掉。
			 * 放到下一轮：此刻还在 openFile 的调用栈里，调用方手上拿着它。 */
			if (self.isEmpty(this)) {
				const spare = this;
				window.setTimeout(() => spare.detach(), 0);
			}

			// active 要自己算，见文件头「激活交给 Obsidian 自己做」
			const active = state?.active ?? this === self.app.workspace.activeLeaf;
			return original.call(twin, file, Object.assign({}, state, { active }));
		};

		proto.openFile = patched;

		this.register(() => {
			if (proto.openFile !== patched) return; // 别人后来又打了补丁，不动
			proto.openFile = original;
		});
	}

	/* 同组里另一个已经开着这个文件的标签页，没有就 null。出任何意外都返回
	 * null —— 照常打开，最坏留下一个重复的标签页，比打不开文件强。 */
	twinOf(leaf, file) {
		try {
			const path = file?.path;
			if (!path || !this.inTabbedArea(leaf)) return null;
			// 就是它自己在重开这篇（比如带着新的 eState 再点一次），不算重复
			if (this.pathIn(leaf) === path) return null;

			const siblings = leaf.parent?.children;
			if (!Array.isArray(siblings)) return null;
			return siblings.find((other) => other !== leaf && this.pathIn(other) === path) ?? null;
		} catch (err) {
			console.error("[ltoolkit] 标签页去重失败", err);
			return null;
		}
	}

	/* 这个标签页显示的是哪个文件。不读 view.file：Obsidian 1.7 起没点开过的
	 * 标签页是延迟加载的，view 是个占位的 DeferredView，没有 file —— 刚重启那
	 * 一会儿一整排标签页都是这样。getViewState() 在它们身上是准的，占位视图的
	 * getState() 返回的就是序列化下来的那份状态。 */
	pathIn(leaf) {
		return leaf?.getViewState?.()?.state?.file ?? null;
	}

	/* 侧边栏里的标签页不参与；主编辑区和弹出窗口都算 */
	inTabbedArea(leaf) {
		const root = leaf?.getRoot?.();
		const workspace = this.app.workspace;
		return !!root && root !== workspace.leftSplit && root !== workspace.rightSplit;
	}

	isEmpty(leaf) {
		const type = leaf?.getViewState?.()?.type;
		return !type || type === "empty";
	}

	/* 从任意一个活着的标签页身上取原型 */
	leafPrototype() {
		let proto = null;
		this.app.workspace.iterateAllLeaves((leaf) => {
			if (!proto && typeof leaf?.openFile === "function") {
				proto = Object.getPrototypeOf(leaf);
			}
		});
		return proto;
	}
}
