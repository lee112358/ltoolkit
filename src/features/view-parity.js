/* 编辑与阅读视图观感一致 —— 这里管两件 CSS 单独做不到的事。
 *
 * 一、源码里紧挨着的两块。
 *
 * markdown 里「上一块和这一块之间有没有空行」不进渲染结果：`文字\n- 列表` 和
 * `文字\n\n- 列表` 渲染出来的 HTML 一模一样，阅读视图两种写法都照给一个
 * --p-spacing。编辑视图那边空行是真实存在的一行，没写就是紧挨着，于是同一段
 * 内容两边差出整整一行。
 *
 * CSS 看不到源码，只能走后处理器：ctx.getSectionInfo(el) 给出这一段在源文件里
 * 的行号区间，回头看一眼上一行是不是空行，不是就给这块挂上 lt-tight-top，
 * 剩下的交给 view-parity.css。
 *
 * 二、正文以序号开头的任务。`- [ ] 1. 内容` 里复选框后面那截「1. 内容」在
 * markdown 看来又是一个有序列表，阅读视图于是把它渲染成嵌在任务里的子列表：
 * 复选框单独占一行，「1.」缩进一级落到下一行。编辑视图那边只是一行字。这里
 * 把那层子列表拆掉，序号还原成正文开头的文字，跟编辑视图一个样。
 */

import { Component, MarkdownPreviewRenderer } from "obsidian";

export const ID = "viewParity";

const TIGHT_CLASS = "lt-tight-top";

/* 任务标记后面紧跟的有序列表标记，取原文里的写法（「1.」还是「1)」） */
const TASK_NUMBER = /^\s*(?:[-*+]|\d+[.)])\s+\[.\]\s+(\d+[.)])\s/;

/* info.text 是整篇原文，同一次重绘里每一段拿到的都是同一个字符串。每段都
 * split 一遍就是 O(篇幅 × 段数)，记住上一次的结果，长笔记也只切一次。 */
let cache = null;

function scan(text) {
	if (cache?.text === text) return cache;

	const lines = text.split("\n");

	/* frontmatter 的收尾那行 --- 不是正文，它底下第一块该照常留上边距，
	 * 不能因为「上一行不是空行」就判成紧挨着。 */
	let start = 0;
	if (lines[0]?.trim() === "---") {
		const end = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
		if (end !== -1) start = end + 1;
	}

	cache = { text, lines, start };
	return cache;
}

export class ViewParity extends Component {
	constructor(app) {
		super();
		this.app = app;
	}

	onload() {
		/* 不走 plugin.registerMarkdownPostProcessor：那个挂在插件寿命上，单独
		 * 关掉这项功能时摘不下来。自己注册、自己摘，顺带 trigger 一下让开着的
		 * 阅读视图重画一遍，开关一拨立刻见效。 */
		this.processor = (el, ctx) => {
			this.markTight(el, ctx);
			this.flattenTaskNumbers(el, ctx);
		};
		MarkdownPreviewRenderer.registerPostProcessor(this.processor);
		this.app.workspace.trigger("post-processor-change");

		this.register(() => {
			MarkdownPreviewRenderer.unregisterPostProcessor(this.processor);
			this.app.workspace.trigger("post-processor-change");
		});
	}

	markTight(el, ctx) {
		el.removeClass(TIGHT_CLASS); // 同一段重画时别留着上一次的判断

		const info = ctx.getSectionInfo(el);
		if (!info) return; // 嵌入内容之类拿不到源文件位置，放过

		const { lines, start } = scan(info.text);
		if (info.lineStart <= start) return; // 正文第一块，本来就没有上边距

		const previous = lines[info.lineStart - 1];
		if (previous !== undefined && previous.trim() !== "") el.addClass(TIGHT_CLASS);
	}

	flattenTaskNumbers(el, ctx) {
		for (const item of el.querySelectorAll("li.task-list-item")) {
			const list = [...item.children].find((child) => child.tagName === "OL");
			if (!list || list.children.length !== 1) continue;

			/* 复选框和子列表之间有字，说明序号不在正文开头，是真的子列表 */
			const before = [];
			for (const node of item.childNodes) {
				if (node === list) break;
				before.push(node);
			}
			if (before.some((node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim()))
				continue;

			const inner = list.children[0];
			item.insertBefore(
				document.createTextNode(`${this.taskNumber(item, ctx, el) ?? `${list.start}.`} `),
				list,
			);
			while (inner.firstChild) item.insertBefore(inner.firstChild, list);
			list.remove();
		}
	}

	/* 从原文读出序号的写法；读不到（嵌入内容之类）就按 ol.start 补一个「N.」 */
	taskNumber(item, ctx, el) {
		const info = ctx.getSectionInfo(el);
		const line = Number(item.dataset.line);
		if (!info || Number.isNaN(line)) return null;
		return scan(info.text).lines[info.lineStart + line]?.match(TASK_NUMBER)?.[1] ?? null;
	}
}
