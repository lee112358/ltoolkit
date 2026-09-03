/* 切换任务列表 —— 把右键菜单里那个「段落 → 任务列表」补成一条命令。
 *
 * Obsidian 内置只有 editor:toggle-checklist-status（勾选/取消勾选一个已有任务），
 * 没有「把这行变成任务」的命令，所以右键那一项绑不了快捷键。这里注册同名命令，
 * 之后在「设置 → 快捷键」里搜「切换任务列表」就能自定义按键。
 *
 * 规则：
 *   普通段落 / 项目列表 / 编号列表 / 标题  →  - [ ] 内容
 *   已经是任务                            →  去掉列表标记，还原成普通段落
 * 选区跨多行时只要还有一行不是任务，就整体转成任务；全是任务才整体还原。
 * 缩进和引用前缀（>）原样保留，正文里的加粗、行内代码不动。
 *
 * 另外会顺带修一个 Markdown 规则带来的坑，见 ensureListParent。
 */

import { Component } from "obsidian";
import { editLines, indentWidth, parseLine, quoteDepth } from "./line-edit.js";

export const ID = "toggleTaskList";

function toTask(line) {
	// 编号列表转任务时换成 -，无序列表沿用它原本的符号
	const marker = line.bullet && /^[-*+]$/.test(line.bullet) ? line.bullet : "-";
	return `${line.prefix}${marker} [ ] ${line.body}`;
}

function toggle(text, makeTask) {
	const line = parseLine(text);
	const isTask = line.checkbox !== null;

	if (makeTask) return isTask ? text : toTask(line);
	// 缩进原样留着，缩进层级是用户自己排的版，命令不去动它
	return isTask ? line.prefix + line.body : text;
}

/* 改动表里有这行就用改后的内容，没有才读文档 */
function textAt(editor, line, edits) {
	return edits.has(line) ? edits.get(line) : editor.getLine(line);
}

/* 让缩进的任务真的能渲染出来。
 *
 * Markdown 里嵌套列表必须挂在一个列表项下面，没有「缩进在普通段落下面的列表」
 * 这种结构：
 *
 *     问题描述          ← 普通段落
 *     　　- [ ] 任务     ← 缩进 ≥4 空格，被当成上一段的延续文字，复选框渲染不出来
 *
 * 所以往上找这行缩进该挂靠的那一行，如果它只是个普通段落，就补一个 "- " 让它
 * 成为列表项，缩进层级原样保住：
 *
 *     - 问题描述
 *     　　- [ ] 任务
 *
 * 上面那行已经是列表项（缩进合法）、是标题（标题装不下列表）、或处在不同的
 * 引用层级时都不动它。补完之后对它自己再来一遍，多层悬空缩进能一路补上去。 */
function ensureListParent(editor, line, edits, tabSize) {
	const self = parseLine(textAt(editor, line, edits));
	const width = indentWidth(self.indent, tabSize);
	if (width === 0) return;

	for (let above = line - 1; above >= 0; above--) {
		const text = textAt(editor, above, edits);
		if (text.trim() === "") continue;

		const parsed = parseLine(text);
		if (indentWidth(parsed.indent, tabSize) >= width) continue; // 同级或更深，继续往上

		if (parsed.bullet) return; // 已经有列表父项，缩进本来就合法
		if (parsed.heading > 0) return;
		if (quoteDepth(parsed.quote) !== quoteDepth(self.quote)) return;

		edits.set(above, `${parsed.prefix}- ${parsed.body}`);
		ensureListParent(editor, above, edits, tabSize);
		return;
	}
}

export class ToggleTaskList extends Component {
	constructor(app, plugin) {
		super();
		this.app = app;
		this.plugin = plugin;
	}

	onload() {
		this.register(
			this.plugin.useCommand(ID, {
				id: "toggle-task-list",
				name: "切换任务列表",
				icon: "check-square",
				editorCallback: (editor) => this.run(editor),
			}),
		);
	}

	run(editor) {
		const tabSize = Number(this.app.vault?.getConfig?.("tabSize")) || 4;

		editLines(editor, (lines) => {
			const makeTask = lines.some(
				(line) => parseLine(editor.getLine(line)).checkbox === null,
			);

			const edits = new Map();
			for (const line of lines) edits.set(line, toggle(editor.getLine(line), makeTask));

			// 补父项要在整张表填好之后：选区里上一行可能自己也刚变成任务
			if (makeTask) {
				for (const line of lines) ensureListParent(editor, line, edits, tabSize);
			}
			return edits;
		});
	}
}
