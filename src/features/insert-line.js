/* 上下插入新行 —— Sublime 的 Cmd+Enter / Cmd+Shift+Enter。
 *
 * 不管光标在行中间的什么位置，都在当前行的下方（或上方）另起一行并把光标移过去，
 * 当前行的内容一个字都不切开。
 *
 * Obsidian 没有对应的内置命令。`editor:` 里最接近的是 swap-line-up/down，
 * 那是把整行搬走，不是插入。CodeMirror 自带的 insertBlankLine 倒是被打进了
 * Obsidian、Mod-Enter 也不在 Obsidian 剔除的黑名单里，但那个键位默认绑给了
 * editor:open-link-in-new-leaf，会先被快捷键层截走；而且它插的是纯空行。
 * 「向上插入」在 CodeMirror 里连命令都没有，所以怎么绑都做不到。
 *
 * 行首标记会带到新行上，效果和「跳到行尾按回车」一致：缩进、引用前缀、列表
 * 标记都延续，有序列表接下一个号，任务项延续成未勾选。标题不延续 —— 回车之后
 * 本来就该是正文。代码块里只带缩进，不带任何 Markdown 标记，那里的 - 和 #
 * 只是代码。
 */

import { Component } from "obsidian";
import { findFences } from "./block-range.js";
import { parseLine } from "./line-edit.js";

export const ID = "insertLine";

const INDENT = /^[ \t]*/;
const ORDERED = /^(\d+)([.)])$/;

function inCodeBlock(editor, line) {
	const fences = findFences((i) => editor.getLine(i), editor.lineCount());
	return fences.some((fence) => line >= fence.start && line <= fence.end);
}

/* 新行该带的行首。向下插入时有序列表接下一个号；向上插入时沿用同一个号 ——
 * 插在 3. 上面的那一行才是新的第三条，原来那条顺延，剩下的交给 Obsidian
 * 自己的重新编号。 */
function prefixFor(editor, line, below) {
	const text = editor.getLine(line);
	if (inCodeBlock(editor, line)) return INDENT.exec(text)[0];

	const { prefix, bullet, checkbox } = parseLine(text);
	if (!bullet) return prefix;

	const ordered = ORDERED.exec(bullet);
	const number = ordered ? Number(ordered[1]) + (below ? 1 : 0) : 0;
	const marker = ordered ? `${number}${ordered[2]}` : bullet;
	const box = checkbox === null ? "" : "[ ] ";
	return `${prefix}${marker} ${box}`;
}

export class InsertLine extends Component {
	constructor(app, plugin) {
		super();
		this.app = app;
		this.plugin = plugin;
	}

	onload() {
		// addCommand 返回带最终 id 的命令对象，用它注销才不会依赖 id 的前缀规则
		for (const [id, name, below] of [
			["insert-line-below", "在下方插入新行", true],
			["insert-line-above", "在上方插入新行", false],
		]) {
			const command = this.plugin.addCommand({
				id,
				name,
				icon: below ? "corner-down-left" : "corner-left-up",
				editorCallback: (editor) => this.run(editor, below),
			});
			this.register(() => this.plugin.removeCommand(command.id));
		}
	}

	run(editor, below) {
		try {
			const line = editor.getCursor("head").line;
			const prefix = prefixFor(editor, line, below);

			if (below) {
				const end = { line, ch: editor.getLine(line).length };
				editor.replaceRange(`\n${prefix}`, end);
				editor.setCursor({ line: line + 1, ch: prefix.length });
			} else {
				editor.replaceRange(`${prefix}\n`, { line, ch: 0 });
				editor.setCursor({ line, ch: prefix.length });
			}
		} catch (err) {
			console.error("[ltoolkit] insert-line", err);
		}
	}
}
