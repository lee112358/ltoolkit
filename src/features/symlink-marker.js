/* 文件树里标出软链接文件夹：名字右边一个淡色小箭头，悬停时显示它实际指向哪里。
 *
 * Obsidian 顺着软链接把目录读进来，TFolder 上不留任何痕迹，文件树里它和普通文件夹
 * 长得一模一样。所以只能自己去问文件系统：对每个文件夹 lstat 一次（stat 会跟着
 * 链接走，永远说是目录），是链接的再 realpath 一下拿到真实位置。
 *
 * 标记不往 DOM 里塞元素。文件树是懒渲染的 —— 折叠着的文件夹连子节点都没建，
 * 滚出视口的行也会被回收，挂在元素上的东西随时会丢。好在每一行的
 * .nav-folder-title 上都有 data-path，于是生成一段按路径匹配的样式：
 *
 *   .nav-folder-title[data-path="20-项目/stock-docs"] { --lt-symlink: inline-block; }
 *
 * 箭头长什么样写在 symlink-marker.css 里，那边只认这个变量。行什么时候建出来、
 * 建几次都无所谓，匹配上就有箭头。变量设在 title 上不会漏给子文件夹 ——
 * .nav-folder-children 是它的兄弟节点，不是后代。
 *
 * 悬停提示用的是 Obsidian 自己那套：body 上委托了 pointerover，碰到带 aria-label
 * 的元素就弹提示。这里在捕获阶段抢先一步，把 aria-label 补到那一行上，
 * 冒泡到 body 时核心就照常把它显示出来。同理也不必提前给每一行打标签。
 *
 * 只在桌面端有：手机上没有 Node 的 fs，查不了链接。 */

import { Component, FileSystemAdapter, TFolder } from "obsidian";

export const ID = "symlinkMarker";

/* 自己加上的 aria-label 做个记号，路径变了或功能关掉时只收回自己那份 */
const TIP_ATTR = "data-lt-symlink-tip";

export class SymlinkMarker extends Component {
	constructor(app, plugin) {
		super();
		this.app = app;
		this.plugin = plugin;
		/* 文件夹路径 -> 显示用的真实位置 */
		this.links = new Map();
		this.stopped = false;
	}

	onload() {
		const adapter = this.app.vault.adapter;
		if (!(adapter instanceof FileSystemAdapter)) return;
		// 绕开打包器：esbuild 按浏览器平台打包，不该去解析 fs
		this.fs = window.require("fs").promises;
		this.home = window.require("os").homedir();
		this.adapter = adapter;

		this.styleEl = document.head.createEl("style", { attr: { id: "lt-symlink-marker" } });
		this.register(() => {
			this.stopped = true;
			this.styleEl.remove();
			for (const el of document.querySelectorAll(`[${TIP_ATTR}]`)) this.clearTip(el);
		});

		this.registerDomEvent(document, "pointerover", (e) => this.onPointerOver(e), {
			capture: true,
		});

		/* 启动时 vault 会为每个文件补发一遍 create，布局就绪之后再听，免得和全量扫描重复 */
		this.app.workspace.onLayoutReady(() => {
			if (this.stopped) return;
			this.scanAll();
			this.registerEvent(this.app.vault.on("create", (file) => this.check(file)));
			this.registerEvent(
				this.app.vault.on("rename", (file, old) => {
					this.forget(old);
					this.check(file);
				}),
			);
			this.registerEvent(this.app.vault.on("delete", (file) => this.forget(file.path)));
		});
	}

	async scanAll() {
		const folders = this.app.vault
			.getAllLoadedFiles()
			.filter((f) => f instanceof TFolder && !f.isRoot());
		await Promise.all(folders.map((f) => this.probe(f.path)));
		this.render();
	}

	async check(file) {
		if (!(file instanceof TFolder)) return;
		if (await this.probe(file.path)) this.render();
	}

	/* 查一个路径，把结果记进 links。返回 links 是否因此变了 */
	async probe(path) {
		const full = this.adapter.getFullPath(path);
		let target = null;
		try {
			if ((await this.fs.lstat(full)).isSymbolicLink()) {
				target = await this.fs.realpath(full).catch(() => this.fs.readlink(full));
			}
		} catch {
			// 刚建就被删了之类，当普通文件夹处理
		}
		if (this.stopped) return false;

		if (target === null) return this.links.delete(path);
		const shown = target.startsWith(this.home + "/")
			? "~" + target.slice(this.home.length)
			: target;
		if (this.links.get(path) === shown) return false;
		this.links.set(path, shown);
		return true;
	}

	/* 文件夹被删或改名时，它自己和底下所有子文件夹都作废 */
	forget(path) {
		let changed = false;
		for (const key of [...this.links.keys()]) {
			if (key === path || key.startsWith(path + "/")) {
				this.links.delete(key);
				changed = true;
			}
		}
		if (changed) this.render();
	}

	render() {
		if (this.stopped) return;
		const selectors = [...this.links.keys()].map(
			(path) => `.nav-folder-title[data-path="${CSS.escape(path)}"]`,
		);
		this.styleEl.textContent = selectors.length
			? `${selectors.join(",\n")} { --lt-symlink: inline-block; }`
			: "";
	}

	onPointerOver(e) {
		const el = e.target instanceof Element ? e.target.closest(".nav-folder-title") : null;
		if (!el || !el.closest('.workspace-leaf-content[data-type="file-explorer"]')) return;

		const target = this.links.get(el.getAttribute("data-path"));
		if (target === undefined) {
			// 同一个元素会被复用给别的路径（比如原地改名），别让旧提示留着
			if (el.hasAttribute(TIP_ATTR)) this.clearTip(el);
			return;
		}
		// 行上已经有别人给的提示就不抢
		if (el.hasAttribute("aria-label") && !el.hasAttribute(TIP_ATTR)) return;

		el.setAttribute("aria-label", `软链接 → ${target}`);
		el.setAttribute("data-tooltip-position", "right");
		el.setAttribute(TIP_ATTR, "");
	}

	clearTip(el) {
		el.removeAttribute("aria-label");
		el.removeAttribute("data-tooltip-position");
		el.removeAttribute(TIP_ATTR);
	}
}
