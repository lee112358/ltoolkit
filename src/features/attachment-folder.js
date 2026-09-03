/* 新附件按笔记路径分目录存放，而不是全部堆在附件根目录。
 *
 * 做法是接管 vault.getAvailablePathForAttachments。Obsidian 里所有会产生
 * 附件的动作 —— 粘贴、拖入、内置的「下载当前文件内的所有附件」、录音、
 * 移动端导入 —— 最终都汇聚到这一个方法，所以接管这一处就全都覆盖了，
 * 不需要分别去 hook 粘贴事件或改造内置命令。
 *
 * 两件事刻意不做：
 *   文件名不改  —— 重名交给 Obsidian 自己的 getAvailablePath，它会加
 *                 " 1" " 2" 后缀，够用了。
 *   链接不改    —— Obsidian 会按我们返回的路径、依用户的「新建链接格式」
 *                 自己生成，我们插手反而会和它打架。
 */

import { Component, Notice, TFile, TFolder } from "obsidian";
import { folderForNote, resolveRoot, sanitizeSegment } from "./attachment-path.js";

export const ID = "attachmentFolder";

/* 附件写入紧跟在路径查询之后；笔记来回拖动也会连续触发。
 * 等这么久再扫，既避开中间态又不会让空目录留太久。 */
const SWEEP_DELAY = 5000;

function parentOf(path) {
	const cut = path.lastIndexOf("/");
	return cut === -1 ? "" : path.slice(0, cut);
}

function depthOf(path) {
	return path.split("/").length;
}

export class AttachmentFolder extends Component {
	constructor(app, plugin) {
		super();
		this.app = app;
		this.plugin = plugin;
		this.sweepTimer = 0;
	}

	onload() {
		const vault = this.app.vault;
		const original = vault.getAvailablePathForAttachments;

		/* 这是个内部 API，换版本有可能改名。真没了就退场，不要连累别的功能 */
		if (typeof original !== "function") {
			console.error(
				"[ltoolkit] 未找到 vault.getAvailablePathForAttachments，附件分目录未生效",
			);
			new Notice("Lee Toolkit：附件分目录未生效，详见控制台");
			return;
		}

		const patched = async (basename, extension, sourceFile) => {
			try {
				const target = await this.resolve(basename, sourceFile);
				if (target) return this.app.vault.getAvailablePath(target, extension);
			} catch (err) {
				/* 宁可放回默认目录，也不能让粘贴或下载整个失败 */
				console.error("[ltoolkit] 附件分目录失败，回退默认位置", err);
			}
			return original.call(vault, basename, extension, sourceFile);
		};

		vault.getAvailablePathForAttachments = patched;

		this.register(() => {
			/* 只在最外层还是我们的时候才还原，避免踩掉后装插件的包装 */
			if (vault.getAvailablePathForAttachments === patched) {
				vault.getAvailablePathForAttachments = original;
			}
			window.clearTimeout(this.sweepTimer);
		});

		/* 笔记移动或改名后，把它的附件目录搬到新位置。
		 * 移动整个文件夹时 Obsidian 会为里面每篇笔记各发一次 rename，
		 * 所以逐篇处理天然就是对的。 */
		this.registerEvent(vault.on("rename", (file, oldPath) => this.onRename(file, oldPath)));
	}

	async onRename(file, oldPath) {
		if (!(file instanceof TFile) || file.extension !== "md") return;
		if (this.plugin.getOption(ID, "follow") === false) return;

		const root = this.root();
		const from = folderForNote(oldPath, root);
		const to = folderForNote(file.path, root);
		if (!from || !to || from === to) return;

		const source = this.app.vault.getAbstractFileByPath(from);
		if (source instanceof TFolder) {
			try {
				await this.moveFolder(source, to);
			} catch (err) {
				console.error("[ltoolkit] 附件目录跟随失败", err);
				new Notice("Lee Toolkit：附件目录未能跟随笔记移动，详见控制台");
			}
		}

		/* 不论搬没搬成，来回拖动都可能腾空一批目录，统一交给 sweep 收尾 */
		this.scheduleSweep();
	}

	/* 设置里填的根目录；留空就跟随 Obsidian 的附件设置 */
	root() {
		return resolveRoot(this.app, this.plugin.getOption(ID, "root"));
	}

	/* 返回「目录 + 不含扩展名的文件名」，重名处理交给调用方。
	 * 返回 null 表示这次不接管，退回 Obsidian 默认行为。 */
	async resolve(basename, sourceFile) {
		/* 下载类的调用点传的 sourceFile 是 null，此时当前打开的笔记就是目标 */
		const note = sourceFile ?? this.app.workspace.getActiveFile();
		if (!note || note.extension !== "md") return null;

		const folder = folderForNote(note.path, this.root());
		if (!folder) return null;

		await this.ensureFolder(folder);
		return `${folder}/${sanitizeSegment(basename)}`;
	}

	async moveFolder(source, targetPath) {
		const existing = this.app.vault.getAbstractFileByPath(targetPath);

		/* 目标不存在：整个目录一次搬过去，renameFile 会把链接一起改掉 */
		if (!existing) {
			const parent = parentOf(targetPath);
			if (parent) await this.ensureFolder(parent);
			await this.app.fileManager.renameFile(source, targetPath);
			return;
		}

		/* 目标已存在（同名笔记曾经存在过），只能逐个搬，重名交给 getAvailablePath。
		 * 子目录不动 —— 那不是我们建的，留着比错搬安全。 */
		for (const child of [...source.children]) {
			if (!(child instanceof TFile)) continue;
			const dest = this.app.vault.getAvailablePath(
				`${targetPath}/${child.basename}`,
				child.extension,
			);
			await this.app.fileManager.renameFile(child, dest);
		}
	}

	/* 逐级建目录。这里必须真的建出来 —— createBinary 只调 adapter.writeBinary，
	 * 不会补父目录，Obsidian 自己的实现也是因此才在路径查询里建目录的。 */
	async ensureFolder(path) {
		let current = "";
		for (const part of path.split("/")) {
			current = current ? `${current}/${part}` : part;
			if (this.app.vault.getAbstractFileByPath(current)) continue;
			try {
				await this.app.vault.createFolder(current);
			} catch (err) {
				/* 连续粘贴多张图时可能并发创建同一层，已存在就不算错 */
				if (!this.app.vault.getAbstractFileByPath(current)) throw err;
			}
		}
		this.scheduleSweep();
	}

	scheduleSweep() {
		window.clearTimeout(this.sweepTimer);
		this.sweepTimer = window.setTimeout(() => {
			this.sweep().catch((err) => console.error("[ltoolkit] 空目录回收失败", err));
		}, SWEEP_DELAY);
	}

	/* 扫整棵附件树，回收所有空目录。
	 *
	 * 不去追「这个空目录是怎么来的」—— 路径查询建了但没落盘、笔记来回拖动
	 * 腾空的、附件被删光的，成因太多。直接按结果判断，反而简单可靠。
	 *
	 * 只动附件根目录以下，根目录本身永远保留。删除走 trashFile，遵循用户在
	 * 「文件与链接」里选的删除方式。 */
	async sweep() {
		const root = this.root();
		if (!root) return;

		const rootFolder = this.app.vault.getAbstractFileByPath(root);
		if (!(rootFolder instanceof TFolder)) return;

		const folders = [];
		const collect = (folder) => {
			for (const child of folder.children) {
				if (child instanceof TFolder) {
					collect(child);
					folders.push(child.path);
				}
			}
		};
		collect(rootFolder);

		/* 深的先删，父目录才可能跟着变空；每次重新取一遍，拿到的才是最新状态 */
		folders.sort((a, b) => depthOf(b) - depthOf(a));
		for (const path of folders) {
			const folder = this.app.vault.getAbstractFileByPath(path);
			if (!(folder instanceof TFolder) || folder.children.length > 0) continue;
			await this.app.fileManager.trashFile(folder);
		}
	}
}
