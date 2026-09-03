/* 清除段落标签 —— 把行首的块级标记扒干净，只留正文。
 *
 * 内置的 editor:clear-formatting 不能用：它要求先选中文字，而且是把语法树里
 * 所有 formatting 节点删光，加粗、行内代码的标记也一并清掉。
 * editor:set-heading-0 只脱标题，列表和任务不管。
 *
 * 这条命令只动行首的标记：标题井号、项目/编号列表标记、任务复选框。
 * 缩进和引用前缀（>）保留 —— 缩进层级是用户自己排的版，去掉引用用内置的
 * editor:toggle-blockquote。正文里的 **加粗**、`行内代码`、链接一概不碰。
 */

import { Component } from "obsidian";
import { editLines, parseLine } from "./line-edit.js";

export const ID = "clearParagraphMarker";

function clear(text) {
	const line = parseLine(text);
	if (!line.bullet && line.heading === 0) return text;
	return line.prefix + line.body;
}

export class ClearParagraphMarker extends Component {
	constructor(app, plugin) {
		super();
		this.app = app;
		this.plugin = plugin;
	}

	onload() {
		this.register(
			this.plugin.useCommand(ID, {
				id: "clear-paragraph-marker",
				name: "清除段落标签",
				icon: "eraser",
				editorCallback: (editor) =>
					editLines(
						editor,
						(lines) =>
							new Map(lines.map((line) => [line, clear(editor.getLine(line))])),
					),
			}),
		);
	}
}
