/* 代码块的文件名与语言 —— ```python ~/sshd.conf 这样在语言后面跟一段文字，
 * 把它显示在代码块左上角；顺带给阅读视图补上实时预览才有的语言标签。
 *
 * 名字只能从原文里翻。Obsidian 解析围栏行用的是
 *   /^\s*(~~~+|```+)[ \t]*([\w\/+#-]*)[^\n`]*$/
 * 只取第二组当语言，后面那截 info string 当场丢掉，既不进 class
 * （只有 language-python）也不进 data-*，渲染完的 DOM 里查不到。
 *
 * 两种视图各有各的拿法：
 *
 *   阅读视图    走 markdown 后处理器，ctx.getSectionInfo(el) 给出这一段在
 *               源文件里的行号区间，自己数围栏，再往 pre 里塞一行文件名。
 *   实时预览    走 CodeMirror 扩展，给围栏起始行挂一个 data-lt-filename，
 *               CSS 用 attr() 把它显示出来。光标在代码块里时 Obsidian 原样
 *               显示围栏行，这时候不该重复显示 —— 判据是那颗语言标签
 *               （.code-block-flair）：它和「把围栏行折叠掉」是同一个分支
 *               里加的，有它就说明围栏行被折了，CSS 里用 :has() 一问便知。
 *
 * 数围栏按 CommonMark 的规矩：只有同种符号、且不短于开头那串的行才算收尾，
 * 所以 ````md 里裹着的 ``` 不会被当成结束，嵌套代码块也能对上号。
 */

import { Component, MarkdownPreviewRenderer } from "obsidian";
import { Decoration, ViewPlugin } from "@codemirror/view";
import { RangeSetBuilder } from "@codemirror/state";

export const ID = "codeBlockFilename";

const NAME_CLASS = "lt-code-filename";
const LANG_CLASS = "lt-code-lang";
const ATTRIBUTE = "data-lt-filename";

/* 围栏起始行：至少三个 ` 或 ~，接语言，再空格接名字（名字可以带空格） */
const FENCE_WITH_NAME = /^\s*(?:`{3,}|~{3,})\s*(\S+)[ \t]+(\S.*?)\s*$/;
const FENCE_MARKER = /^\s*(`{3,}|~{3,})/;

/* 逐行扫描，每遇到一个围栏代码块的**起始行**回调一次。
 * fence 为 { lang, name }，没写名字则是 null。
 * 行内容由 textAt 取，这样阅读视图给数组、实时预览给 doc，两边共用一套逻辑。 */
function eachFence(count, textAt, visit) {
	let open = null; // 当前还没收尾的那串围栏符号

	for (let index = 0; index < count; index++) {
		const text = textAt(index);
		const marker = text.match(FENCE_MARKER);
		if (!marker) continue;

		if (open) {
			// 同种符号、且不比开头短，才算把这个块收掉；否则只是块里的内容
			if (marker[1][0] === open[0] && marker[1].length >= open.length) open = null;
			continue;
		}

		open = marker[1];
		const parsed = text.match(FENCE_WITH_NAME);
		visit(index, parsed ? { lang: parsed[1], name: parsed[2] } : null);
	}
}

/* 语言的显示名。和 Obsidian 给实时预览那颗标签用的是同一套映射
 * （CodeMirror.findModeByName），这样两个视图里写的是同一个词。
 * 拿不到就退回原样，不强求。 */
function displayLanguage(lang) {
	try {
		const mode = window.CodeMirror?.findModeByName?.(lang);
		if (mode?.name && mode.name !== "null") return mode.name;
	} catch {
		// findModeByName 对怪字符串会抛，忽略即可
	}
	return lang;
}

/* 实时预览：给每个围栏起始行挂上 data-lt-filename。
 *
 * 整篇扫而不是只扫视口内 —— 围栏的开合状态得从头累计，从视口起点算不出来，
 * 而每行只是两次正则，几千行的笔记也就几毫秒。只在文档变了时重算。 */
function buildDecorations(state) {
	const builder = new RangeSetBuilder();
	const doc = state.doc;

	eachFence(
		doc.lines,
		(index) => doc.line(index + 1).text,
		(index, fence) => {
			if (!fence?.name) return;
			const from = doc.line(index + 1).from;
			builder.add(from, from, Decoration.line({ attributes: { [ATTRIBUTE]: fence.name } }));
		},
	);

	return builder.finish();
}

const filenameLines = ViewPlugin.fromClass(
	class {
		constructor(view) {
			this.decorations = buildDecorations(view.state);
		}

		update(update) {
			// 没改文档，行的位置和内容都没动，旧的那份继续用
			if (update.docChanged) this.decorations = buildDecorations(update.state);
		}
	},
	{ decorations: (value) => value.decorations },
);

export class CodeBlockFilename extends Component {
	constructor(app, plugin) {
		super();
		this.app = app;
		this.plugin = plugin;
	}

	onload() {
		this.register(this.plugin.useEditorExtension(filenameLines));

		/* 不走 plugin.registerMarkdownPostProcessor：那个是挂在插件寿命上的，
		 * 单独关掉这项功能时摘不下来。自己注册、自己摘，顺带 trigger 一下，
		 * Obsidian 收到 post-processor-change 会把开着的阅读视图重画一遍，
		 * 开关一拨立刻见效。 */
		this.processor = (el, ctx) => this.decorate(el, ctx);
		MarkdownPreviewRenderer.registerPostProcessor(this.processor);
		this.app.workspace.trigger("post-processor-change");

		this.register(() => {
			MarkdownPreviewRenderer.unregisterPostProcessor(this.processor);
			this.app.workspace.trigger("post-processor-change");
		});
	}

	/* 设置面板里改完开关，main.js 的 setOption 会回调这里 */
	refresh() {
		this.app.workspace.trigger("post-processor-change");
	}

	decorate(el, ctx) {
		const blocks = el.findAll("pre > code");
		if (blocks.length === 0) return;

		const info = ctx.getSectionInfo(el);
		if (!info) return; // 嵌入内容之类拿不到源文件位置，放过

		const lines = info.text.split("\n").slice(info.lineStart, info.lineEnd + 1);
		const found = [];
		eachFence(
			lines.length,
			(index) => lines[index],
			(_index, fence) => found.push(fence),
		);

		const showLang = this.plugin.getOption(ID, "lang") !== false;

		blocks.forEach((code, index) => {
			const pre = code.parentElement;
			// 实时预览里 mermaid、dataview 这类会就地渲染成一小块 markdown-rendered，
			// 那边围栏行本来就看得见，不掺和
			if (pre.closest(".cm-preview-code-block")) return;

			// 重复处理同一段时别叠加
			pre.querySelector(`:scope > .${NAME_CLASS}`)?.remove();
			pre.querySelector(`:scope > .${LANG_CLASS}`)?.remove();

			if (showLang) this.addLanguage(pre, code);

			const fence = found[index];
			if (!fence?.name) return;

			// 一段里有多个代码块时只能按顺序对应，中间要是有块被别的插件换掉了
			// 序号就会错位。拿语言名核对一次，对不上宁可不显示
			const expected = `language-${fence.lang}`.toLowerCase();
			const matches = Array.from(code.classList).some(
				(cls) => cls.toLowerCase() === expected,
			);
			if (!matches) return;

			const header = pre.createDiv({ cls: NAME_CLASS, text: fence.name });
			pre.prepend(header); // createDiv 是往后追加的，挪到最前面去
		});
	}

	/* 阅读视图右上角的语言标签。Obsidian 只在实时预览里画这颗
	 * （.code-block-flair 是个 CodeMirror widget），阅读视图这边只有一颗
	 * 悬停才出现的复制按钮，位置正好重叠 —— 所以 CSS 里鼠标移上去就把它让开。 */
	addLanguage(pre, code) {
		const lang = Array.from(code.classList)
			.find((cls) => cls.startsWith("language-"))
			?.slice("language-".length);
		if (!lang) return; // 没写语言的代码块不加标签，和实时预览一致

		pre.createSpan({ cls: LANG_CLASS, text: displayLanguage(lang) });
	}
}
