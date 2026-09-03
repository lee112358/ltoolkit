/* 找出附件文件夹里没有被任何地方引用的文件。
 *
 * 不 import obsidian，只依赖传进来的 app，方便在 Obsidian 之外测试。
 * 这是个删除工具，判定原则是宁可漏删、不可错删：任何一层扫描认为
 * 文件被引用了，就把它排除在结果之外。
 */

import { normalizeRoot } from "./attachment-path.js";

/* 附件文件夹里的这些扩展名是内容本身，不当作附件 */
const NOT_ATTACHMENT = new Set(["md", "canvas"]);

/* 一个字符串在正文里可能长的样子：原样，以及它的 URL 编码形式
 * （markdown 链接会把空格写成 %20） */
function formsOf(base) {
	const forms = new Set([base, base.replace(/ /g, "%20")]);
	try {
		forms.add(encodeURI(base));
	} catch {
		/* 名字里有孤立的代理项时 encodeURI 会抛，忽略即可 */
	}
	return [...forms];
}

/* 光有文件名的写法（<img src="a.png">、[[a.png]]）要求前面不是斜杠，
 * 否则它只是别人完整路径的尾巴。
 *
 * 不加这一条的话，99-附件/demo.gif 会被 90-剪藏/xxx/demo.gif 的引用保下来，
 * 远程图片的 URL 也一样 —— .../assets/logo-dark.png 里就带着同名的一截。
 * 这两种恰恰是最容易堆积的孤儿。
 *
 * 带路径的写法照样是纯 includes，所以这里收紧不会误删：真指着本文件的链接
 * 要么写了路径、要么不带斜杠，何况所有 Obsidian 能解析的链接第一层就拦掉了，
 * 走到这一层的只剩 HTML、frontmatter、模板这些。 */
function occursBare(content, name) {
	let at = content.indexOf(name);
	while (at !== -1) {
		if (at === 0 || content[at - 1] !== "/") return true;
		at = content.indexOf(name, at + 1);
	}
	return false;
}

function isReferencedIn(content, file) {
	if (formsOf(file.path).some((form) => content.includes(form))) return true;
	return formsOf(file.name).some((form) => occursBare(content, form));
}

export async function findUnreferencedAttachments(app, folder) {
	const root = normalizeRoot(folder);
	if (!root) throw new Error("没有设置附件文件夹");

	/* 目录不存在时必须报错而不是返回空数组：两者在界面上都表现为
	 * 「没有未被引用的附件」，路径填错了会一直以为自己很干净。
	 * 不 import obsidian，所以用「有 children 数组」来认文件夹。 */
	const rootFolder = app.vault.getAbstractFileByPath(root);
	if (!rootFolder || !Array.isArray(rootFolder.children)) {
		throw new Error(`vault 里没有文件夹「${root}」`);
	}

	const prefix = `${root}/`;
	const allFiles = app.vault.getFiles();
	const attachments = allFiles.filter(
		(f) => f.path.startsWith(prefix) && !NOT_ATTACHMENT.has(f.extension),
	);
	if (attachments.length === 0) return [];

	const referenced = new Set();

	// 第一层：Obsidian 自己解析出来的链接与嵌入（含 ![[...]] 和 markdown 链接）
	for (const targets of Object.values(app.metadataCache.resolvedLinks)) {
		for (const path of Object.keys(targets)) referenced.add(path);
	}

	// 第二层：画布。画布节点的 file 字段不一定进 resolvedLinks，必须单独解析，
	// 否则画布里用到的图片会被当成孤儿删掉
	const canvases = allFiles.filter((f) => f.extension === "canvas");
	for (const canvas of canvases) {
		try {
			const data = JSON.parse(await app.vault.cachedRead(canvas));
			for (const node of data?.nodes ?? []) {
				if (node?.file) referenced.add(node.file);
			}
		} catch (err) {
			// 解析失败不影响安全性：画布原文同样会进下面第三层扫描，
			// 里面的路径字符串照样能把图片保下来
			console.warn(`[ltoolkit] 画布 ${canvas.path} 解析失败，改由原文扫描兜底`, err);
		}
	}

	const pending = new Map(
		attachments.filter((f) => !referenced.has(f.path)).map((f) => [f.path, f]),
	);
	if (pending.size === 0) return [];

	// 第三层兜底：只要文件名在任何笔记/画布的原文里出现过就不算孤儿。
	// 会误判（正文里单纯提到文件名也算），但方向是安全的，能兜住
	// HTML <img src>、frontmatter、模板等 resolvedLinks 索引不到的写法。
	//
	// 代码块里的文件名同样算数：Obsidian 自己不把它当引用，但笔记里既然
	// 写着这个名字，删掉文件就会让那段内容失去意义。这里刻意选择漏删。
	const corpus = [...app.vault.getMarkdownFiles(), ...canvases];

	for (const source of corpus) {
		if (pending.size === 0) break;
		let content;
		try {
			content = await app.vault.cachedRead(source);
		} catch (err) {
			console.warn(`[ltoolkit] 读取 ${source.path} 失败，跳过`, err);
			continue;
		}
		for (const [path, file] of [...pending]) {
			if (isReferencedIn(content, file)) pending.delete(path);
		}
	}

	return [...pending.values()].sort((a, b) => a.path.localeCompare(b.path));
}
