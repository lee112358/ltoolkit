/* 一键切换当前笔记的书签 —— 内置那两条命令的合并版。
 *
 * Obsidian 自带 bookmarks:bookmark-current-view 和 unbookmark-current-view，
 * 但分成两条、而且加书签那条会弹窗让你填别名和分组：
 *
 *   checkCallback: t => { ... r || (r = X4(i)); r ? (t || new k0(n, r, o).open(), !0) : void 0 }
 *                                                        ↑ 就是这个弹窗
 *
 * 不需要别名也不需要分组的话，这一步纯属多余。这里直接调实例的 addItem / removeItem，
 * 两者都不弹窗、自己会持久化到 .obsidian/bookmarks.json。
 *
 * 条目形状照抄它自己的构造函数 j4：
 *   { type: "file", ctime: Date.now(), path, subpath }
 * 判断是否已加书签用实例的 bookmarkLookup（findBookmarkByView 内部也是查它）。
 */

import { Component, Notice } from "obsidian";

export const ID = "toggleBookmark";

export class ToggleBookmark extends Component {
	constructor(app, plugin) {
		super();
		this.app = app;
		this.plugin = plugin;
	}

	onload() {
		this.register(
			this.plugin.useCommand(ID, {
				id: "toggle-bookmark",
				name: "切换书签（当前笔记）",
				icon: "bookmark",
				checkCallback: (checking) => {
					const context = this.context();
					if (!context) return false;
					if (!checking) this.toggle(context);
					return true;
				},
			}),
		);
	}

	/* 书签插件没启用、或当前视图没有对应文件时返回 null，命令面板里就不出现 */
	context() {
		const bookmarks = this.app.internalPlugins?.getEnabledPluginById?.("bookmarks");
		if (!bookmarks) return null;

		// 用 getMostRecentLeaf 而不是 activeLeaf：焦点在侧边栏时后者拿不到笔记
		const file = this.app.workspace.getMostRecentLeaf()?.view?.file;
		return file ? { bookmarks, file } : null;
	}

	toggle({ bookmarks, file }) {
		const existing = bookmarks.bookmarkLookup?.[file.path];

		if (existing) {
			bookmarks.removeItem(existing);
			new Notice(`已取消书签：${file.basename}`);
			return;
		}

		bookmarks.addItem({ type: "file", ctime: Date.now(), path: file.path, subpath: undefined });
		new Notice(`已加书签：${file.basename}`);
	}
}
