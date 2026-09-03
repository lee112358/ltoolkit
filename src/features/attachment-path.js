/* 由笔记路径推导附件目录。
 *
 * 不 import obsidian，只做纯字符串计算，方便在 Obsidian 之外测试
 * （和 attachment-scan.js 一样的取舍）。
 */

/* 目录名里不能出现的字符。Obsidian 的笔记名本身已经禁掉了大部分，
 * 这里兜底跨平台的边角情况：Windows 不允许名字结尾是点或空格。 */
export function sanitizeSegment(segment) {
	const cleaned = String(segment ?? "")
		.replace(/[\\/:*?"<>|]/g, "_")
		.replace(/[.\s]+$/, "");
	return cleaned || "_";
}

export function normalizeRoot(value) {
	return String(value ?? "")
		.trim()
		.replace(/^\/+|\/+$/g, "");
}

/* 笔记 a/b/c.md 的附件目录是 <root>/a/b/c —— 笔记所在的每一层目录都镜像过来，
 * 最后再加上笔记自己的名字，这样每篇笔记有独立的一格。
 * 根目录的笔记没有中间层，直接是 <root>/c。
 *
 * 返回 null 表示算不出来（没有 root、或路径为空），调用方应退回默认行为。 */
export function folderForNote(notePath, root) {
	const cleanRoot = normalizeRoot(root);
	if (!cleanRoot) return null;

	const parts = String(notePath ?? "")
		.split("/")
		.filter(Boolean);
	if (parts.length === 0) return null;

	const fileName = parts.pop();
	const baseName = fileName.replace(/\.[^.]+$/, "");

	return [...cleanRoot.split("/"), ...parts, baseName]
		.filter(Boolean)
		.map(sanitizeSegment)
		.join("/");
}

/* 附件根目录：设置里填了就用填的，留空则跟随 Obsidian 自己的
 * 「附件默认存放位置」（设置 → 文件与链接）。
 *
 * Obsidian 那一项有三种形态：
 *   "99-附件"    vault 内的固定目录 —— 正是我们要的
 *   "" 或 "/"    vault 根目录
 *   "." "./子目录"  跟着每篇笔记走，没有统一的根
 * 后一种算不出单一根目录，返回 null，调用方按「没配」处理。
 *
 * 不 import obsidian，getConfig 是 vault 上的内部 API，用可选链兜着，
 * 哪天没了就当没配过。 */
export function resolveRoot(app, value) {
	const explicit = normalizeRoot(value);
	if (explicit) return explicit;

	const configured = app?.vault?.getConfig?.("attachmentFolderPath");
	if (typeof configured !== "string") return null;
	if (configured.startsWith(".")) return null; // "." / "./" / "./子目录" 都是跟着笔记走

	return normalizeRoot(configured) || null;
}
