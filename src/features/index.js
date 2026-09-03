import { ActiveLine, ID as ACTIVE_LINE } from "./active-line.js";
import { CodeBlockFilename, ID as CODE_BLOCK_FILENAME } from "./code-block-filename.js";
import { CodeBlockTop, ID as CODE_BLOCK_TOP } from "./code-block-top.js";
import { AttachmentCleaner, ID as ATTACHMENT_CLEANER } from "./attachment-cleaner.js";
import { AttachmentFolder, ID as ATTACHMENT_FOLDER } from "./attachment-folder.js";
import { CanvasMouseSwap } from "./canvas-mouse-swap.js";
import { ClearParagraphMarker } from "./clear-paragraph.js";
import { BlockEscape, ID as BLOCK_ESCAPE } from "./block-escape.js";
import { ID as INSERT_LINE, InsertLine } from "./insert-line.js";
import { ID as LINE_HEIGHT, LineHeight } from "./line-height.js";
import { ID as PROGRESSIVE_SELECT, ProgressiveSelect } from "./progressive-select.js";
import { ID as TOGGLE_BOOKMARK, ToggleBookmark } from "./toggle-bookmark.js";
import { ID as SCROLL_MEMORY, ScrollMemory } from "./scroll-memory.js";
import { ID as SQUARE_TABS, SquareTabs } from "./square-tabs.js";
import { ID as SIDEBAR_BACKGROUND, SidebarBackground } from "./sidebar-background.js";
import { ID as NO_DUPLICATE_TABS, NoDuplicateTabs } from "./no-duplicate-tabs.js";
import { LineToNote } from "./line-to-note.js";
import { ToTable } from "./to-table.js";
import { ToggleTaskList } from "./task-list.js";

/* 设置面板的分组。每组一个可折叠区块，按这里的顺序从上往下排。
 *
 *   id         功能用 group 字段指向它；没有匹配的功能时该组不显示
 *   collapsed  默认折叠。给「看一眼就好、不常改」的组用
 *
 * 分组规则：按用户想改动的**场景**分，不按代码实现分。改外观的和改行为的
 * 分开，是因为找设置时人想的是「我要换个样子」而不是「这是纯 CSS 功能」。 */
export const GROUPS = [
	{ id: "attachment", name: "附件" },
	{ id: "editor", name: "编辑器" },
	{ id: "canvas", name: "画布" },
	{ id: "appearance", name: "界面样式", desc: "只改观感，不改行为", collapsed: true },
];

export const DEFAULT_GROUP = "editor";

/* 加新功能 = 往这个数组里加一项。
 *
 *   id                 每项功能的设置键，改了会丢掉用户已保存的开关状态
 *   group              归到哪个分组，取 GROUPS 里的 id；省略则进 DEFAULT_GROUP
 *   create(app, plugin) 返回一个 Component；省略则是纯 CSS 功能
 *   bodyClass          该功能 CSS 的作用域 class，与 styles.css 里的选择器对应
 *   options            额外的可配置项，缩进显示在这项功能的开关下面
 *                        type: "toggle" 出开关，"color" 出取色器，省略则是文本框
 *   action             一个按钮，点了调用该功能实例的 run()
 *   desktopOnly        手机端隐藏并强制关闭
 *   enabledByDefault   默认关闭时设为 false
 */
export const FEATURES = [
	{
		id: "canvasMouseSwap",
		group: "canvas",
		name: "Canvas 鼠标模式对调",
		desc: "画布里左键拖动 = 平移、滚轮 = 缩放；按住空格恢复框选与上下滚动（Figma 式）。",
		desktopOnly: true,
		create: (app) => new CanvasMouseSwap(app),
		enabledByDefault: false,
	},
	{
		id: PROGRESSIVE_SELECT,
		group: "editor",
		name: "渐进全选",
		desc: "Notion 式的 Cmd/Ctrl+A：先选当前行的正文（不含列表标记、井号、引用前缀），再选整块（整段 / 整个列表项含子项 / 整个代码块 / 整张表格 / 整个引用块），第三次才全选整篇。阅读模式下选中光标所在的渲染块。",
		create: (app, plugin) => new ProgressiveSelect(app, plugin),
	},
	{
		id: BLOCK_ESCAPE,
		group: "editor",
		name: "Esc 选中整块",
		desc: "Notion 里 Esc 把「在块里打字」切成「选中这个块」。有自动补全、菜单或弹窗时放行，开着 vim 模式时不接管；整块已经选中了再按一次也放行。",
		create: (app, plugin) => new BlockEscape(app, plugin),
	},
	{
		id: "toggleTaskList",
		group: "editor",
		name: "切换任务列表",
		desc: "把右键菜单「段落 → 任务列表」做成命令，可在快捷键里自定义按键。光标所在行或选中的多行在「- [ ] 内容」和普通段落之间来回切；内置的 editor:toggle-checklist-status 只负责勾选已有任务，两者互补。",
		create: (app, plugin) => new ToggleTaskList(app, plugin),
	},
	{
		id: INSERT_LINE,
		group: "editor",
		name: "上下插入新行",
		desc: "Sublime 的 Cmd+Enter / Cmd+Shift+Enter：不管光标在行中间哪个位置，都在当前行的下方或上方另起一行并把光标移过去，当前行一个字都不切开。Obsidian 没有对应的内置命令——最接近的 swap-line-up/down 是搬走整行；CodeMirror 的 insertBlankLine 虽然在，但 Mod+Enter 默认绑给了「在新标签页打开链接」，而且它插的是纯空行，「向上插入」更是连命令都没有。这里会把缩进、引用前缀和列表标记带到新行上（有序列表接下一个号，任务项延续成未勾选，标题不延续），代码块里只带缩进。两条命令都要自己去快捷键里绑键。",
		create: (app, plugin) => new InsertLine(app, plugin),
	},
	{
		id: "clearParagraphMarker",
		group: "editor",
		name: "清除段落标签",
		desc: "把光标所在行（或选中多行）行首的标题井号、列表标记、任务复选框和缩进一并去掉，还原成普通段落；正文里的加粗、行内代码不受影响。内置的「清除格式」必须选中文字且会把行内标记也清掉，这条是它的补充。",
		create: (app, plugin) => new ClearParagraphMarker(app, plugin),
	},
	{
		id: "toTable",
		group: "editor",
		name: "转换为表格",
		desc: "把光标所在行（或选中的多行）按空格/Tab 切成表格：第一行当表头，多行时末尾补一个空行，单行时补足三行。光标所在行是空的就转交内置的「插入表格」。",
		create: (app, plugin) => new ToTable(app, plugin),
	},
	{
		id: "lineToNote",
		group: "editor",
		name: "当前行转成笔记 / 收回",
		desc: "把光标所在行的文字抽成一篇独立笔记，建在当前笔记的同一目录下，本行换成指向它的链接。在链接行上再执行一次则反过来：把那篇笔记的内容取回来铺在本行下面，并把笔记移入废纸篓。",
		create: (app, plugin) => new LineToNote(app, plugin),
	},
	{
		id: SCROLL_MEMORY,
		group: "editor",
		name: "记住笔记的浏览位置",
		desc: "按文件记住滚动位置，切走再切回来回到原处。Obsidian 自己只把位置存在标签页的导航历史里，所以只有按「返回」才恢复，从文件列表或快速切换器重新打开就回到顶部。位置存在本机，不会被同步插件带到别的设备上互相覆盖。",
		create: (app, plugin) => new ScrollMemory(app, plugin),
		options: [
			{
				key: "cursor",
				type: "toggle",
				name: "同时恢复光标位置",
				desc: "连同上次的光标和选区一起还原。只想恢复滚动位置就关掉它。",
				default: true,
			},
			{
				key: "delay",
				name: "恢复延迟（毫秒）",
				desc: "打开笔记后等多久再恢复位置。长笔记渲染慢导致恢复不准时调大它，最大 2000。",
				default: "100",
				placeholder: "100",
			},
		],
	},
	{
		id: NO_DUPLICATE_TABS,
		group: "editor",
		name: "同一标签组不重复打开",
		desc: "已经有标签页开着这个文件时切过去用那个，而不是再开一份。刚打开的那个标签页有历史就退回上一篇，是新建出来的就关掉。只在同一标签组内生效，左右分栏对照看同一篇不受影响。",
		create: (app, plugin) => new NoDuplicateTabs(app, plugin),
	},
	{
		id: TOGGLE_BOOKMARK,
		group: "editor",
		name: "切换书签（当前笔记）",
		desc: "一条命令加/取消当前笔记的书签，不弹窗。内置的「添加书签」会弹窗让你填别名和分组，取消书签还是另一条命令；不需要分组的话这一条就够，绑个快捷键即可。数据仍然写进 Obsidian 官方的 .obsidian/bookmarks.json。",
		create: (app, plugin) => new ToggleBookmark(app, plugin),
	},
	{
		id: SIDEBAR_BACKGROUND,
		group: "appearance",
		name: "统一侧边栏背景色",
		desc: "把左右侧边栏的底色改成和编辑区一致，或者自己挑一个。主题给侧边栏用 --background-secondary、给编辑区用 --background-primary，是不是同一个颜色全看主题；这里只在侧边栏这个范围内把前者重定义一遍，面板、标签栏、底部 vault 名那一条一起跟着走，中间的编辑区不受影响。",
		bodyClass: "lt-sidebar-bg",
		create: (app, plugin) => new SidebarBackground(app, plugin),
		options: [
			{
				key: "follow",
				type: "toggle",
				name: "跟随编辑区背景色",
				desc: "跟着主题的 --background-primary 走，明暗模式各自都对得上。关掉才用下面挑的颜色。",
				default: true,
			},
			{
				key: "color",
				type: "color",
				name: "自定义颜色",
				desc: "关掉上面的开关后生效。只有一个值，明暗模式共用，换到另一个模式下多半得重挑一次。",
				default: "#ffffff",
			},
		],
	},
	{
		id: ACTIVE_LINE,
		group: "appearance",
		name: "当前行高亮的形状",
		desc: "改主题给光标所在行画的那块底色：圆角默认抹平成直角，再让它比这一行左右各宽出几个像素，边缘不至于紧贴着字。只改形状，颜色仍旧用主题的。前提是主题本身开着当前行高亮（Typewriter 在 Style Settings 里叫「Highlight the active line」）。",
		bodyClass: "lt-active-line",
		create: (app, plugin) => new ActiveLine(app, plugin),
		options: [
			{
				key: "radius",
				name: "圆角（像素）",
				desc: "0 是直角。超出 0–24 会被夹到范围内。",
				default: "0",
				placeholder: "0",
			},
			{
				key: "pad",
				name: "左右外扩（像素）",
				desc: "底色在这一行左右两侧各多铺出几个像素。用 box-shadow 画，文字不会跟着挪位。",
				default: "2",
				placeholder: "2",
			},
			{
				key: "flushInCode",
				type: "toggle",
				name: "代码块里贴合边界",
				desc: "代码块那层底色就画在行自己身上，高亮再外扩就会顶出代码块的边。开着的话光标进代码块时外扩自动收成 0，与边界严丝合缝；关掉则代码块里也照上面的值外扩。",
				default: true,
			},
		],
	},
	{
		id: CODE_BLOCK_TOP,
		group: "appearance",
		name: "代码块顶部外扩",
		desc: "实时预览里代码块的底色是逐行铺的，块的上边界就是第一行文字的上边界，顶着字。这里在起始那行上方补一条同色窄条，圆角跟着 --code-radius 走，看起来就是整块往上长了几个像素。阅读视图的代码块自带上内边距，不受影响。",
		bodyClass: "lt-code-block-top",
		create: (app, plugin) => new CodeBlockTop(app, plugin),
		enabledByDefault: false,
		options: [
			{
				key: "size",
				name: "向上外扩（像素）",
				desc: "0 就是不外扩，回到原样。超出 0–24 会被夹到范围内。",
				default: "2",
				placeholder: "2",
			},
		],
	},
	{
		id: CODE_BLOCK_FILENAME,
		group: "appearance",
		name: "代码块的文件名与语言",
		desc: "在语言后面空一格写上文件名（```python ~/sshd.conf），两种视图里都把它显示在代码块左上角。实时预览下光标在代码块外面时 Obsidian 会把围栏行折叠掉，这时候由插件补上；光标一进去围栏行原样显示，就不再重复显示了。名字得从原文的围栏行里读——Obsidian 只把第一个词写进 class，后面那截在 DOM 里查不到。",
		bodyClass: "lt-code-block-filename",
		create: (app, plugin) => new CodeBlockFilename(app, plugin),
		enabledByDefault: false,
		options: [
			{
				key: "lang",
				type: "toggle",
				name: "阅读视图也显示语言",
				desc: "右上角那颗语言标签是实时预览才有的，阅读视图这边补一颗，写法和位置都照抄它。鼠标移到代码块上时让位给内置的复制按钮。",
				default: true,
			},
		],
	},
	{
		id: "standardCodeBackground",
		group: "appearance",
		name: "代码块纯色背景",
		desc: "用平整的浅灰底替换 Border 主题代码块、行内代码、引用块和表头的点阵纹理。",
		bodyClass: "lt-standard-code-bg",
		enabledByDefault: false,
	},
	{
		id: LINE_HEIGHT,
		group: "appearance",
		name: "正文行高",
		desc: "阅读视图和编辑器的正文行高倍数。Obsidian 核心设置里没有这一项，通常得靠主题的 Style Settings；放在这里就不跟着主题走了。用的是自己的变量和更高特异度的选择器，会盖住主题的同名设置。",
		bodyClass: "lt-line-height",
		create: (app, plugin) => new LineHeight(app, plugin),
		enabledByDefault: false,
		options: [
			{
				key: "value",
				name: "行高倍数",
				desc: "相对字号的倍数，Obsidian 默认 1.5，中文正文一般 1.7 左右舒服。超出 1–3 会被夹到范围内。",
				default: "1.6",
				placeholder: "1.6",
			},
		],
	},
	{
		id: SQUARE_TABS,
		group: "appearance",
		name: "编辑区标签页直角分离",
		desc: "把主编辑区顶部的标签从浏览器式的「连体标签」改成一块块直角小方块：抹平圆角、去掉连着正文的那两道内凹弧线，底色从撑满整条标签栏的外层挪到本来就带内边距的内层，标签便四面不贴边、彼此留缝。激活的那块底色比编辑区深一档，靠颜色区分，不再画描边。侧边栏的标签栏不动。",
		bodyClass: "lt-square-tabs",
		create: (app, plugin) => new SquareTabs(app, plugin),
		options: [
			{
				key: "auto",
				type: "toggle",
				name: "底色跟着编辑区自动算",
				desc: "拿编辑区底色往「更有对比」的方向混一点：亮色模式是加深，暗色模式自动变成提亮，两边不用各配一次。关掉才用下面挑的颜色。",
				default: true,
			},
			{
				key: "depth",
				name: "加深幅度（%）",
				desc: "自动模式下混入多少。8 左右是刚好能看出来又不抢眼的程度，超出 0–40 会被夹到范围内。",
				default: "8",
				placeholder: "8",
			},
			{
				key: "color",
				type: "color",
				name: "自定义底色",
				desc: "关掉上面的开关后生效。只有一个值，明暗模式共用，换到另一个模式下多半得重挑一次。",
				default: "#e6e6e6",
			},
		],
	},
	{
		id: "floatScrollbar",
		group: "appearance",
		name: "悬浮滚动条",
		desc: "去掉滚动条轨道的底色和贴着正文那条分界线，只留滑块，滑块颜色不动。编辑区、左右侧边栏（含上下分栏的每一格）一起生效——轨道设成透明后透出的就是它背后那块底色，明暗模式也各自对得上。",
		bodyClass: "lt-float-scrollbar",
	},
	{
		id: "tabCaretAlign",
		group: "appearance",
		name: "修复空缩进行的光标位置",
		desc: "按 Tab 缩进但还没打字时，光标比字符实际的落点偏左十来个像素，一打字就往右跳一下。原因是这一行还没被判定成列表续行，拿不到 Obsidian 给列表行设的 tab-size，Tab 的前进宽度算成了 21.3px 而实际渲染是 32px。补上同一个 tab-size 即可，代码块不受影响。",
		bodyClass: "lt-tab-caret-align",
	},
	{
		id: "hideExplorerTabHeader",
		group: "appearance",
		name: "隐藏文件浏览器的标签栏",
		desc: "侧边栏上下分栏后，装着文件浏览器的那个面板会有一条只放着一个图标的标签栏，白占一行。隐藏它把高度还给文件列表；新建/排序那一行和折叠侧边栏的按钮都保留。只在该标签组里仅有文件浏览器一个标签时生效，拖回别的面板标签栏会自动回来。",
		bodyClass: "lt-hide-explorer-tab-header",
		enabledByDefault: false,
	},
	{
		id: "fixFolderExpand",
		group: "appearance",
		name: "修复文件夹展开动画",
		desc: "Border 主题下文件树首次展开文件夹时，高度动画会先缩到一个偏小的目标再弹到实际高度。给树条目内层钉一个最小高度即可消除。",
		bodyClass: "lt-fix-folder-expand",
		enabledByDefault: false,
	},
	{
		id: ATTACHMENT_FOLDER,
		group: "attachment",
		name: "附件按笔记路径分目录",
		desc: "新附件存进与笔记路径对应的多级目录，如 股票/珍大户.md 的图片进 assets/股票/珍大户/。粘贴、拖入和内置的「下载当前文件内的所有附件」都生效；文件名不改，重名沿用 Obsidian 自己的加序号规则。",
		create: (app, plugin) => new AttachmentFolder(app, plugin),
		options: [
			{
				key: "root",
				name: "附件根目录",
				desc: "相对 vault 根目录的路径，笔记的目录层级会镜像到它下面。留空则跟随 Obsidian 的「文件与链接 → 附件默认存放位置」，那边填的若是「与当前文件相同」这类跟着笔记走的设置，则本功能不接管。",
				default: "",
				placeholder: "留空 = 跟随 Obsidian 设置",
			},
			{
				key: "follow",
				type: "toggle",
				name: "跟随笔记移动",
				desc: "笔记移动或改名后，把它的附件目录一并搬到新位置并更新链接；旧目录若因此变空，逐级向上删除。",
				default: true,
			},
		],
	},
	{
		id: ATTACHMENT_CLEANER,
		group: "attachment",
		name: "清理未引用的附件",
		desc: "找出附件文件夹里没有被任何笔记或画布引用的文件。也可在命令面板里执行。",
		bodyClass: "lt-attachment-cleaner",
		create: (app, plugin) => new AttachmentCleaner(app, plugin),
		options: [
			{
				key: "folder",
				name: "附件文件夹",
				desc: "相对 vault 根目录的路径，含子目录一起扫描。留空则跟随 Obsidian 的「文件与链接 → 附件默认存放位置」。填的目录在 vault 里不存在时会直接报错，不会假装扫完了什么都没找到。",
				default: "",
				placeholder: "留空 = 跟随 Obsidian 设置",
			},
		],
		action: {
			name: "扫描",
			desc: "列出未被引用的附件，逐个确认后再删除。",
			cta: "开始扫描",
		},
	},
];
