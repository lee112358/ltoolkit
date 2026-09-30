/* 点文件夹书签时，顺带把这个文件夹和它的一级子文件夹展开。
 *
 * 书签插件点文件夹走的是实例上的 openBookmark：
 *
 *   else if ("folder" === e.type) (r = vault.getAbstractFileByPath(e.path))
 *       && (o = internalPlugins.getEnabledPluginById("file-explorer")) && o.revealInFolder(r);
 *
 * 而文件树的 revealInFolder 只展开它的**上级**，自己仍是收着的，于是只能看到
 * 一行文件夹名。这里在它前面先把文件夹自己和直接子文件夹展开，再交给原方法
 * 去定位和滚动 —— 顺序反过来的话，滚动时下面的内容还没铺开。
 *
 * 再深一层不动：子文件夹多的时候全展开会把文件树拉得很长。
 */

import { Component, TFolder } from "obsidian";

export const ID = "bookmarkFolderExpand";

export class BookmarkFolderExpand extends Component {
	constructor(app, plugin) {
		super();
		this.app = app;
		this.plugin = plugin;
	}

	onload() {
		this.app.workspace.onLayoutReady(() => this.patch());
	}

	/* 打在实例上而不是原型上：书签插件的类没导出，拿不到原型更省事 */
	patch() {
		const bookmarks = this.app.internalPlugins?.getPluginById?.("bookmarks")?.instance;
		const original = bookmarks?.openBookmark;
		if (typeof original !== "function") {
			console.error("[ltoolkit] 书签展开文件夹未生效：取不到 openBookmark");
			return;
		}

		const self = this;
		const patched = function (item, ...args) {
			if (item?.type === "folder") {
				try {
					self.expand(item.path);
				} catch (err) {
					console.error("[ltoolkit] 展开书签文件夹失败", err);
				}
			}
			return original.call(this, item, ...args);
		};

		bookmarks.openBookmark = patched;
		/* 原方法在原型上，删掉实例上这一层就还原了。别人后来又包了一层的话不动它 */
		this.register(() => {
			if (bookmarks.openBookmark === patched) delete bookmarks.openBookmark;
		});
	}

	expand(path) {
		const folder = this.app.vault.getAbstractFileByPath(path);
		if (!(folder instanceof TFolder)) return;

		const paths = [folder, ...folder.children.filter((f) => f instanceof TFolder)].map(
			(f) => f.path,
		);
		for (const leaf of this.app.workspace.getLeavesOfType("file-explorer")) {
			const items = leaf.view?.fileItems;
			if (!items) continue;
			for (const p of paths) items[p]?.setCollapsed?.(false);
		}
	}
}
