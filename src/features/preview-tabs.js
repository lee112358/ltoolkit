/* VS Code 式的预览标签页 —— 单击浏览复用同一个标签页，编辑或双击才固定下来。
 *
 * VS Code 里单击文件树，标签标题是斜体的：这是一个「预览标签页」，再点下一个
 * 文件就地替换掉它，浏览十个文件也只留一个标签。一旦你在里面打了字，或者
 * 双击打开，标题转成正体，它就成了一个真正属于你的标签页，后面的浏览不会
 * 再覆盖它。
 *
 * Obsidian 这边默认是「永远复用当前标签页」——它开文件时只要一个「可以被替换的
 * 标签页」，拿到当前这个就直接覆盖，不管你刚才是不是正在里面写东西。所以缺的
 * 不是「复用」，而是**复用的边界**：哪些标签页可以被覆盖，哪些不行。
 *
 * ── 用户能从哪些地方打开文件 ─────────────────────
 *
 * 挨个查过 Obsidian 的实现，所有「打开文件」最后都落到 <leaf>.openFile()，
 * 而「用哪个 leaf」只有四种来法：
 *
 *   ① 要一个可以被覆盖的标签页 —— 我们管
 *      getLeaf(false / undefined)，它的实现就是一行 return this.getUnpinnedLeaf()
 *        侧边栏单击、快速切换器、搜索结果、书签、标签面板、反向链接、图谱、
 *        正文里的链接（openLinkText 不带 paneType）、文件嵌入的图标、
 *        每日笔记、随机笔记、新建笔记 / Canvas / Bases、Obsidian URI……
 *      getUnpinnedLeaf(false) —— 绕过 getLeaf 直接调它的两处：
 *        侧边栏里 Cmd/Ctrl + ↑/↓ 选文件（**光**按 ↑/↓ 只挪那个焦点框，不开文件：
 *          onKeyArrowDown 里那一步要 isModEvent(e) 才走 onKeyOpen，而且会把
 *          metaKey 抹掉再传下去，免得变成「在新标签页打开」）、
 *        拖文件进编辑器插嵌入
 *
 *   ② 明说要新开一个 —— 不管
 *      getLeaf(true / "tab") → createLeafInTabGroup   Cmd+点击、中键、右键菜单
 *      getLeaf("split")      → splitActiveLeaf        拆分面板
 *      getLeaf("window")     → openPopoutLeaf         弹出窗口
 *
 *   ③ 标签页已经指定了 —— 与「挑标签页」无关
 *      前进后退：leaf.history.go(±1) → leaf.setViewState({ popstate: true })，
 *        连 openFile 都不经过。翻的是这个标签页自己的历史，不是在挑标签页。
 *      拖文件到某个页签 / 页签栏：拖放本身就指定了落点。
 *      工作区恢复、Sync 的 receiveSyncState、链接标签组：同理。
 *
 *   ④ 只切焦点，不开文件 —— 无事可做
 *      点页签、Cmd+1..9、Ctrl+Tab：只调 setActiveLeaf。
 *
 * 补丁因此挂在 **getUnpinnedLeaf** 上：①里两路一处盖住。挂在 getLeaf 上会漏掉
 * Cmd+↑/↓ 那一路（它直接调 getUnpinnedLeaf(!1)）。那一路不常用，但它是个漏洞：
 * 走到那儿的浏览会把正写着的那篇顶掉。②在结构上就进不来——那三个
 * 分支各走各的，根本不碰 getUnpinnedLeaf，于是「只在 newLeaf 为假时介入」这条
 * 纪律不用自己守了。
 *
 * ── 为什么不事后补救 ─────────────────────────────
 *
 * 事后补救的做法是等 file-open 触发、发现覆盖错了再 history.back() 退回去、
 * 另开一个标签重新打开一遍。这里不行，两个原因：
 *
 *   一是每次浏览都要闪一下，视图建两次、滚动位置和光标各恢复一次，还会和
 *   scroll-memory 抢同一帧。
 *
 *   二是那一刻根本补不了。file-open 和 active-leaf-change 都由
 *   requestActiveLeafEvents = debounce(activeLeafEvents, 0) 发出来，通常比
 *   setViewState 跑完更早到；这时 leaf.working 还是 true，Obsidian 会把
 *   leaf.history.go() 原地挡掉并弹一个「当前标签页正忙，请稍后再试」
 *   （核心的 msgTabBusy），leaf.setViewState() 则是静默丢弃。
 *   而且 file-open 只在**活跃标签页的文件变了**时才发 —— 文件开进一个非活跃的
 *   标签页时它压根不发，事后补救连触发点都没有。
 *
 * ── 换了返回值就得自己补激活 ─────────────────────
 *
 * getUnpinnedLeaf 是这么写的：活跃标签页能导航（canNavigate = 视图支持导航
 * 且没被钉住）就直接返回它，**不激活**，因为它本来就是活跃的；只有走到兜底
 * 分支（活跃页钉住了、或者是图谱这类不能导航的视图）才 setActiveLeaf 一下。
 * 我们把返回值换掉之后，前一种情况就变成了「返回的不是活跃页」，那一下就得
 * 自己补 —— 否则文件开进了新标签页，活跃的还是原来那个，看起来像「后台偷偷
 * 切了一下」。侧边栏单击尤其明显：它在 openFile 之后还会
 * setActiveLeaf(getMostRecentLeaf(), { focus: true }) 一次，我们不激活的话，
 * 最近活跃的仍是旧标签页，于是焦点被明确地按回去。
 *
 * 补的时候照原生那一下抄：setActiveLeaf(leaf) 不带 focus，不抢键盘焦点（侧边栏
 * 单击的焦点是它自己那行 focus: true 给的，不该由我们代劳）。要不要激活也不用
 * 猜 —— getUnpinnedLeaf 的第一个参数就是「要不要激活」，Cmd+↑/↓ 那一路传的是
 * false（它配的是 openFile(file, { active: false })：开进去但焦点留在文件树里，
 * 好让你接着按），照着传就行。
 *
 * ── 标记与斜体 ───────────────────────────────────
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
 * 的原因。改成按标记刷一遍，晚一帧，但永远是对的。
 *
 * ── 谁在什么时候动 ───────────────────────────────
 *
 *   getUnpinnedLeaf 补丁  唯一挑标签页、打标记的地方（route → pick）
 *   editor-change         在预览页里打了字 → 转正
 *   dblclick              双击侧边栏条目或标签头 → 转正
 *   file-open             记下打开时刻（编辑宽限期要用），再对一遍账
 *   layout-change         关标签页、拖动换组、钉住之后对一遍账
 *   active-leaf-change    同上
 *
 * 对账收在 sweep() 一处，三个事件都只调它；标记定下来之后它调 paint() 把斜体
 * 刷齐。mark()/promote() 改动标记时也各自 paint() 一次，好让双击立刻看得见。
 * 后两个事件带来的对账多半是白做的，但代价只是遍历一趟标签页，换来的是
 * 「标记和斜体只有一个地方维护」。
 *
 * 打补丁的三条纪律：
 *
 *   1. 只认主编辑区。侧边栏里的 leaf 不参与，getRoot() 不是 rootSplit 就放行。
 *   2. 换掉了 Obsidian 挑的标签页，就照它兜底分支的样子补一次激活；没换就一个
 *      字都别多做。
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
		this.patchLeafPicker();

		this.registerEvent(
			this.app.workspace.on("file-open", () => {
				this.openedAt = Date.now();
				this.sweep();
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

		/* 捕获阶段挂 document：条目自己可能会 stopPropagation */
		this.registerDomEvent(document, "dblclick", (event) => this.onDoubleClick(event), true);

		this.registerEvent(this.app.workspace.on("layout-change", () => this.sweep()));
		this.registerEvent(this.app.workspace.on("active-leaf-change", () => this.sweep()));

		// 摘掉标记，斜体照旧交给 paint 按标记刷 —— 收尾和平时走同一条路
		this.register(() => {
			this.eachLeaf((leaf) => delete leaf[FLAG]);
			this.paint();
		});
	}

	/* ── 补丁 ───────────────────────────────────────── */

	/* 挂在 getUnpinnedLeaf 上，见文件头「用户能从哪些地方打开文件」 */
	patchLeafPicker() {
		const workspace = this.app.workspace;
		const original = workspace.getUnpinnedLeaf;
		const self = this;

		/* 原来的方法在原型上，这里挂的是实例自己的属性。还原时要把这层删掉
		 * 而不是赋回去，否则实例上会留下一个影子副本，别的插件想还原成原型上
		 * 那份就还原不回去了。 */
		const patched = function (activate, ...rest) {
			const leaf = original.call(this, activate, ...rest);
			try {
				return self.route(leaf, activate);
			} catch (err) {
				// 选错标签页总比打不开文件强
				console.error("[ltoolkit] 预览标签页选择失败", err);
				return leaf;
			}
		};

		workspace.getUnpinnedLeaf = patched;

		this.register(() => {
			if (workspace.getUnpinnedLeaf !== patched) return; // 别人后来又打了补丁，不动
			delete workspace.getUnpinnedLeaf;
			// 原型上没有这个方法（理论上不会），兜底赋回去
			if (typeof workspace.getUnpinnedLeaf !== "function") {
				workspace.getUnpinnedLeaf = original;
			}
		});
	}

	/* 给这次打开挑一个标签页。这是补丁唯一的出口：换了标签页就在这里补激活，
	 * 见文件头「换了返回值就得自己补激活」。activate 是 getUnpinnedLeaf 的第一个
	 * 参数，缺省视作 true，方向键选文件那一路传的是 false。 */
	route(leaf, activate) {
		if (!leaf || !this.inMainArea(leaf)) return leaf;

		const target = this.pick(leaf);
		if (target === leaf) return leaf; // 维持了 Obsidian 的选择，什么都不用做
		if (activate === false) return target; // 调用方明说了不要跳过去

		/* 照原生兜底分支那一下抄：setActiveLeaf(leaf)，不带 focus。
		 * 包一层 try：激活失败也要把挑好的标签页交出去 —— 顶掉你正在写的那篇，
		 * 比焦点没跟过去糟得多。 */
		try {
			this.app.workspace.setActiveLeaf(target);
		} catch (err) {
			console.error("[ltoolkit] 预览标签页激活失败", err);
		}
		return target;
	}

	/* 这次浏览该落在哪个标签页里。返回传进来的 leaf 就是「维持 Obsidian 的选择」。 */
	pick(leaf) {
		if (leaf[FLAG]) return leaf; // 本来就是预览页，就地顶掉

		/* 这个标签组里已经有预览页了就用它，不管 Obsidian 刚才挑的是谁。
		 * 挑出来的要是一个刚为这次打开新建的空标签（getUnpinnedLeaf 在一个
		 * 能导航的标签页都找不到时会自己建一个），顺手收掉，否则标签栏上会
		 * 留下一个永远空着的格子。 */
		const existing = this.previewIn(leaf.parent);
		if (existing && existing !== leaf) {
			if (this.isEmpty(leaf)) window.setTimeout(() => leaf.detach(), 0);
			return existing;
		}

		// 空标签页没有内容可保护，直接征用它当预览页
		if (this.isEmpty(leaf)) return this.mark(leaf);

		/* 钉住的标签页不用管：canNavigate() 里就有 !pinned，getUnpinnedLeaf
		 * 永远不会把钉住的那个交给我们。 */
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

	/* 双击转正。文件浏览器、搜索结果、书签面板的条目各有各的 class，与其一个个
	 * 列出来，不如认「双击发生在侧边栏里」这一个条件：第一次点击已经把文件开进
	 * 预览页了，这里只需要把它留下。双击标签头也转正，和 VS Code 一致。
	 *
	 * 两种情况都不用去认双击的是哪个条目、哪个标签头：第一下点击已经把对应的
	 * 标签页变成活跃的了（开文件，或者点标签头切过去），取当前活跃的那个就是它。
	 * 只是这两件事都是异步的，等这一轮事件走完再看。 */
	onDoubleClick(event) {
		const target = event.target;
		if (!(target instanceof Element)) return;

		const inside = target.closest(
			".workspace-tab-header, .workspace-split.mod-left-split, .workspace-split.mod-right-split",
		);
		if (!inside) return;

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
