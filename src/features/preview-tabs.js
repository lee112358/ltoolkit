/* VS Code 式的预览标签页 —— 单击浏览复用同一个标签页，编辑或双击才固定下来。
 *
 * VS Code 里单击文件树，标签标题是斜体的：这是一个「预览标签页」，再点下一个
 * 文件就地替换掉它，浏览十个文件也只留一个标签。一旦你在里面打了字，或者
 * 双击打开，标题转成正体，它就成了一个真正属于你的标签页，后面的浏览不会
 * 再覆盖它。
 *
 * Obsidian 这边默认是「永远复用当前标签页」——它开文件时只问 getLeaf(false)
 * 要一个「可以被替换的标签页」，拿到当前这个就直接覆盖，不管你刚才是不是
 * 正在里面写东西。所以缺的不是「复用」，而是**复用的边界**：哪些标签页可以
 * 被覆盖，哪些不行。
 *
 * 实现落在 getLeaf 这一层，而不是事后补救。事后补救的做法是等 file-open 触发、
 * 发现覆盖错了再 history.back() 退回去、另开一个标签重新打开一遍（
 * no-duplicate-tabs 就是这么干的，它本来就是在处理「已经开完了」的局面）。
 * 这里不行：那意味着每次浏览都要闪一下，视图建两次、滚动位置和光标各恢复
 * 一次，还会和 scroll-memory 抢同一帧。getLeaf 是所有「打开文件」入口的必经
 * 之路——文件浏览器、搜索结果、书签、快速切换器、正文里的链接，最后都要向它
 * 要一个标签页。在这里换掉返回值，文件根本不会被打开到错误的标签页里。
 *
 * 「哪个标签页是预览页」这个标记直接挂在 leaf 对象身上（leaf[FLAG]），不另存
 * 一份 Set。第一版存的是 Set，结果是标签页刚由 createLeafInParent 建出来、
 * 还没来得及标记时 layout-change 就先响了，对账那一步认不出它、把它从表里
 * 剔掉，于是每点一次文件就多一个标签——「就地顶掉」从来没生效过。标记挂在
 * 对象上就没有这个时间差：标签页关掉，标记跟着对象一起消失，不需要维护，
 * 也不可能对账对错。
 *
 * 斜体同理，不在建标签的那一刻写 class。那时 tabHeaderEl 还不存在（标签头的
 * DOM 要等视图挂上去才建），写了也是空操作——这正是「固定状态完全看不出来」
 * 的原因。改成每次 layout-change 按标记刷一遍，晚一帧，但永远是对的。
 *
 * 打补丁的三条纪律：
 *
 *   1. 只在 newLeaf 为假时介入。true / "tab" / "split" / "window" 是用户明说
 *      要新开一个（Cmd+点击、拆分面板），这种意图必须原样放行。
 *   2. 只认主编辑区。侧边栏里的 leaf 不参与，getRoot() 不是 rootSplit 就放行。
 *   3. 卸载时确认现在挂着的还是自己那一份再还原。别人在我们之后也打了补丁的话，
 *      硬还原会把别人的摘掉。
 */

import { Component } from "obsidian";

export const ID = "previewTabs";

const PREVIEW_CLASS = "lt-preview-tab";
const FLAG = "ltPreviewTab";
/* 文件刚打开的这段时间里的 editor-change 不算用户编辑 —— 正常情况下加载
 * 文件不会触发它，但主题和别的插件在视图刚建好时改一笔的事是有的，
 * 误判的代价是标签页白白被固定住 */
const EDIT_GRACE = 400;

export class PreviewTabs extends Component {
	constructor(app, plugin) {
		super();
		this.app = app;
		this.plugin = plugin;
		/* 最近一次打开文件的时刻，给上面那个宽限期用。不必按标签页分开记：
		 * 编辑只会发生在当前这个标签页里，而它就是刚打开的那个。 */
		this.openedAt = 0;
	}

	onload() {
		this.patchGetLeaf();

		this.registerEvent(
			this.app.workspace.on("file-open", () => {
				this.openedAt = Date.now();
				this.paint();
			}),
		);

		// 在里面打字 = 这篇我要留着
		this.registerEvent(
			this.app.workspace.on("editor-change", (editor, info) => {
				if (this.plugin.getOption(ID, "promoteOnEdit") === false) return;
				if (Date.now() - this.openedAt < EDIT_GRACE) return;
				this.promote(info?.leaf);
			}),
		);

		/* 双击转正。文件浏览器、搜索结果、书签面板的条目各有各的 class，
		 * 与其一个个列出来，不如认「双击发生在侧边栏里」这一个条件：
		 * 第一次点击已经把文件开进预览页了，这里只需要把它留下。
		 * 双击标签页本身也转正，和 VS Code 一致。
		 *
		 * 捕获阶段挂 document：条目自己可能会 stopPropagation。 */
		this.registerDomEvent(document, "dblclick", (event) => this.onDoubleClick(event), true);

		/* 关标签页、拖动换组、钉住都只有这一个事件会响，斜体也在这里刷 */
		this.registerEvent(this.app.workspace.on("layout-change", () => this.sweep()));
		this.registerEvent(this.app.workspace.on("active-leaf-change", () => this.paint()));

		this.register(() => {
			this.eachLeaf((leaf) => {
				delete leaf[FLAG];
				leaf.tabHeaderEl?.classList.remove(PREVIEW_CLASS);
			});
		});
	}

	/* ── 补丁 ───────────────────────────────────────── */

	patchGetLeaf() {
		const workspace = this.app.workspace;
		const original = workspace.getLeaf;
		const self = this;

		/* 原来的 getLeaf 在原型上，这里挂的是实例自己的属性。还原时要把这层
		 * 删掉而不是赋回去，否则实例上会留下一个影子副本，别的插件想还原成
		 * 原型上那份就还原不回去了。 */
		const patched = function (newLeaf, ...rest) {
			const leaf = original.call(this, newLeaf, ...rest);
			try {
				return self.route(leaf, newLeaf);
			} catch (err) {
				// 选错标签页总比打不开文件强
				console.error("[ltoolkit] 预览标签页选择失败", err);
				return leaf;
			}
		};

		workspace.getLeaf = patched;

		this.register(() => {
			if (workspace.getLeaf !== patched) return; // 别人后来又打了补丁，不动
			delete workspace.getLeaf;
			// 原型上没有这个方法（理论上不会），兜底赋回去
			if (typeof workspace.getLeaf !== "function") workspace.getLeaf = original;
		});
	}

	/* 给这次打开挑一个标签页。返回 leaf 本身就是「维持 Obsidian 的选择」。 */
	route(leaf, newLeaf) {
		if (newLeaf) return leaf; // "tab" / "split" / "window"：用户明说要新开
		if (!leaf || !this.inMainArea(leaf)) return leaf;
		if (leaf[FLAG]) return leaf; // 本来就是预览页，就地顶掉

		/* 这个标签组里已经有预览页了就用它，不管 Obsidian 刚才挑的是谁。
		 * 挑出来的要是一个刚为这次打开新建的空标签（Obsidian 在当前标签页
		 * 被钉住、或者开着「总是在新标签页打开」时会这么干），顺手收掉，
		 * 否则标签栏上会留下一个永远空着的格子。 */
		const existing = this.previewIn(leaf.parent);
		if (existing && existing !== leaf) {
			if (this.isEmpty(leaf)) window.setTimeout(() => leaf.detach(), 0);
			return existing;
		}

		// 空标签页没有内容可保护，直接征用它当预览页
		if (this.isEmpty(leaf)) return this.mark(leaf);
		if (leaf.pinned) return leaf; // 钉住的 Obsidian 自己会另找一个

		return this.create(leaf) ?? leaf;
	}

	/* 在当前标签页右边新建一个预览页。位置跟着 VS Code：新标签紧挨着你
	 * 刚才那个，不是甩到最后。 */
	create(leaf) {
		const parent = leaf.parent;
		const children = parent?.children;
		if (!Array.isArray(children)) return null;

		const at = children.indexOf(leaf);
		const created = this.app.workspace.createLeafInParent(
			parent,
			at === -1 ? children.length : at + 1,
		);
		return created ? this.mark(created) : null;
	}

	/* ── 转正 ───────────────────────────────────────── */

	onDoubleClick(event) {
		const target = event.target;
		if (!(target instanceof Element)) return;

		// 双击标签页自己：直接认出是哪一个，不用等
		const header = target.closest(".workspace-tab-header");
		if (header) {
			this.eachLeaf((leaf) => {
				if (leaf.tabHeaderEl === header) this.promote(leaf);
			});
			return;
		}

		if (!target.closest(".workspace-split.mod-left-split, .workspace-split.mod-right-split")) {
			return;
		}

		/* 双击的第一下已经触发了打开，但那是异步的，此刻文件多半还没进去。
		 * 等这一轮事件走完再看当前是谁 —— 用不着知道双击的是哪个条目，
		 * 因为第一下点的就是它。 */
		window.setTimeout(() => this.promote(this.app.workspace.getMostRecentLeaf()), 0);
	}

	promote(leaf) {
		if (!leaf?.[FLAG]) return;
		delete leaf[FLAG];
		this.paint();
	}

	mark(leaf) {
		leaf[FLAG] = true;
		this.paint();
		return leaf;
	}

	/* ── 维护 ───────────────────────────────────────── */

	/* 钉住一个预览页显然是要留着它，转正；拖动之后一个标签组里出现两个预览页
	 * （从别的组拖了一个过来）就只留活跃的那个。关掉的标签页不用管——标记跟着
	 * 对象走，对象没了标记也没了。 */
	sweep() {
		const seen = new Map();

		this.eachLeaf((leaf) => {
			if (!leaf[FLAG]) return;
			if (leaf.pinned) {
				delete leaf[FLAG];
				return;
			}

			const parent = leaf.parent;
			if (!parent) return;

			const kept = seen.get(parent);
			if (!kept) {
				seen.set(parent, leaf);
				return;
			}
			// 活跃的那个才是你正在浏览的，留它，另一个转正
			const winner = leaf === this.app.workspace.activeLeaf ? leaf : kept;
			seen.set(parent, winner);
			delete (winner === kept ? leaf : kept)[FLAG];
		});

		this.paint();
	}

	/* 按标记刷一遍斜体。标签头的 DOM 要等视图挂上去才建，所以不能在标记的
	 * 那一刻写 class —— 统一在这里对齐，多刷几次也不花什么。 */
	paint() {
		this.eachLeaf((leaf) => {
			leaf.tabHeaderEl?.classList.toggle(PREVIEW_CLASS, leaf[FLAG] === true);
		});
	}

	/* ── 小工具 ─────────────────────────────────────── */

	eachLeaf(fn) {
		this.app.workspace.iterateRootLeaves(fn);
	}

	inMainArea(leaf) {
		return leaf.getRoot?.() === this.app.workspace.rootSplit;
	}

	isEmpty(leaf) {
		const type = leaf.view?.getViewType();
		return type === undefined || type === "empty";
	}

	previewIn(parent) {
		const children = parent?.children;
		if (!Array.isArray(children)) return null;
		return children.find((child) => child[FLAG]) ?? null;
	}
}
