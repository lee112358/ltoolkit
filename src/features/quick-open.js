/* 把「打开」和「新建」拆成两条命令。
 *
 * 内置快速切换（switcher:open）搜不到时回车就是新建，Shift+回车更是不管搜没搜到
 * 都新建，建在「新笔记默认位置」里 —— 手一快就在错的目录下多出一个空文件，
 * 而且它的设置里没有关掉这一点的开关。
 *
 *   快速打开   只列仓库里已有的文件，回车只会打开，搜不到就什么也不发生
 *   新建笔记   输入框里直接写路径，Tab 补全目录，第一行实时显示
 *              要建的完整路径，看清了再回车
 *
 * 两条命令都不占键，Cmd+P 要自己在快捷键设置里从内置快速切换改挂过来。
 */

import {
	Component,
	FuzzySuggestModal,
	Keymap,
	Notice,
	SuggestModal,
	TFile,
	TFolder,
	normalizePath,
	prepareFuzzySearch,
	renderResults,
} from "obsidian";

export const ID = "quickOpen";

/* 不开「包含附件」时只列这几种：笔记、画布、Bases */
const NOTE_EXTENSIONS = new Set(["md", "canvas", "base"]);

/* 系统层面不能进文件名的字符。# ^ [ ] | 虽然能建出来，但放进 [[链接]] 里会被当成语法 */
const BAD_CHARS = /[\\:*?"<>|#^[\]]/;

export class QuickOpen extends Component {
	constructor(app, plugin) {
		super();
		this.app = app;
		this.plugin = plugin;
	}

	onload() {
		this.register(
			this.plugin.useCommand(ID, {
				id: "quick-open",
				name: "快速打开（不新建）",
				icon: "search",
				callback: () => new OpenModal(this.app, this.plugin).open(),
			}),
		);
		this.register(
			this.plugin.useCommand(ID, {
				id: "new-note",
				name: "新建笔记（输入路径）",
				icon: "file-plus",
				callback: () => new NewNoteModal(this.app).open(),
			}),
		);
	}
}

/* 当前笔记所在的目录。焦点在侧边栏时 activeFile 拿不到，所以用 getMostRecentLeaf；
 * 什么都没开时退回 Obsidian 自己的「新笔记默认位置」。 */
function currentFolder(app) {
	const file = app.workspace.getMostRecentLeaf()?.view?.file;
	return file?.parent ?? app.fileManager.getNewFileParent("");
}

/* Cmd 回车 → 新标签页，Cmd+Option 回车 → 分栏，和内置快速切换一致 */
function registerModEnter(modal) {
	for (const modifiers of [["Mod"], ["Mod", "Alt"], ["Mod", "Alt", "Shift"]]) {
		modal.scope.register(modifiers, "Enter", (evt) => {
			modal.chooser.useSelectedItem(evt);
			return false;
		});
	}
}

class OpenModal extends FuzzySuggestModal {
	constructor(app, plugin) {
		super(app);
		this.plugin = plugin;
		this.setPlaceholder("输入文件名查找，只打开、不新建");
		this.emptyStateText = "没有匹配的文件。要新建请用「新建笔记（输入路径）」";
		this.setInstructions([
			{ command: "↵", purpose: "打开" },
			{ command: "⌘ ↵", purpose: "新标签页打开" },
			{ command: "⌘ ⌥ ↵", purpose: "分栏打开" },
			{ command: "esc", purpose: "关闭" },
		]);
		registerModEnter(this);
	}

	/* 没输入时 FuzzySuggestModal 按这里的顺序原样列出，所以最近打开的排最前 */
	getItems() {
		const attachments = this.plugin.getOption(ID, "attachments") === true;
		const files = this.app.vault
			.getFiles()
			.filter((f) => attachments || NOTE_EXTENSIONS.has(f.extension));

		const current = this.app.workspace.getActiveFile()?.path;
		const recent = this.app.workspace
			.getLastOpenFiles()
			.filter((path) => path !== current)
			.map((path) => this.app.vault.getAbstractFileByPath(path))
			.filter((f) => f instanceof TFile && files.includes(f));

		const rest = files
			.filter((f) => !recent.includes(f))
			.sort((a, b) => b.stat.mtime - a.stat.mtime);
		return [...recent, ...rest];
	}

	getItemText(file) {
		return file.extension === "md" ? file.path.slice(0, -3) : file.path;
	}

	onChooseItem(file, evt) {
		this.app.workspace.getLeaf(Keymap.isModEvent(evt)).openFile(file);
	}
}

/* 新建笔记：输入框里写的就是路径。
 *
 *   打开时预填当前笔记所在的目录加「/」，直接敲名字就建在这里
 *   下面列出和输入匹配的目录，Tab 把选中的目录补进输入框、末尾带上「/」
 *   第一行是「新建：完整路径」，回车就建；方向键移到某个目录上再回车，等同 Tab
 *
 * 路径里的目录不存在会逐级建出来，那一行会写明；同名笔记已经在了就直接打开它。 */
class NewNoteModal extends SuggestModal {
	constructor(app) {
		super(app);
		this.limit = 30;
		this.setPlaceholder("目录/笔记名，Tab 补全目录");
		this.setInstructions([
			{ command: "↵", purpose: "新建" },
			{ command: "tab", purpose: "补全目录" },
			{ command: "↑↓", purpose: "选目录" },
			{ command: "⌘ ↵", purpose: "新建到新标签页" },
			{ command: "esc", purpose: "取消" },
		]);
		registerModEnter(this);

		this.scope.register([], "Tab", (evt) => {
			evt.preventDefault();
			const values = this.chooser.values ?? [];
			const selected = values[this.chooser.selectedItem];
			const folder =
				selected?.type === "folder" ? selected : values.find((v) => v.type === "folder");
			if (folder) this.fill(folder.path);
			return false;
		});
	}

	/* 预填放在 onOpen 之后：光标得落在末尾，接着就能敲名字 */
	onOpen() {
		super.onOpen();
		const folder = currentFolder(this.app);
		if (!folder.isRoot()) this.fill(folder.path);
		const end = this.inputEl.value.length;
		this.inputEl.setSelectionRange(end, end);
	}

	fill(folderPath) {
		this.inputEl.value = `${folderPath}/`;
		this.inputEl.dispatchEvent(new Event("input"));
	}

	getSuggestions(query) {
		const rows = [];
		const target = resolvePath(this.app, query);
		if (target) rows.push(target);

		// 刚补全完、正处在某个目录里时，它自己不必再列一遍
		const dir = query.includes("/") ? query.slice(0, query.lastIndexOf("/")) : null;
		const search = prepareFuzzySearch(query.trim());
		const folders = this.app.vault
			.getAllLoadedFiles()
			.filter((f) => f instanceof TFolder && !f.isRoot() && f.path !== dir)
			.map((f) => ({ type: "folder", path: f.path, match: search(`${f.path}/`) }))
			.filter((row) => row.match)
			.sort((a, b) => b.match.score - a.match.score || a.path.localeCompare(b.path, "zh"));

		return [...rows, ...folders];
	}

	renderSuggestion(row, el) {
		if (row.type === "folder") {
			renderResults(el, `${row.path}/`, row.match);
			return;
		}
		if (row.type === "error") {
			el.createSpan({ text: row.message, attr: { style: "color: var(--text-error)" } });
			return;
		}

		const verb = row.existing ? "打开已有" : "新建";
		el.createSpan({ text: `${verb}：`, attr: { style: "color: var(--text-muted)" } });
		el.createSpan({ text: row.path, attr: { style: "font-weight: var(--font-semibold)" } });
		if (row.newFolder) {
			el.createDiv({
				cls: "suggestion-note",
				text: `会同时新建目录 ${row.newFolder}/`,
			});
		}
	}

	/* 目录行不关窗口，只把路径补进去；只有「新建」那一行才真的动手 */
	selectSuggestion(row, evt) {
		if (row.type === "folder") {
			this.fill(row.path);
			return;
		}
		if (row.type !== "create") return;
		this.close();
		this.onChooseSuggestion(row, evt);
	}

	async onChooseSuggestion(row, evt) {
		try {
			let file = row.existing;
			if (!file) {
				if (row.newFolder) await this.app.vault.createFolder(row.newFolder);
				file = await this.app.vault.create(row.path, "");
			}
			await this.app.workspace.getLeaf(Keymap.isModEvent(evt)).openFile(file);
		} catch (err) {
			console.error("[ltoolkit] quick-open", err);
			new Notice(`新建失败：${err.message}`);
		}
	}
}

/* 输入 → 第一行。输入还没写到文件名（空的、或以 / 结尾）时返回 null，
 * 这时只列目录；写了但不合法就给一行红字，回车不做任何事。 */
function resolvePath(app, raw) {
	const parts = raw
		.replace(/^\/+/, "")
		.split("/")
		.map((p) => p.trim());
	const name = parts.pop().replace(/\.md$/i, "");
	if (name === "") return null;

	const error = (message) => ({ type: "error", message });
	if (parts.some((p) => p === "")) return error("路径里有空的一级（连着两个 /）");
	if ([...parts, name].some((p) => p.startsWith("."))) return error("名字不能以 . 开头");
	if (BAD_CHARS.test(raw)) return error('名字里不能有 \\ : * ? " < > | # ^ [ ]');

	const dir = parts.join("/");
	const path = normalizePath(dir ? `${dir}/${name}.md` : `${name}.md`);
	const existing = app.vault.getAbstractFileByPath(path);
	if (existing instanceof TFolder) return error(`已有同名文件夹：${path}`);

	const folder = dir ? app.vault.getAbstractFileByPath(dir) : app.vault.getRoot();
	if (folder && !(folder instanceof TFolder)) return error(`${dir} 是个文件，不是目录`);

	return {
		type: "create",
		path,
		existing: existing instanceof TFile ? existing : null,
		newFolder: folder ? null : dir,
	};
}
