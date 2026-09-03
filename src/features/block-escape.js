/* Esc 选中整块 —— Notion 里 Esc 把「在块里打字」切成「选中这个块」。
 *
 * Obsidian 没有块选中这个状态，最接近的表达就是把整块的文本选起来。
 * 表格是例外：只选中光标所在的那一格，不扩到整张表。
 *
 * Esc 在 Obsidian 里本来就有用（关自动补全、关菜单、关弹窗），所以让行条件写得
 * 比较保守：只在编辑器内、没有任何弹窗、没开 vim 模式时才接管；整块已经选中了
 * 也放行，这样连按第二下 Esc 仍然走原本的行为。
 */

import { Component, MarkdownView } from "obsidian";
import { blockRangeAt, nextStage, normalize, tableCellRange } from "./block-range.js";

export const ID = "blockEscape";

/* 这些一出现就说明 Esc 另有归属 */
const POPUPS = ".suggestion-container, .modal-container, .prompt, .menu, .cm-tooltip-autocomplete";

export class BlockEscape extends Component {
	constructor(app, plugin) {
		super();
		this.app = app;
		this.plugin = plugin;
	}

	onload() {
		this.registerDomEvent(document, "keydown", this.onKeyDown.bind(this), { capture: true });
	}

	onKeyDown(evt) {
		if (evt.key !== "Escape" || evt.isComposing || evt.repeat) return;
		if (evt.metaKey || evt.ctrlKey || evt.altKey || evt.shiftKey) return;

		// vim 模式下 Esc 是退出插入模式，绝对不能抢
		if (this.app.vault?.getConfig?.("vimMode")) return;
		if (document.querySelector(POPUPS)) return;

		const target = evt.target instanceof HTMLElement ? evt.target : null;
		if (!target?.closest(".cm-editor")) return;

		let handled = false;
		try {
			handled = this.selectBlock();
		} catch (err) {
			console.error("[ltoolkit] block-escape", err);
			return;
		}

		if (handled) {
			evt.preventDefault();
			evt.stopPropagation();
		}
	}

	selectBlock() {
		const editor =
			this.app.workspace.activeEditor?.editor ??
			this.app.workspace.getActiveViewOfType(MarkdownView)?.editor;
		if (!editor) return false;

		const tabSize = Number(this.app.vault?.getConfig?.("tabSize")) || 4;
		const line = editor.getCursor("head").line;
		const block = blockRangeAt((i) => editor.getLine(i), editor.lineCount(), line, tabSize);
		if (!block) return false;

		const current = normalize(editor.listSelections()[0]);

		/* 平常一步到位选中整块。表格只选光标所在的那一格，不扩到整张表。 */
		const stages =
			block.kind === "table"
				? (() => {
						const cell = tableCellRange(editor.getLine(line), current.from.ch);
						return cell
							? [{ from: { line, ch: cell.from }, to: { line, ch: cell.to } }]
							: [];
					})()
				: [
						{
							from: { line: block.start, ch: 0 },
							to: { line: block.end, ch: editor.getLine(block.end).length },
						},
					];

		// 已经是最大一级了就放行，让 Esc 回到它原本的用途
		const next = nextStage(stages, current);
		if (!next) return false;

		editor.setSelection(next.from, next.to);
		return true;
	}
}
