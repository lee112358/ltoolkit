/* 当前行 ↔ 独立笔记 —— 一条命令来回切。
 *
 *   行上是普通文字   →  在当前笔记的同一目录建一篇同名笔记，本行换成指向它的链接
 *   行上是这样的链接 →  把那篇笔记的内容取回来铺在本行下面，然后删掉笔记
 *
 * 链接用 fileManager.generateMarkdownLink 生成，跟随「设置 → 文件与链接」里
 * 的链接格式；取回时 [[wiki]] 和 [](md) 两种都认。
 * 行首的缩进、列表标记、复选框、井号一律原样保留，只换正文那一段。
 * 删除走 fileManager.trashFile，遵循用户自己选的删除方式（废纸篓 / .trash / 永久）。
 */

import { Component, Notice, TFile } from "obsidian";
import { parseLine } from "./line-edit.js";

export const ID = "lineToNote";

/* 整段正文正好是一个链接时才算「可以收回」 */
const WIKI = /^!?\[\[([^\]|#^]+)(?:[#^][^\]|]*)?(?:\|[^\]]*)?\]\]$/;
const MD = /^!?\[[^\]]*\]\(([^)]+)\)$/;

/* 文件名里不能出现的字符，以及 Obsidian 链接语法自己会吃掉的那几个 */
const ILLEGAL = /[\\/:*?"<>|#^[\]]/g;

function linkTarget(body) {
	const wiki = WIKI.exec(body);
	if (wiki) return wiki[1].trim();

	const md = MD.exec(body);
	if (!md) return null;
	try {
		return decodeURIComponent(md[1]).trim();
	} catch {
		return md[1].trim(); // 不是合法的百分号编码就按原样当路径
	}
}

function toFileName(body) {
	return body
		.replace(ILLEGAL, "")
		.replace(/\s+/g, " ")
		.trim()
		.replace(/^\.+/, "") // 以点开头会变成隐藏文件
		.slice(0, 100);
}

/* 笔记的 frontmatter 是文件级的元数据，铺回正文中间没有意义 */
function stripFrontmatter(text) {
	if (!text.startsWith("---\n")) return text;

	const close = text.indexOf("\n---", 3);
	if (close === -1) return text;

	const lineEnd = text.indexOf("\n", close + 1);
	return lineEnd === -1 ? "" : text.slice(lineEnd + 1);
}

export class LineToNote extends Component {
	constructor(app, plugin) {
		super();
		this.app = app;
		this.plugin = plugin;
	}

	onload() {
		this.register(
			this.plugin.useCommand(ID, {
				id: "line-to-note",
				name: "当前行转成笔记 / 收回",
				icon: "file-symlink",
				editorCallback: (editor, ctx) => {
					const file = ctx?.file ?? this.app.workspace.getActiveFile();
					if (file) this.run(editor, file);
					else new Notice("当前视图没有对应的文件");
				},
			}),
		);
	}

	async run(editor, file) {
		const index = editor.getCursor().line;
		const text = editor.getLine(index);
		const { body } = parseLine(text);
		if (body.trim() === "") {
			new Notice("当前行没有内容");
			return;
		}

		// body 一定是 text 的后缀，前面那截（缩进 + 列表标记 + 井号）原样留着
		const head = text.slice(0, text.length - body.length);

		try {
			const target = linkTarget(body.trim());
			if (target) await this.inline(editor, file, index, head, target);
			else await this.extract(editor, file, index, head, body.trim());
		} catch (err) {
			console.error("[ltoolkit] line-to-note", err);
			new Notice(`操作失败：${err.message}`);
		}
	}

	/* 文字 → 新笔记 */
	async extract(editor, file, index, head, body) {
		const name = toFileName(body);
		if (name === "") {
			new Notice("这行里没有能当文件名的字符");
			return;
		}

		const folder = file.parent?.path ?? "";
		const path = folder && folder !== "/" ? `${folder}/${name}.md` : `${name}.md`;

		// 同名笔记已经在了就直接链过去，不覆盖别人的内容
		let note = this.app.vault.getAbstractFileByPath(path);
		if (note instanceof TFile) new Notice(`已存在同名笔记，直接链接过去：${name}`);
		else note = await this.app.vault.create(path, "");

		const link = this.app.fileManager.generateMarkdownLink(note, file.path);
		const line = head + link;
		editor.setLine(index, line);
		editor.setCursor({ line: index, ch: line.length });
	}

	/* 笔记 → 铺回正文，然后删掉笔记 */
	async inline(editor, file, index, head, target) {
		const note = this.app.metadataCache.getFirstLinkpathDest(target, file.path);
		if (!note) {
			new Notice(`找不到笔记：${target}`);
			return;
		}

		const content = stripFrontmatter(await this.app.vault.read(note)).replace(/\s+$/, "");
		// 标题回到本行，内容依次铺在下面；笔记是空的就正好还原成原来那一行
		const lines = [head + note.basename, ...(content === "" ? [] : content.split("\n"))];

		editor.replaceRange(
			lines.join("\n"),
			{ line: index, ch: 0 },
			{ line: index, ch: editor.getLine(index).length },
		);
		editor.setCursor({ line: index, ch: lines[0].length });

		const others = this.otherLinkers(note, file);
		await this.app.fileManager.trashFile(note);
		new Notice(
			others === 0
				? `已收回并删除笔记：${note.basename}`
				: `已收回并删除笔记：${note.basename}（另有 ${others} 篇笔记链接到它，链接已失效）`,
		);
	}

	/* 除当前笔记外还有几篇链接到它 —— 删之前给个提醒，不拦着 */
	otherLinkers(note, file) {
		const resolved = this.app.metadataCache.resolvedLinks ?? {};
		let count = 0;
		for (const [source, targets] of Object.entries(resolved)) {
			if (source !== file.path && targets[note.path]) count++;
		}
		return count;
	}
}
