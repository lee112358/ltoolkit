/* 转换为表格 —— 把已经写好的几行文字直接变成 Markdown 表格。
 *
 * 内置只有 editor:insert-table，插一张空表，不认光标底下现成的内容。
 * 这条命令按光标处的情况分三种：
 *
 *   光标所在行是空的      → 转交内置的 editor:insert-table
 *   光标所在行有内容      → 该行按空白切成表头，再补两个空行（共三行）
 *   选中了多行            → 每行各切一行，第一行当表头，末尾再补一个空行
 *
 * 切分用空格或 Tab，连续多个算一个；行首的列表标记、标题井号先去掉，
 * 不会跑进第一个单元格里。单元格里的 | 会转义成 \|。
 * 输出对齐到列宽，和内置插入的表格是同一个风格。
 */

import { Component, Notice } from "obsidian";
import { parseLine } from "./line-edit.js";

export const ID = "toTable";

/* 等宽字体下占两格的字符（CJK、全角标点等），中文表格的源码才对得齐 */
const WIDE = /[ᄀ-ᅟ⺀-〾ぁ-㏿㐀-䶿一-鿿ꀀ-꓏가-힣豈-﫿︰-﹯＀-｠￠-￦]/;

function cellWidth(text) {
	let width = 0;
	for (const char of text) width += WIDE.test(char) ? 2 : 1;
	return width;
}

function toCells(text) {
	const { body } = parseLine(text);
	const trimmed = body.trim();
	if (trimmed === "") return [];
	return trimmed.split(/[ \t]+/).map((cell) => cell.replace(/\|/g, "\\|"));
}

/* rows 是已经切好的单元格，emptyRows 是末尾补几个空行 */
function buildTable(rows, emptyRows) {
	const columns = Math.max(...rows.map((row) => row.length));
	const grid = rows.map((row) => [...row, ...Array(columns - row.length).fill("")]);
	for (let i = 0; i < emptyRows; i++) grid.push(Array(columns).fill(""));

	// 列宽至少 3，才放得下分隔行的 ---
	const widths = [];
	for (let column = 0; column < columns; column++) {
		widths.push(Math.max(3, ...grid.map((row) => cellWidth(row[column]))));
	}

	const render = (row) =>
		`| ${row.map((cell, i) => cell + " ".repeat(widths[i] - cellWidth(cell))).join(" | ")} |`;

	const separator = `| ${widths.map((width) => "-".repeat(width)).join(" | ")} |`;
	return [render(grid[0]), separator, ...grid.slice(1).map(render)];
}

export class ToTable extends Component {
	constructor(app, plugin) {
		super();
		this.app = app;
		this.plugin = plugin;
	}

	onload() {
		this.register(
			this.plugin.useCommand(ID, {
				id: "to-table",
				name: "转换为表格",
				icon: "table",
				editorCallback: (editor) => this.run(editor),
			}),
		);
	}

	run(editor) {
		const selection = editor.listSelections()[0];
		const from = Math.min(selection.anchor.line, selection.head.line);
		const to = Math.max(selection.anchor.line, selection.head.line);

		const rows = [];
		for (let line = from; line <= to; line++) {
			const cells = toCells(editor.getLine(line));
			if (cells.length > 0) rows.push(cells);
		}

		if (rows.length === 0) {
			this.insertEmpty();
			return;
		}

		// 单行时补两个空行凑够三行，多行时只在末尾补一个
		const table = buildTable(rows, rows.length === 1 ? 2 : 1);

		/* 表格得自成一个块：紧贴在上一段后面会被当成那一段的延续文字，
		 * 紧贴着下一段则会把下一段吞成表格的一行。缺哪边就补哪边的空行。 */
		const blankAbove = from === 0 || editor.getLine(from - 1).trim() === "";
		const blankBelow = to === editor.lastLine() || editor.getLine(to + 1).trim() === "";
		const head = blankAbove ? "" : "\n";
		const text = head + table.join("\n") + (blankBelow ? "" : "\n");

		editor.replaceRange(
			text,
			{ line: from, ch: 0 },
			{ line: to, ch: editor.getLine(to).length },
		);

		// 光标落进第一个空单元格：表头 + 分隔行 + 已有内容行之后的那一行
		const line = from + (head ? 1 : 0) + 1 + rows.length;
		editor.setCursor({ line, ch: 2 });
	}

	insertEmpty() {
		// app.commands 不在公开类型里，但一直是这个用法；万一没有就提示一声
		const ran = this.app.commands?.executeCommandById?.("editor:insert-table");
		if (!ran) new Notice("没找到内置的「插入表格」命令");
	}
}
