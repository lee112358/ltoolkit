/* 渐进全选 —— Notion 式的 Cmd/Ctrl+A。
 *
 * 每按一次把选区放大一级：
 *   1. 当前行的正文（不含行首的列表标记、井号、引用前缀）
 *   2. 整块（整段 / 整个列表项含子项 / 整个代码块 / 整张表格 / 整个引用块）
 *   3. 本功能不再处理，交回编辑器自己的「全选整篇」
 *
 * 代码块里第 1 级是围栏之间的代码、第 2 级是连围栏一起的整块。
 * 表格是个例外，只做一级：选中光标所在的那一格就停，不再扩到整张表。
 * 实时预览下单元格是个嵌套的 CodeMirror，但 Obsidian 会把它和主编辑器的选区双向
 * 同步，所以按源码算出列边界再往主编辑器设选区就能正确显示。
 *
 * 用捕获阶段的 keydown 抢在 CodeMirror 的 selectAll 之前，
 * 且只有确认真的算出了下一级选区时才 preventDefault。
 */

import { Component, MarkdownView, Platform } from "obsidian";
import { blockRangeAt, nextStage, normalize, sameRange, tableCellRange } from "./block-range.js";
import { parseLine } from "./line-edit.js";

export const ID = "progressiveSelect";

export class ProgressiveSelect extends Component {
	constructor(app, plugin) {
		super();
		this.app = app;
		this.plugin = plugin;
	}

	onload() {
		this.registerDomEvent(document, "keydown", this.onKeyDown.bind(this), { capture: true });
	}

	onKeyDown(evt) {
		if (evt.isComposing || evt.repeat) return;
		if (evt.shiftKey || evt.altKey) return;

		// macOS 上 Ctrl+A 是「移到行首」，那里只认 Cmd
		const mod = Platform.isMacOS ? evt.metaKey && !evt.ctrlKey : evt.ctrlKey && !evt.metaKey;
		if (!mod) return;
		if (evt.code !== "KeyA" && evt.key?.toLowerCase() !== "a") return;

		const target = evt.target instanceof HTMLElement ? evt.target : null;

		let handled = false;
		try {
			handled = target?.closest(".cm-editor")
				? this.selectInEditor()
				: this.selectInReadingView();
		} catch (err) {
			console.error("[ltoolkit] progressive-select", err);
			return;
		}

		if (handled) {
			evt.preventDefault();
			evt.stopPropagation();
		}
	}

	/* 实时预览 / 源码模式 */
	selectInEditor() {
		const editor =
			this.app.workspace.activeEditor?.editor ??
			this.app.workspace.getActiveViewOfType(MarkdownView)?.editor;
		if (!editor) return false;

		const current = normalize(editor.listSelections()[0]);
		const stages = this.stagesAt(editor, editor.getCursor("head").line, current.from.ch);

		// 最大一级已经选中了：放行，让编辑器执行全选整篇
		const next = nextStage(stages, current);
		if (!next) return false;

		editor.setSelection(next.from, next.to);
		return true;
	}

	stagesAt(editor, line, ch) {
		const lineCount = editor.lineCount();
		const tabSize = Number(this.app.vault?.getConfig?.("tabSize")) || 4;
		const block = blockRangeAt((i) => editor.getLine(i), lineCount, line, tabSize);
		if (!block) return [];

		const whole = {
			from: { line: block.start, ch: 0 },
			to: { line: block.end, ch: editor.getLine(block.end).length },
		};

		/* 表格只做一级：选中光标所在的那一格，然后就放行。
		 * 不往上扩到整张表 —— 表格里真正想要的就是「把这格的内容选起来」。 */
		if (block.kind === "table") {
			const cell = tableCellRange(editor.getLine(line), ch);
			return cell ? [{ from: { line, ch: cell.from }, to: { line, ch: cell.to } }] : [];
		}

		const stages = [];
		if (block.kind === "code") {
			// 围栏之间的代码
			const first = block.start + 1;
			const last = block.closed ? block.end - 1 : block.end;
			if (last >= first) {
				stages.push({
					from: { line: first, ch: 0 },
					to: { line: last, ch: editor.getLine(last).length },
				});
			}
		} else {
			// 当前行的正文：body 一定是整行的后缀，前面那截就是行首标记
			const text = editor.getLine(line);
			const { body } = parseLine(text);
			if (body.trim() !== "") {
				stages.push({
					from: { line, ch: text.length - body.length },
					to: { line, ch: text.length },
				});
			}
		}

		// 单行无标记的段落两级会完全一样，去掉重复的那一级
		if (stages.length === 0 || !sameRange(stages[0], whole)) stages.push(whole);
		return stages;
	}

	/* 阅读模式：选中光标所在的那个渲染块 */
	selectInReadingView() {
		const selection = window.getSelection();
		if (!selection || selection.rangeCount === 0) return false;

		const anchor = selection.anchorNode;
		if (!anchor) return false;

		const el = anchor.nodeType === Node.TEXT_NODE ? anchor.parentElement : anchor;
		if (!el || el.closest(".cm-editor")) return false;

		const block = el.closest(
			".markdown-rendered pre, .markdown-rendered li, .markdown-rendered p, " +
				".markdown-rendered blockquote, .markdown-rendered table, " +
				".markdown-rendered h1, .markdown-rendered h2, .markdown-rendered h3, " +
				".markdown-rendered h4, .markdown-rendered h5, .markdown-rendered h6",
		);
		if (!block) return false;

		const full = document.createRange();
		full.selectNodeContents(block);

		const current = selection.getRangeAt(0);
		const alreadyFull =
			current.compareBoundaryPoints(Range.START_TO_START, full) === 0 &&
			current.compareBoundaryPoints(Range.END_TO_END, full) === 0;
		if (alreadyFull) return false; // 放行给全选整篇

		selection.removeAllRanges();
		selection.addRange(full);
		return true;
	}
}
