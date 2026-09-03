/* 清理未引用的附件 —— 扫描出孤儿附件，逐个确认后再删。
 *
 * 判定逻辑在 attachment-scan.js（无 obsidian 依赖，可单独测试），
 * 这里只负责入口、确认弹窗和删除。
 * 删除走 fileManager.trashFile，遵循用户在「文件与链接」里选择的删除方式
 * （系统废纸篓 / vault 内 .trash / 永久删除），不绕过它。
 */

import { Component, Modal, Notice, Setting } from "obsidian";
import { findUnreferencedAttachments } from "./attachment-scan.js";
import { resolveRoot } from "./attachment-path.js";

export const ID = "attachmentCleaner";

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "avif"]);

function formatSize(bytes) {
	if (!Number.isFinite(bytes)) return "";
	const units = ["B", "KB", "MB", "GB"];
	let value = bytes;
	let unit = 0;
	while (value >= 1024 && unit < units.length - 1) {
		value /= 1024;
		unit++;
	}
	return `${unit === 0 ? value : value.toFixed(1)} ${units[unit]}`;
}

export class AttachmentCleaner extends Component {
	constructor(app, plugin) {
		super();
		this.app = app;
		this.plugin = plugin;
	}

	onload() {
		// addCommand 返回带最终 id 的命令对象，用它注销才不会依赖 id 的前缀规则
		const command = this.plugin.addCommand({
			id: "clean-unused-attachments",
			name: "清理未引用的附件",
			callback: () => this.run(),
		});
		this.register(() => this.plugin.removeCommand(command.id));
	}

	async run() {
		const folder = resolveRoot(this.app, this.plugin.getOption(ID, "folder"));
		if (!folder) {
			new Notice(
				"请先在设置里填写附件文件夹，或把 Obsidian 的「附件默认存放位置」设成一个固定目录",
			);
			return;
		}

		const notice = new Notice(`正在扫描 ${folder} …`, 0);
		let orphans;
		try {
			orphans = await findUnreferencedAttachments(this.app, folder);
		} catch (err) {
			console.error("[ltoolkit] 扫描附件失败", err);
			new Notice(`扫描失败：${err.message}`);
			return;
		} finally {
			notice.hide();
		}

		if (orphans.length === 0) {
			new Notice(`${folder} 里没有未被引用的附件`);
			return;
		}

		new OrphanModal(this.app, folder, orphans, (files) => this.trash(files)).open();
	}

	async trash(files) {
		let removed = 0;
		const failed = [];
		for (const file of files) {
			try {
				// 老版本没有 fileManager.trashFile，退回 vault.trash（true = 系统废纸篓）
				if (this.app.fileManager.trashFile) await this.app.fileManager.trashFile(file);
				else await this.app.vault.trash(file, true);
				removed++;
			} catch (err) {
				console.error(`[ltoolkit] 删除 ${file.path} 失败`, err);
				failed.push(file.path);
			}
		}

		if (failed.length === 0) new Notice(`已删除 ${removed} 个附件`);
		else new Notice(`已删除 ${removed} 个，${failed.length} 个失败，详见控制台`);
	}
}

class OrphanModal extends Modal {
	constructor(app, folder, orphans, onConfirm) {
		super(app);
		this.folder = folder;
		this.orphans = orphans;
		this.onConfirm = onConfirm;
		this.selected = new Set(orphans.map((f) => f.path));
	}

	onOpen() {
		this.modalEl.addClass("lt-cleaner-modal");
		const { contentEl } = this;
		contentEl.empty();

		const total = this.orphans.reduce((sum, f) => sum + (f.stat?.size ?? 0), 0);
		contentEl.createEl("h3", {
			text: `${this.folder} 里有 ${this.orphans.length} 个附件没有被引用`,
		});
		contentEl.createEl("p", {
			cls: "lt-cleaner-hint",
			text: `共 ${formatSize(total)}。取消勾选可以保留；删除按「文件与链接 → 已删除文件」里选的方式处理。`,
		});

		const list = contentEl.createDiv({ cls: "lt-cleaner-list" });
		for (const file of this.orphans) this.renderRow(list, file);

		const footer = contentEl.createDiv({ cls: "lt-cleaner-footer" });
		const count = footer.createSpan({ cls: "lt-cleaner-count" });
		const updateCount = () => {
			count.setText(`已选 ${this.selected.size} / ${this.orphans.length}`);
			deleteButton.setDisabled(this.selected.size === 0);
		};
		this.updateCount = updateCount;

		const buttons = footer.createDiv({ cls: "lt-cleaner-buttons" });
		let deleteButton;
		new Setting(buttons)
			.addButton((b) =>
				b.setButtonText("全不选").onClick(() => {
					this.selected.clear();
					this.contentEl
						.findAll("input[type=checkbox]")
						.forEach((el) => (el.checked = false));
					updateCount();
				}),
			)
			.addButton((b) => b.setButtonText("取消").onClick(() => this.close()))
			.addButton((b) => {
				deleteButton = b;
				return b
					.setButtonText("删除所选")
					.setWarning()
					.onClick(() => {
						const files = this.orphans.filter((f) => this.selected.has(f.path));
						this.close();
						this.onConfirm(files);
					});
			});

		updateCount();
	}

	renderRow(list, file) {
		const row = list.createDiv({ cls: "lt-cleaner-row" });

		const checkbox = row.createEl("input", { type: "checkbox" });
		checkbox.checked = true;
		checkbox.addEventListener("change", () => {
			if (checkbox.checked) this.selected.add(file.path);
			else this.selected.delete(file.path);
			this.updateCount();
		});

		const thumb = row.createDiv({ cls: "lt-cleaner-thumb" });
		if (IMAGE_EXTENSIONS.has(file.extension)) {
			thumb.createEl("img", { attr: { src: this.app.vault.getResourcePath(file) } });
		} else {
			thumb.createSpan({ text: file.extension.toUpperCase() });
		}

		const meta = row.createDiv({ cls: "lt-cleaner-meta" });
		meta.createDiv({ cls: "lt-cleaner-name", text: file.name });
		meta.createDiv({
			cls: "lt-cleaner-path",
			text: `${file.path} · ${formatSize(file.stat?.size ?? 0)}`,
		});
	}

	onClose() {
		this.contentEl.empty();
	}
}
