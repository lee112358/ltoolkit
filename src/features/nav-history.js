/* 跨标签页的前进后退 —— 一条按时间排的浏览轨迹，不管你是在同一个标签页里
 * 换文件，还是开了新标签页。
 *
 * Obsidian 的前进后退是**每个标签页各记一份**的：标签页 A 里换过五篇笔记，
 * 在 A 里按后退能依次退回去；但你在 A 看完跳到 B 打开第六篇，这时按后退
 * 什么也不会发生——B 自己的历史是空的，而 A 那份历史 B 看不见。于是「回到
 * 我刚才在看的那篇」这个最常用的动作，在跨标签页时就断了。
 *
 * ── 轨迹是什么 ───────────────────────────────────
 *
 * 一条线，一个位置一格，格子里是**一个文件**。你每看到一篇新的笔记就往后
 * 添一格，不管它是在哪个标签页里看到的。
 *
 *   固定标签页 1、2、3 各开着文件 1、2、3，又在第 4 个（不固定的）标签页里
 *   依次看了文件 4、5、6，轨迹就是
 *
 *       1 — 2 — 3 — 4 — 5 — 6
 *                           ↑ 现在在这
 *
 *   一路后退就是 5、4、3、2、1。其中 6→5→4 三步发生在同一个标签页里，
 *   3、2、1 三步是切到别的标签页去，但这对你来说没有区别 —— 轨迹上它们
 *   就是相邻的六格。
 *
 * 「同一格」看的是文件，不是标签页：两个标签页开着同一篇，在它们之间来回切
 * 不会往轨迹上添格子——你看到的画面并没有变。
 *
 * 关掉标签页不改轨迹。退回一个标签页已经关掉的文件时，把它重新打开——轨迹
 * 记的是「你看过什么」，标签页只是当时用来看的容器。
 *
 * ── 怎么回到一格 ─────────────────────────────────
 *
 *   1. 这篇正开着（优先它上次待的那个标签页）→ 切过去就完事。
 *      这一条同时保证了绝不会把同一个文件开出两份：开着就用开着的那个。
 *      不这么做的话，后退会让两个标签页同时显示同一篇，然后
 *      no-duplicate-tabs 就会去关掉其中一个——那个功能没有错，它看到的确实
 *      是重复；不该让它看到重复。
 *   2. 它上次待的标签页还在 → 在那个标签页里打开它。这时如果内置历史的下一条
 *      正好就是它，就交给 history.back()/forward()：内置历史的条目里连滚动
 *      位置和光标一起存着（eState），自己 openFile 拿不到这些，会落在笔记
 *      顶部。核对 state.state.file 对得上才走这条，闷头调 back() 会让标签页
 *      先落到一个不相干的文件上。
 *   3. 标签页也没了 → 在当前标签页里打开（开着「预览标签页」时就是那个预览页）。
 *
 * 文件被删掉的格子跳过，继续往前找。
 *
 * ── 鼠标怎么接过来 ───────────────────────────────
 *
 * 鼠标的前进后退键在 Obsidian 的快捷键设置里是绑不上的，那里只认键盘。它是
 * 写死在代码里的一段：
 *
 *   window.addEventListener("mousedown", e => {
 *     if (e.button !== 3 && e.button !== 4) return;
 *     e.preventDefault(); e.stopPropagation();
 *     e.button === 3 ? window.history.back() : window.history.forward();
 *   }, { capture: true })
 *
 * 抢这个 mousedown 是抢不到的：同一个目标上的捕获监听按注册顺序跑，Obsidian
 * 这条在应用启动时就挂上了，插件再挂只能排在它后面。
 *
 * 但它转手调的 window.history.back 本身也是 Obsidian 自己换掉的——换成了一个
 * 按「历史处理者」栈分发的函数（弹窗、菜单开着的时候，鼠标后退是关弹窗而不是
 * 翻笔记，就是这么来的）。照它的办法再换一层就行：这一层走得动就走我们的
 * 轨迹，走不动、或者有弹窗菜单开着，就原样交回给它。
 *
 * 顺带，Electron 主进程把 Windows/Linux 的 app-command 和 macOS 的双指滑动
 * 也都转成了 history.back()，所以这一层同时把这两样也接了过来。
 *
 * 标签栏左上角那两个箭头是另一条路：它们的点击处理是内联写的，直接调
 * leaf.history.go(±1)，既不走命令也不走 history.back。只能在捕获阶段拦点击。
 * 认哪个按钮是箭头不能靠中文标签——按钮的 aria-label 用的就是命令名那个
 * 翻译串，所以拿 app:go-back 的命令名去比，换什么语言都对得上。
 *
 * 键盘那边两条命令默认不占键：Cmd/Ctrl+[ 和 ] 还挂在内置的 app:go-back /
 * app:go-forward 上，要用得自己去「设置 → 快捷键」里把键改挂过来。
 */

import { Component, Keymap } from "obsidian";

export const ID = "navHistory";

const MAX_ENTRIES = 50;
/* 自己走轨迹时，挡住记录的时间上限。用截止时刻而不是布尔量：布尔量一旦因为
 * 某次打开没能收尾而卡住，轨迹就再也不长了，而且毫无声响。 */
const NAVIGATE_WINDOW = 1000;

export class NavHistory extends Component {
	constructor(app, plugin) {
		super();
		this.app = app;
		this.plugin = plugin;
		/* 轨迹：[{ path, leafId }]，按时间从早到晚。leafId 只是「上次在哪个
		 * 标签页看的」这条线索，不参与「算不算同一格」的判断。 */
		this.entries = [];
		this.index = -1;
		this.navigatingUntil = 0;
	}

	onload() {
		this.register(
			this.plugin.useCommand(ID, {
				id: "nav-back",
				name: "后退（跨标签页）",
				icon: "arrow-left",
				checkCallback: (checking) => {
					if (!this.canGo(-1)) return false;
					if (!checking) this.go(-1);
					return true;
				},
			}),
		);

		this.register(
			this.plugin.useCommand(ID, {
				id: "nav-forward",
				name: "前进（跨标签页）",
				icon: "arrow-right",
				checkCallback: (checking) => {
					if (!this.canGo(1)) return false;
					if (!checking) this.go(1);
					return true;
				},
			}),
		);

		/* 轨迹看不见摸不着，出了岔子没法判断它是怎么走的。留一条命令把它
		 * 原样打到控制台上，当前位置用箭头标出来。 */
		this.register(
			this.plugin.useCommand(ID, {
				id: "nav-dump",
				name: "打印浏览轨迹（控制台）",
				icon: "list",
				callback: () => this.dump(),
			}),
		);

		this.registerEvent(this.app.workspace.on("file-open", () => this.record()));
		this.registerEvent(this.app.workspace.on("active-leaf-change", () => this.record()));
		this.registerEvent(
			this.app.vault.on("rename", (file, old) => {
				for (const entry of this.entries) if (entry.path === old) entry.path = file.path;
			}),
		);

		this.patchWindowHistory();
		// 左上角那两个箭头：内联 handler，只能在捕获阶段拦下来
		this.registerDomEvent(document, "click", (event) => this.onArrowClick(event), true);

		this.app.workspace.onLayoutReady(() => this.record());
	}

	/* ── 记录 ───────────────────────────────────────── */

	record() {
		if (Date.now() < this.navigatingUntil) return;

		const leaf = this.app.workspace.getMostRecentLeaf();
		const path = leaf?.view?.file?.path;
		if (!leaf || !path) return;

		/* 还是同一个文件 = 画面没变，不添格子。顺手把线索更新成这个标签页：
		 * 同一篇在两个标签页里开着时，下次回到这一格就落在你最后看的那个。 */
		const current = this.entries[this.index];
		if (current?.path === path) {
			current.leafId = leaf.id;
			return;
		}

		// 走回头路之后又去了新地方：原来那条前进分支作废
		this.entries.length = this.index + 1;
		this.entries.push({ path, leafId: leaf.id });

		if (this.entries.length > MAX_ENTRIES) this.entries.shift();
		this.index = this.entries.length - 1;
	}

	/* ── 走轨迹 ─────────────────────────────────────── */

	async go(step) {
		this.navigatingUntil = Date.now() + NAVIGATE_WINDOW;
		try {
			/* 文件被删掉的格子跳过继续找。一格都去不成就把 index 放回原处，
			 * 免得再按一次又从一个错位置开始数。 */
			const from = this.index;
			for (let at = this.index + step; at >= 0 && at < this.entries.length; at += step) {
				this.index = at;
				if (await this.show(this.entries[at], step)) return;
			}
			this.index = from;
		} catch (err) {
			console.error("[ltoolkit] 前进后退失败", err);
		} finally {
			// 让这几步触发的 file-open 先走完，再放开记录
			window.setTimeout(() => (this.navigatingUntil = 0), 0);
		}
	}

	/* 回到一格。见文件头「怎么回到一格」。去不成返回 false，交给 go 跳过它。 */
	async show(entry, step) {
		// 1. 这篇正开着 —— 切过去就完事，也就不可能开出第二份
		const open = this.leafWith(entry.path, entry.leafId);
		if (open) {
			entry.leafId = open.id;
			this.focus(open);
			return true;
		}

		const file = this.file(entry.path);
		if (!file) return false; // 文件被删了

		// 2. 它上次待的标签页还在就用那个，没了就用当前这个
		const home = this.leafById(entry.leafId);
		const leaf = home ?? this.app.workspace.getLeaf(false);

		if (!(home && (await this.stepInHistory(home, entry.path, step)))) {
			await leaf.openFile(file);
		}

		entry.leafId = leaf.id;
		this.focus(leaf);
		return true;
	}

	/* 内置历史的下一条正好就是这个文件时，交给它走 —— 历史条目里连滚动位置和
	 * 光标一起存着（eState），自己 openFile 拿不到这些，会落在笔记顶部。
	 * 核对 state.state.file 对得上才走，闷头调 back() 会让标签页先落到一个
	 * 不相干的文件上。 */
	async stepInHistory(leaf, path, step) {
		const history = leaf.history;
		const stack = step < 0 ? history?.backHistory : history?.forwardHistory;
		const next = Array.isArray(stack) ? stack[stack.length - 1] : null;
		if (next?.state?.state?.file !== path) return false;

		await (step < 0 ? history.back() : history.forward());
		return true;
	}

	focus(leaf) {
		this.app.workspace.revealLeaf(leaf);
		this.app.workspace.setActiveLeaf(leaf, { focus: true });
	}

	canGo(step) {
		const at = this.index + step;
		return at >= 0 && at < this.entries.length;
	}

	dump() {
		const lines = this.entries.map(
			(entry, at) => `${at === this.index ? "→" : " "} ${at}  ${entry.path}`,
		);
		console.log(`[ltoolkit] 浏览轨迹（${this.entries.length} 格）\n${lines.join("\n")}`);
	}

	/* ── 接管鼠标 ───────────────────────────────────── */

	/* 照 Obsidian 自己的办法再换一层 window.history.back/forward。
	 * 见文件头「鼠标怎么接过来」。 */
	patchWindowHistory() {
		const history = window.history;
		const originalBack = history.back;
		const originalForward = history.forward;

		const back = () => {
			if (!this.takeOver(-1)) originalBack.call(history);
		};
		const forward = () => {
			if (!this.takeOver(1)) originalForward.call(history);
		};

		history.back = back;
		history.forward = forward;

		this.register(() => {
			// 别人后来又换了一层就不动，硬还原会把别人的摘掉
			if (history.back === back) history.back = originalBack;
			if (history.forward === forward) history.forward = originalForward;
		});
	}

	/* 这一下要不要走我们的轨迹。返回 false 就交回给 Obsidian 原来那套。 */
	takeOver(step) {
		if (this.plugin.getOption(ID, "takeOver") === false) return false;
		/* 弹窗、菜单、快速切换器开着的时候，鼠标后退的本意是关掉它们，
		 * 不是翻笔记 —— 这是 Obsidian 那套「历史处理者」栈在管的事，让位。 */
		if (document.querySelector(".modal-container, .menu, .suggestion-container, .prompt")) {
			return false;
		}
		if (!this.canGo(step)) return false;

		this.go(step);
		return true;
	}

	onArrowClick(event) {
		if (this.plugin.getOption(ID, "takeOver") === false) return;
		if (event.button !== 0) return; // 右键是弹历史列表，别拦
		if (Keymap.isModEvent(event)) return; // 按住 Cmd 点是「在新标签页里后退」

		const target = event.target;
		const button = target instanceof Element ? target.closest(".clickable-icon") : null;
		const label = button?.getAttribute("aria-label");
		if (!label) return;

		const step =
			label === this.commandName("app:go-back")
				? -1
				: label === this.commandName("app:go-forward")
					? 1
					: 0;
		if (step === 0 || !this.canGo(step)) return;

		event.preventDefault();
		event.stopPropagation();
		this.go(step);
	}

	commandName(id) {
		return this.app.commands?.findCommand?.(id)?.name;
	}

	/* ── 小工具 ─────────────────────────────────────── */

	file(path) {
		return this.app.vault.getAbstractFileByPath(path);
	}

	/* 主编辑区里第一个满足条件的标签页 */
	leaf(match) {
		let found = null;
		this.app.workspace.iterateRootLeaves((leaf) => {
			if (!found && match(leaf)) found = leaf;
		});
		return found;
	}

	/* 正显示着这个文件的标签页。同一篇开着两份时优先线索里那个。延迟加载还没
	 * 打开的标签页读不到 view.file，找不到就当没开着，最坏只是多开一份。 */
	leafWith(path, prefer) {
		const shows = (leaf) => leaf.view?.file?.path === path;
		return this.leaf((leaf) => leaf.id === prefer && shows(leaf)) ?? this.leaf(shows);
	}

	/* 只认还活着的标签页，顺带天然排除了已经 detach 掉的 */
	leafById(id) {
		return this.leaf((leaf) => leaf.id === id);
	}
}
