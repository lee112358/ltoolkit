/* 长代码块默认收起 —— 阅读视图里高过 N 行的代码块只露出前 N 行，
 * 底部渐隐，下面一颗「展开」按钮，点开后变成「收起」。
 *
 * 「N 行」按显示出来的高度算，不按源码行数：一行几千字的 prompt 在阅读视图里
 * 会自动换行铺成几十行，数源码只有 1 行，收不起来。高度得等元素进了文档、
 * 排完版才量得出（后处理器跑的时候它多半还没挂上去），所以用 ResizeObserver
 * 盯着 pre，尺寸一变就重量一次 —— 窗口拉宽拉窄、换行数跟着变，也一起照顾到。
 *
 * 只管阅读视图：实时预览里代码块是一行一个 .cm-line，没有外层容器可截高度，
 * 要做得换成 CodeMirror 的块级替换装饰，是另一套东西。
 *
 * 展开状态存在内存里，不落盘：
 *
 *   为什么要存   阅读视图会整段重画（在编辑模式改完切回来、开关设置时），
 *                重画出来的是新元素，挂在旧元素上的 class 跟着没了。
 *   用什么当键   文件路径 + 这一段在源文件里的起始行 + 段内第几个代码块。
 *                在它上方增删几行，起始行一变，这个块就回到收起 —— 只在
 *                文件开着期间记住，这点代价可以接受，不值得做位置追踪。
 *   什么时候清   layout-change 时看一眼，没有任何标签页开着的文件整份丢掉。
 *                同一个文件开在两个标签页里共用一份，合乎直觉。
 */

import { Component, MarkdownPreviewRenderer, MarkdownRenderChild } from "obsidian";

export const ID = "codeBlockFold";

const FOLD_CLASS = "lt-code-fold";
const EXPANDED_CLASS = "is-expanded";
const OVERFLOW_CLASS = "is-overflowing";
const TOGGLE_CLASS = "lt-code-fold-toggle";

const VARIABLE = "--lt-code-fold-lines";
const FALLBACK = 10;
const MIN = 3;
const MAX = 100;

export class CodeBlockFold extends Component {
	constructor(app, plugin) {
		super();
		this.app = app;
		this.plugin = plugin;
		/** @type {Map<string, Set<string>>} 文件路径 -> 展开着的代码块 */
		this.expanded = new Map();
		this.observer = new ResizeObserver((entries) => {
			for (const entry of entries) this.measure(entry.target);
		});
	}

	onload() {
		// 理由同 code-block-filename.js：自己注册、自己摘，单独关掉这项时摘得下来。
		// refresh 里那次 post-processor-change 顺带让开着的阅读视图重画
		this.processor = (el, ctx) => this.decorate(el, ctx);
		MarkdownPreviewRenderer.registerPostProcessor(this.processor);
		this.refresh();

		this.registerEvent(this.app.workspace.on("layout-change", () => this.forgetClosed()));

		this.register(() => {
			MarkdownPreviewRenderer.unregisterPostProcessor(this.processor);
			this.observer.disconnect();
			document.body.style.removeProperty(VARIABLE);
			this.app.workspace.trigger("post-processor-change");
		});
	}

	/* 设置面板里改完行数，main.js 的 setOption 会回调这里。
	 * 行数既决定「多长才收」，也决定收起后露多高，两处要一致，
	 * 所以 JS 读一份拿来判断，同时写成 CSS 变量给高度用。 */
	refresh() {
		const parsed = Number.parseInt(this.plugin.getOption(ID, "lines"), 10);
		this.lines = Number.isFinite(parsed) ? Math.min(Math.max(parsed, MIN), MAX) : FALLBACK;
		document.body.style.setProperty(VARIABLE, String(this.lines));
		this.app.workspace.trigger("post-processor-change");
	}

	forgetClosed() {
		const open = new Set();
		this.app.workspace.iterateAllLeaves((leaf) => {
			const path = leaf.view?.file?.path;
			if (path) open.add(path);
		});
		for (const path of this.expanded.keys()) {
			if (!open.has(path)) this.expanded.delete(path);
		}
	}

	decorate(el, ctx) {
		const blocks = el.findAll("pre > code");
		if (blocks.length === 0) return;

		// 这一段被卸掉（重画、关掉文件）时别再盯着它的 pre
		const child = new MarkdownRenderChild(el);
		child.register(() => blocks.forEach((code) => this.observer.unobserve(code.parentElement)));
		ctx.addChild(child);

		// 嵌入内容之类拿不到源文件位置：照样能收能展，只是重画后不记得
		const info = ctx.getSectionInfo(el);
		const path = ctx.sourcePath;

		blocks.forEach((code, index) => {
			const pre = code.parentElement;
			// 实时预览里就地渲染的那一小块 markdown-rendered，不掺和
			if (pre.closest(".cm-preview-code-block")) return;

			pre.querySelector(`:scope > .${TOGGLE_CLASS}`)?.remove();
			pre.removeClass(EXPANDED_CLASS, OVERFLOW_CLASS);

			// 先一律挂上，够不够长交给 measure 量完再说；
			// 按钮也先建好，CSS 只在 is-overflowing 时显示它
			const key = info ? `${info.lineStart}:${index}` : null;
			pre.addClass(FOLD_CLASS);
			if (key && this.expanded.get(path)?.has(key)) pre.addClass(EXPANDED_CLASS);

			const toggle = pre.createDiv({ cls: TOGGLE_CLASS });
			const label = () => toggle.setText(pre.hasClass(EXPANDED_CLASS) ? "收起" : "展开");
			label();
			this.observer.observe(pre);

			toggle.addEventListener("click", (event) => {
				event.preventDefault();
				event.stopPropagation();

				const open = !pre.hasClass(EXPANDED_CLASS);
				pre.toggleClass(EXPANDED_CLASS, open);
				label();
				if (key) this.remember(path, key, open);

				// 在长代码块底部点「收起」，块一下缩回去，人会落到后面不相干的地方。
				// 顶部已经滚出视口时，把它拉回来。视口指阅读视图自己那个滚动容器，
				// 不是窗口 —— 上面还压着标签栏和标题栏
				const scroller = pre.closest(".markdown-preview-view");
				const top = scroller ? scroller.getBoundingClientRect().top : 0;
				if (!open && pre.getBoundingClientRect().top < top) {
					pre.scrollIntoView({ block: "start" });
				}
			});
		});
	}

	/* 内容比 N 行高，才算长代码块。
	 * 收起时 code 被 max-height 截住，但 scrollHeight 仍是内容的完整高度，
	 * 所以收起、展开两种状态下都能拿它和 N 行的高度比。 */
	measure(pre) {
		const code = pre.querySelector(":scope > code");
		if (!code || !code.isConnected) return;

		const style = getComputedStyle(code);
		// 行高是 normal 时 getComputedStyle 给不出像素数，按常见的 1.5 倍估
		const line = Number.parseFloat(style.lineHeight) || Number.parseFloat(style.fontSize) * 1.5;
		if (!line) return; // 还没排版（比如藏在折叠的 callout 里），等下一次尺寸变化

		// 留半行余量，免得正好 N 行的块因为小数像素被判成超长
		pre.toggleClass(OVERFLOW_CLASS, code.scrollHeight > line * (this.lines + 0.5));
	}

	remember(path, key, open) {
		let keys = this.expanded.get(path);
		if (open) {
			if (!keys) this.expanded.set(path, (keys = new Set()));
			keys.add(key);
		} else if (keys) {
			keys.delete(key);
			if (keys.size === 0) this.expanded.delete(path);
		}
	}
}
