/* 记住每篇笔记的浏览位置 —— 切走再切回来时回到原处。
 *
 * Obsidian 自己把滚动位置存在 eState.scroll 里，但那是挂在**标签页的导航历史**
 * 条目上的（getHistoryState → {state, eState}），不是按文件记的。所以只有按
 * 「返回」（Cmd+Alt+←）走历史回去才能恢复；从文件列表或快速切换器重新打开
 * 同一篇笔记是一条全新的 state，没有 eState，于是回到顶部。
 *
 * 这里补的就是「按文件记」这一层：
 *
 *   记录  滚动时取当前视图的位置，存进内存表，攒 2 秒往 localStorage 落一次
 *   恢复  file-open 时查表，等视图渲染完再 setEphemeralState({ scroll })
 *
 * 位置存在 app.saveLocalStorage 里 —— 它的键带 vault 的 appId 前缀，
 * 天然按设备隔离，不会被同步插件带到别的机器上互相覆盖。
 *
 * 三个坑，都踩过：
 *
 * 1. 取视图不能用 getActiveViewOfType。它读的是 workspace.activeLeaf，
 *    从侧边栏点笔记时焦点留在文件浏览器上，activeLeaf.view 不是 MarkdownView，
 *    直接返回 null —— 记录和恢复会同时失灵，且只在鼠标没点进正文时复现。
 *    getMostRecentLeaf 只遍历主区域（rootSplit）里可见的 leaf 按 activeTime 取，
 *    不受侧边栏焦点影响。
 *
 * 2. 新文件加载时滚动值是 0，这期间若去采集就会把它存着的位置冲掉。用 tracking
 *    记住「已经确认恢复完毕、可以开始记录」的那个文件路径来挡；同时 restore
 *    在任何 await 之前就把旧值取出来，即便表被冲了也不影响这一次恢复。
 *
 * 3. 采集不能 debounce。滚一下立刻点走的话，debounce 还没到点就被切换挡住了，
 *    那一段滚动就永远丢了。采集本身只是读个数写进 Map，很便宜，同步做即可；
 *    真正贵的 localStorage 写入另外攒着。
 *
 * 4. 光标和选区必须挂 selectionchange。选中一段文字既不滚动也不改内容，
 *    scroll 和 editor-change 一个都不触发 —— 只挂这两个的话选区永远记不住，
 *    光标也只有在你顺手滚了一下时才碰巧记上。
 *
 * 5. setEphemeralState 不保证一次到位：长笔记的行高还没量完时 applyScroll 会
 *    落偏。所以读回来核对，不对就再来一次，最多三次。
 */

import { Component, debounce } from "obsidian";

export const ID = "scrollMemory";

const STORAGE_KEY = "ltoolkit-scroll-positions";
const WRITE_DEBOUNCE = 2000; // 攒够多久往 localStorage 落一次
const REARM_INTERVAL = 5000; // 兜底：万一某条分支漏了重新武装，最多卡这么久
const MAX_ENTRIES = 500;

const wait = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));
const nextFrame = () => new Promise((resolve) => window.requestAnimationFrame(resolve));

function sameCursor(a, b) {
	if (!a || !b) return a === b;
	return (
		a.from.line === b.from.line &&
		a.from.ch === b.from.ch &&
		a.to.line === b.to.line &&
		a.to.ch === b.to.ch
	);
}

export class ScrollMemory extends Component {
	constructor(app, plugin) {
		super();
		this.app = app;
		this.plugin = plugin;
		this.positions = new Map();
		/* 允许记录哪个文件的位置。null = 正在加载/恢复中，一律不记 */
		this.tracking = null;
		this.restoring = false;
	}

	onload() {
		this.read();
		this.flush = debounce(() => this.write(), WRITE_DEBOUNCE, false);

		/* 捕获阶段挂在 document 上：编辑器和阅读视图的滚动容器不是同一个，
		 * 逐个去找不如统一收。scroll 不冒泡，只能靠捕获阶段拿到。 */
		this.registerDomEvent(document, "scroll", () => this.capture(), true);
		// 选区和光标只有这个事件能覆盖到：选中文字不滚动也不改内容
		this.registerDomEvent(document, "selectionchange", () => this.capture());
		this.registerEvent(this.app.workspace.on("editor-change", () => this.capture()));

		this.registerEvent(this.app.workspace.on("file-open", () => this.onFileOpen()));
		// 切标签页时视图已经渲染好了，位置就是对的，可以立刻开始记录
		this.registerEvent(this.app.workspace.on("active-leaf-change", () => this.rearm()));

		this.registerEvent(this.app.vault.on("rename", (file, old) => this.rename(old, file.path)));
		this.registerEvent(this.app.vault.on("delete", (file) => this.positions.delete(file.path)));
		this.registerEvent(this.app.workspace.on("quit", () => this.write()));

		this.registerInterval(window.setInterval(() => this.rearm(), REARM_INTERVAL));
		this.register(() => this.write()); // 功能被关掉或插件卸载时把攒着的改动落盘

		this.rearm();
	}

	/* 主区域里最近活跃的 markdown 视图。见文件头第 1 条，别换回 getActiveViewOfType */
	activeView() {
		const view = this.app.workspace.getMostRecentLeaf()?.view;
		if (!view || view.getViewType() !== "markdown" || !view.file) return null;
		return view;
	}

	/* 把记录开关对准当前这篇。必须无条件覆盖：切标签页时 tracking 还指着上一篇，
	 * 只在 null 时才设的话，新标签页就永远记不上了。恢复过程中不许动。 */
	rearm() {
		if (this.restoring) return;
		this.tracking = this.activeView()?.file.path ?? null;
	}

	/* ── 记录 ───────────────────────────────────────── */

	capture() {
		const view = this.activeView();
		if (!view || view.file.path !== this.tracking) return;

		// currentMode 是当前生效的那个模式（编辑或阅读），两边都有 getScroll
		const scroll = view.currentMode?.getScroll?.();
		if (typeof scroll !== "number" || Number.isNaN(scroll)) return;

		const entry = { scroll: Number(scroll.toFixed(4)), time: Date.now() };
		if (view.getMode() === "source") {
			const anchor = view.editor.getCursor("anchor");
			const head = view.editor.getCursor("head");
			entry.cursor = {
				from: { line: anchor.line, ch: anchor.ch },
				to: { line: head.line, ch: head.ch },
			};
		}

		const path = view.file.path;
		const previous = this.positions.get(path);
		if (
			previous &&
			previous.scroll === entry.scroll &&
			sameCursor(previous.cursor, entry.cursor)
		) {
			return;
		}

		// 删了再塞：Map 按插入顺序排，这样最久没碰的自然排在最前面
		this.positions.delete(path);
		this.positions.set(path, entry);
		while (this.positions.size > MAX_ENTRIES) {
			this.positions.delete(this.positions.keys().next().value);
		}

		this.flush();
	}

	/* ── 恢复 ───────────────────────────────────────── */

	async onFileOpen() {
		// 事件回调不 await 这个 promise，抛出去就成了未处理的 rejection
		this.restoring = true;
		try {
			await this.restore();
		} catch (err) {
			console.error("[ltoolkit] 恢复浏览位置失败", err);
		} finally {
			this.restoring = false;
			this.rearm();
		}
	}

	async restore() {
		this.tracking = null; // 恢复完成前不记录，免得把存着的位置冲成 0

		const view = this.activeView();
		if (!view) return;

		const file = view.file;
		// 在任何 await 之前把旧值取出来：即便加载过程把表冲了，这一次恢复也不受影响
		const saved = this.positions.get(file.path);
		if (!saved) return;

		// 走 [[笔记#标题]] 这类锚点链接进来的，滚动位置该由链接决定，别跟它抢
		if (this.isFollowingAnchor(view)) return;

		await wait(this.restoreDelay());

		// 等待期间可能已经又切走了，或者锚点高亮这时才出现
		if (this.activeView() !== view || view.file !== file) return;
		if (this.isFollowingAnchor(view)) return;

		/* 先还原光标/选区再还原滚动：setSelection 自己会把光标滚进视野，
		 * 顺序反了就把刚设好的滚动位置顶掉了。阅读模式下没有光标可还原。 */
		if (
			saved.cursor &&
			view.getMode() === "source" &&
			this.plugin.getOption(ID, "cursor") !== false
		) {
			view.editor.setSelection(saved.cursor.from, saved.cursor.to);
		}
		if (typeof saved.scroll === "number") {
			await this.applyScroll(view, saved.scroll);
		}
	}

	/* setEphemeralState 不保证一次到位：长笔记的行高还没量完时 applyScroll 会落偏，
	 * 阅读模式下它甚至要等渲染完才真正生效。读回来核对，不对就再来一次。
	 * 笔记在别处被改短过的话永远够不着目标，所以次数必须有上限。 */
	async applyScroll(view, target) {
		for (let attempt = 0; attempt < 3; attempt++) {
			view.setEphemeralState({ scroll: target });
			await nextFrame();

			const landed = view.currentMode?.getScroll?.();
			if (typeof landed !== "number" || Math.abs(landed - target) < 0.5) return;
		}
	}

	/* 锚点跳转时 Obsidian 会给目标加 .is-flashing 高亮。只查当前视图内部，
	 * 别的分栏里残留的高亮不该拦住这里。 */
	isFollowingAnchor(view) {
		return view.containerEl.querySelector(".is-flashing") !== null;
	}

	restoreDelay() {
		const value = Number(this.plugin.getOption(ID, "delay"));
		return Number.isFinite(value) && value >= 0 ? Math.min(value, 2000) : 100;
	}

	/* ── 存取 ───────────────────────────────────────── */

	rename(oldPath, newPath) {
		const entry = this.positions.get(oldPath);
		if (!entry) return;
		this.positions.delete(oldPath);
		this.positions.set(newPath, entry);
		if (this.tracking === oldPath) this.tracking = newPath;
		this.flush();
	}

	read() {
		try {
			const data = this.app.loadLocalStorage(STORAGE_KEY);
			if (!data || typeof data !== "object") return;
			for (const [path, entry] of Object.entries(data)) {
				if (entry && typeof entry.scroll === "number") this.positions.set(path, entry);
			}
		} catch (err) {
			console.error("[ltoolkit] 读取浏览位置失败", err);
		}
	}

	write() {
		try {
			this.app.saveLocalStorage(STORAGE_KEY, Object.fromEntries(this.positions));
		} catch (err) {
			console.error("[ltoolkit] 保存浏览位置失败", err);
		}
	}
}
