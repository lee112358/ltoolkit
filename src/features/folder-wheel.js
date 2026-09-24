/* Option + 滚轮 → 在当前标签页里翻同一个文件夹的上一篇 / 下一篇。
 *
 * 看流水账这种一天一篇的笔记，想往前翻几天，原本得回文件树里一行行点。
 * 这里把它收到滚轮上：鼠标停在哪个标签页上，按住 Option 滚，那个标签页就
 * 在它这篇所在的文件夹里前后换，往下滚是下一篇、往上滚是上一篇。
 *
 * ── 顺序跟文件树走 ───────────────────────────────
 *
 * 「上一篇 / 下一篇」按文件树的排序算（核心设置里的 fileSortOrder：按名字、
 * 按修改时间、按创建时间，正反各一种），翻出来的顺序和你在左边看到的一致。
 * 名字比较用自然排序，2026-9-2 排在 2026-9-10 前面。只翻和当前这篇同类型的
 * 文件（笔记只翻笔记），混在同一个文件夹里的图片、PDF 跳过。到头了就停，
 * 不绕回去。
 *
 * ── 一格一篇，但不等它开完 ─────────────────────
 *
 * 攒够一段距离翻一篇，再隔一个很短的间隔防止一次大滚动连跳好几篇。
 *
 * 快滚时不排队等每一篇开完：滚轮只挪「要去的那一篇」，文件树的高亮立刻跟上；
 * 标签页那边开完一篇再看目标，目标已经往前走了就直接开最新的那篇，中间
 * 滚过去的不再逐篇打开。所以滚多快，高亮就走多快，正文落在你停下的地方。
 *
 * ── 让出的地方 ───────────────────────────────────
 *
 * 只认单按 Option；带 Cmd、Ctrl、Shift 的都放行。鼠标下不是一个开着文件的
 * 标签页（侧边栏、空标签页、设置面板）也放行，照常滚动。
 */

import { Component, Notice, TFile } from "obsidian";

export const ID = "folderWheel";

/* 攒够这么多像素才翻一篇 */
const STEP = 40;
/* 翻完一篇之后这么久内不再翻，只为挡住一个大事件连跳几篇 */
const COOLDOWN = 50;

export class FolderWheel extends Component {
	constructor(app, plugin) {
		super();
		this.app = app;
		this.plugin = plugin;
		this.pending = 0;
		this.lockedUntil = 0;
		/* 滚轮要去的那一篇：{ leaf, file }。标签页追着它开 */
		this.target = null;
		/* 正在开的时候不叠着开，开完再追最新的 target */
		this.busy = false;
		this.noticedAt = 0;
	}

	onload() {
		// passive: false 才能 preventDefault，挡住这一下的页面滚动
		this.registerDomEvent(document, "wheel", (e) => this.onWheel(e), {
			capture: true,
			passive: false,
		});
	}

	onWheel(e) {
		if (!e.altKey || e.metaKey || e.ctrlKey || e.shiftKey) return;
		const leaf = this.leafAt(e.target);
		const file = leaf?.view?.file;
		if (!(file instanceof TFile)) return;

		e.preventDefault();
		e.stopPropagation();

		const now = Date.now();
		if (now < this.lockedUntil) {
			this.pending = 0;
			return;
		}

		// deltaMode 1 是按行给的，折成像素
		this.pending += e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
		if (Math.abs(this.pending) < STEP) return;

		const step = this.pending > 0 ? 1 : -1;
		this.pending = 0;
		this.lockedUntil = now + COOLDOWN;
		// 还在追上一个目标时，从目标往下数，而不是从标签页眼下显示的那篇
		const from = this.target?.leaf === leaf ? this.target.file : file;
		this.flip(leaf, from, step);
	}

	flip(leaf, file, step) {
		const siblings = this.siblings(file);
		const next = siblings[siblings.indexOf(file) + step];
		if (!next) {
			// 快滚到头会连着撞上好几次，提示一次就够
			if (Date.now() - this.noticedAt > 1500) {
				new Notice(step > 0 ? "已经是最后一篇" : "已经是第一篇", 1000);
			}
			this.noticedAt = Date.now();
			return;
		}

		this.target = { leaf, file: next };
		this.followInExplorer(next);
		this.drain();
	}

	/* 追着 target 开，开完一篇发现目标又变了就接着开最新的 */
	async drain() {
		if (this.busy) return;
		this.busy = true;
		try {
			let opened = null;
			while (this.target) {
				const { leaf, file } = this.target;
				/* 开过了还没落在这个标签页，多半是「同一标签组不重复打开」把它
				 * 转去了已经开着它的那个标签页 —— 别再开，否则原地打转 */
				if (leaf.view?.file === file || file === opened) break;
				opened = file;
				await leaf.openFile(file);
			}
		} catch (err) {
			console.error("[ltoolkit] 翻页失败", err);
		} finally {
			this.busy = false;
			this.target = null;
		}
	}

	/* 文件树跟着走：高亮和焦点框都挪到这一篇，滚到看得见的地方。
	 *
	 * 文件树自己只在 file-open 时挪高亮，而 file-open 只为活跃标签页发 ——
	 * 滚的是右边那个不活跃的标签页时它就不动。所以直接调它那两个方法：
	 * onFileOpen 挪高亮（顺带清掉多选），setFocusedItem 挪焦点框并滚过去。
	 * 不用 revealInFolder，它会把键盘焦点抢到文件树上。 */
	followInExplorer(file) {
		for (const leaf of this.app.workspace.getLeavesOfType("file-explorer")) {
			const view = leaf.view;
			const item = view?.fileItems?.[file.path];
			if (!item) continue;
			view.onFileOpen?.(file);
			view.tree?.setFocusedItem?.(item);
		}
	}

	/* 鼠标下的那个主编辑区标签页，不是就 null */
	leafAt(target) {
		const el = target?.closest?.(".workspace-leaf");
		if (!el) return null;
		let found = null;
		this.app.workspace.iterateRootLeaves((leaf) => {
			if (leaf.containerEl === el) found = leaf;
		});
		return found;
	}

	/* 同文件夹里和它同类型的文件，按文件树的顺序排好 */
	siblings(file) {
		const children = file.parent?.children ?? [];
		const files = children.filter((f) => f instanceof TFile && f.extension === file.extension);
		return files.sort(this.comparator());
	}

	comparator() {
		const byName = (a, b) =>
			a.basename.localeCompare(b.basename, undefined, {
				numeric: true,
				sensitivity: "base",
			}) || a.extension.localeCompare(b.extension);
		const order = this.app.vault.getConfig?.("fileSortOrder") ?? "alphabetical";
		switch (order) {
			case "alphabeticalReverse":
				return (a, b) => byName(b, a);
			case "byModifiedTime":
				return (a, b) => b.stat.mtime - a.stat.mtime || byName(a, b);
			case "byModifiedTimeReverse":
				return (a, b) => a.stat.mtime - b.stat.mtime || byName(a, b);
			case "byCreatedTime":
				return (a, b) => b.stat.ctime - a.stat.ctime || byName(a, b);
			case "byCreatedTimeReverse":
				return (a, b) => a.stat.ctime - b.stat.ctime || byName(a, b);
			default:
				return byName;
		}
	}
}
