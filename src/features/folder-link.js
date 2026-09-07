/* 指向文件夹的链接：点了在文件浏览器里定位它、悬停时列出里面有什么、颜色不再画成坏链接。
 *
 * [名字](学习/数学) 这种括号里写相对路径的链接，指到文件夹时 Obsidian 处处当它是坏的，
 * 因为负责解析的 getFirstLinkpathDest 只查文件索引，文件夹不在那份索引里。三处症状、
 * 三个入口，全都在「拿到 linktext 之后」这一层接管，不去碰各视图的 DOM ——
 * 实时预览里的链接根本不是 <a>，是 CodeMirror 的 span.cm-underline 装饰，
 * 按 DOM 拦只能拦住阅读视图那一半。
 *
 *   点击   workspace.openLinkText(linktext, sourcePath, ...)
 *          阅读视图的 onInternalLinkClick、实时预览的 triggerClickableToken、
 *          属性面板、中键新标签页，最后都汇到这一个方法上。原本找不到文件时它会
 *          去 createNewFile，路径上已经有同名目录，于是报「Folder already exists」。
 *
 *   悬停   页面预览插件实例的 onLinkHover(parent, targetEl, linktext, sourcePath, state)
 *          hover-link 事件由核心触发（编辑器那边走 onEditorLinkMouseover），
 *          事件本身没法取消，但插件收到后统一交给这个方法，包住它就行。
 *          按住 Cmd 才预览之类的设置在它上一层，照旧生效。
 *
 *   颜色   metadataCache.isUnresolved(linkpath, sourcePath)
 *          阅读视图逐个 toggleClass、实时预览的 CodeMirror 装饰、属性面板里的链接，
 *          判定依据都是它。原本是 initialized && !getFirstLinkpathDest()。
 *
 * 三处都是包在实例上（不是原型），卸载时还原，不留痕迹。
 *
 * 顺带也管 [[学习/数学]]：wiki 链接和 Markdown 链接到这一层已经没有区别，
 * 都是一个 linktext 加一个 sourcePath。
 */

import { Component, HoverPopover, Notice, PopoverState, TFolder, setIcon } from "obsidian";

export const ID = "folderLink";

/* 浮窗里最多列这么多条，再多就只报个数 —— 浮窗不是文件列表，撑太长反而挡住正文 */
const PREVIEW_LIMIT = 30;

export class FolderLink extends Component {
	constructor(app, plugin) {
		super();
		this.app = app;
		this.plugin = plugin;
	}

	onload() {
		this.popover = null;
		this.patchOpenLinkText();
		this.patchHoverPreview();
		this.patchUnresolved();
		this.rerenderPreviews();
	}

	onunload() {
		this.popover?.hide();
		// 三个包装的还原都挂在 register() 上，由 Component 自己调，这里只补一次重绘
		this.rerenderPreviews();
	}

	patchOpenLinkText() {
		const workspace = this.app.workspace;
		const original = workspace.openLinkText;
		if (typeof original !== "function") return;

		workspace.openLinkText = (linktext, sourcePath, newLeaf, openViewState) => {
			const folder = this.resolveFolder(linktext, sourcePath ?? "");
			if (folder) return this.reveal(folder);
			return original.call(workspace, linktext, sourcePath, newLeaf, openViewState);
		};
		this.register(() => {
			workspace.openLinkText = original;
		});
	}

	/* 页面预览插件停用时不包 —— 那时本来就没有浮窗，也就没有「找不到文件」可改。
	 * 之后再启用它得重开一次本功能的开关才接上，这点小代价换的是不去动 hover-link
	 * 事件本身（那是全局的，别的插件也在听）。 */
	patchHoverPreview() {
		const preview = this.app.internalPlugins?.getEnabledPluginById?.("page-preview");
		const original = preview?.onLinkHover;
		if (typeof original !== "function") return;

		preview.onLinkHover = (parent, targetEl, linktext, sourcePath, state) => {
			const folder = this.resolveFolder(linktext, sourcePath ?? "");
			if (!folder) {
				return original.call(preview, parent, targetEl, linktext, sourcePath, state);
			}
			this.showFolder(parent, targetEl, folder);
		};
		this.register(() => {
			// 方法本来在原型上，删掉实例上这一份就回到原样
			delete preview.onLinkHover;
		});
	}

	/* 只在原方法说「未解析」时才多查一次是不是文件夹，是就改口说已解析 */
	patchUnresolved() {
		const cache = this.app.metadataCache;
		const original = cache.isUnresolved;
		if (typeof original !== "function") return;

		cache.isUnresolved = (linkpath, sourcePath) => {
			if (!original.call(cache, linkpath, sourcePath)) return false;
			return !this.resolveFolder(linkpath, sourcePath ?? "");
		};
		this.register(() => {
			cache.isUnresolved = original;
		});
	}

	/* 浮窗：一行文件夹路径（尾巴上带斜杠，一眼看出是目录），下面缩进两格列出里面的条目。
	 * 只读，不做点击 —— 它是「让你确认这个链接指到哪」，真要进去点链接本身就行了。
	 * 宿主用核心传来的那个（通常是当前视图）：换到别的链接上时，核心自己会把这个浮窗关掉。 */
	showFolder(parent, targetEl, folder) {
		const showing = this.popover;
		if (showing && showing.targetEl === targetEl && showing.state !== PopoverState.Hidden) {
			return;
		}

		// 构造完就自己排队显示、跟着鼠标进出决定去留，位置也自己算，不用管
		this.popover = new HoverPopover(parent, targetEl);
		const hoverEl = this.popover.hoverEl;
		hoverEl.addClass("lt-folder-preview");

		/* 核心把 .popover 设成了 flex 容器，标题和列表直接当兄弟放进去会左右排成两栏，
		 * 所以统一装进一个 body 里，由它自己纵向排 */
		const body = hoverEl.createDiv({ cls: "lt-folder-preview-body" });

		const title = body.createDiv({ cls: "lt-folder-preview-title" });
		setIcon(title.createSpan({ cls: "lt-folder-preview-icon" }), "folder-open");
		title.createSpan({ cls: "lt-folder-preview-path", text: folder.path });
		/* 尾斜杠单独一个 span：路径太长时截掉的是路径本身，这个「是目录」的记号
		 * 始终留在末尾 */
		title.createSpan({ cls: "lt-folder-preview-slash", text: "/" });

		const children = [...folder.children].sort((a, b) => {
			const aFolder = a instanceof TFolder;
			const bFolder = b instanceof TFolder;
			if (aFolder !== bFolder) return aFolder ? -1 : 1;
			return a.name.localeCompare(b.name, "zh-Hans-CN");
		});

		if (children.length === 0) {
			body.createDiv({ cls: "lt-folder-preview-empty", text: "空文件夹" });
			return;
		}

		const list = body.createDiv({ cls: "lt-folder-preview-list" });
		for (const child of children.slice(0, PREVIEW_LIMIT)) {
			const isFolder = child instanceof TFolder;
			const row = list.createDiv({ cls: "lt-folder-preview-item" });
			setIcon(
				row.createSpan({ cls: "lt-folder-preview-icon" }),
				isFolder ? "folder" : "file",
			);
			row.createSpan({
				cls: "lt-folder-preview-name",
				// 笔记只显示名字，其它文件带上扩展名 —— 和文件列表里的显示规则一致
				text: isFolder || child.extension !== "md" ? child.name : child.basename,
			});
		}

		const rest = children.length - PREVIEW_LIMIT;
		if (rest > 0) list.createDiv({ cls: "lt-folder-preview-more", text: `还有 ${rest} 项` });
	}

	/* 把链接里的路径解成 vault 里的文件夹，解不出来返回 null。
	 *
	 * 相对写法（../ 、./ 、直接跟目录名）以笔记所在目录为基准；以 / 开头的按 vault
	 * 根目录算。两者都试一遍是因为 Obsidian 的「新建链接的路径格式」可以设成
	 * 「基于库根目录的路径」，那时写出来的相对路径其实是从根开始数的。 */
	resolveFolder(href, sourcePath) {
		if (typeof href !== "string") return null;

		let raw = href;
		try {
			raw = decodeURIComponent(raw);
		} catch {
			// 不是合法的百分号转义（比如目录名里本来就有个 %），按原样用
		}
		raw = raw.split("#")[0].split("?")[0].trim();
		if (!raw) return null;

		const candidates = [];
		if (raw.startsWith("/")) {
			candidates.push(this.normalize(raw));
		} else {
			const cut = String(sourcePath).lastIndexOf("/");
			const dir = cut === -1 ? "" : String(sourcePath).slice(0, cut);
			candidates.push(this.normalize(dir ? `${dir}/${raw}` : raw));
			candidates.push(this.normalize(raw));
		}

		for (const path of candidates) {
			if (!path) continue; // 空串是 vault 根目录，链接指向它没有意义
			const file = this.app.vault.getAbstractFileByPath(path);
			if (file instanceof TFolder) return file;
		}
		return null;
	}

	/* 自己消化掉 . 和 ..，不借 path 模块 —— vault 内部路径一律是 / 分隔，
	 * 和运行平台无关，用 node:path 在 Windows 上反而会拼出反斜杠。
	 * ../ 退过了根目录说明这个链接本来就不指向库内，返回空串让上面跳过。 */
	normalize(path) {
		const parts = [];
		for (const seg of path.split("/")) {
			if (seg === "" || seg === ".") continue;
			if (seg === "..") {
				if (parts.length === 0) return "";
				parts.pop();
				continue;
			}
			parts.push(seg);
		}
		return parts.join("/");
	}

	/* internalPlugins 不在 obsidian.d.ts 里，全程当它可能不存在。
	 * 这个 revealInFolder 是文件浏览器插件实例上的那个（不是 view 上的同名方法），
	 * 它会先把侧边栏的文件浏览器准备好再交给 view，内置的「在文件列表中显示当前文件」
	 * 走的也是它。 */
	async reveal(folder) {
		const explorer = this.app.internalPlugins?.getEnabledPluginById?.("file-explorer");
		if (!explorer?.revealInFolder) {
			new Notice("LToolkit：文件浏览器没启用，无法定位文件夹");
			return;
		}
		try {
			await explorer.revealInFolder(folder);
		} catch (err) {
			console.error("[ltoolkit] 定位文件夹失败", err);
		}
	}

	/* 阅读视图的链接样式是渲染时一次性打上去的，包完 isUnresolved 得重绘才看得到。
	 * 实时预览那边的装饰由 CodeMirror 自己的更新时机决定，重开一次笔记即可。 */
	rerenderPreviews() {
		this.app.workspace.iterateAllLeaves((leaf) => {
			const view = leaf.view;
			if (view?.getViewType?.() === "markdown") view.previewMode?.rerender?.(true);
		});
	}
}
