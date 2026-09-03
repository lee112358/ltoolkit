/* 行首标记的解析与整行改写 —— 给「切换任务列表」「清除段落标签」共用。
 * 不依赖 obsidian 之外的东西，parseLine 是纯函数，可单独测试。
 *
 * 一行的结构按这个顺序拆：
 *
 *   　　缩进　　引用前缀　　列表标记　　复选框　　标题井号　　正文
 *   "  "　　  "> "　　　　 "- "　　　  "[x] "　　"## "　　　"内容 **加粗**"
 *
 * 只认行首这些块级标记，正文里的加粗、行内代码等一律不碰。
 */

/* 引用前缀里每个 > 后面只吃掉一个空格，再往后的空白算缩进 ——
 * "> \t任务" 的 Tab 是引用块内部的缩进层级，不是前缀的一部分。 */
const LINE = /^([ \t]*)((?:>[ \t]?)*)([ \t]*)(.*)$/;
const BULLET = /^([-*+]|\d+[.)])[ \t]+(.*)$/;
/* 方括号里是任意单字符，Obsidian 除 x 外还支持 /、-、? 等自定义状态 */
const CHECKBOX = /^\[(.)\](?:[ \t]+(.*))?$/;
const HEADING = /^(#{1,6})[ \t]+(.*)$/;

export function parseLine(text) {
	const [, before, quote, after, afterQuote] = LINE.exec(text);
	let rest = afterQuote;

	const bullet = BULLET.exec(rest);
	if (bullet) rest = bullet[2];

	// 复选框只在列表标记后面才算数，否则 "[x] " 就只是普通文本
	const checkbox = bullet ? CHECKBOX.exec(rest) : null;
	if (checkbox) rest = checkbox[2] ?? "";

	const heading = HEADING.exec(rest);
	if (heading) rest = heading[2];

	return {
		prefix: before + quote + after, // 原样重建行首用这个
		indent: before + after, // 比较缩进层级用这个，引用前缀不计入
		quote,
		bullet: bullet ? bullet[1] : null,
		checkbox: checkbox ? checkbox[1] : null,
		heading: heading ? heading[1].length : 0,
		body: rest,
	};
}

/* 光标所在行，或选区覆盖到的所有行 */
function selectedLines(editor, selections) {
	const lines = new Set();
	for (const sel of selections) {
		const from = Math.min(sel.anchor.line, sel.head.line);
		const to = Math.max(sel.anchor.line, sel.head.line);
		for (let line = from; line <= to; line++) {
			// 多行选区里的空行不动；单行时即使是空行也要能起个头
			if (to > from && editor.getLine(line).trim() === "") continue;
			lines.add(line);
		}
	}
	return [...lines].sort((a, b) => a - b);
}

/* 行首增删了内容，同一行上的光标跟着平移 */
function shift(pos, deltas) {
	return { line: pos.line, ch: Math.max(0, pos.ch + (deltas.get(pos.line) ?? 0)) };
}

/* 缩进的视觉宽度。Tab 补到下一个制表位，和编辑器里看到的对齐一致 */
export function indentWidth(indent, tabSize) {
	let width = 0;
	for (const char of indent) width += char === "\t" ? tabSize - (width % tabSize) : 1;
	return width;
}

/* 引用层级，用 > 的个数算，">>" 和 "> > " 视作同一层 */
export function quoteDepth(quote) {
	let depth = 0;
	for (const char of quote) if (char === ">") depth++;
	return depth;
}

/* 把选中的行交给 plan，它返回一张「行号 → 新内容」的改动表。
 *
 * 用改动表而不是逐行函数，是因为「切换任务列表」需要跳出选区去改上一层的
 * 段落（见 task-list.js 的 ensureListParent）。表里可以放任意行。
 * 所有改动走一次 transaction，撤销时是一步。 */
export function editLines(editor, plan) {
	const selections = editor.listSelections();
	const lines = selectedLines(editor, selections);
	if (lines.length === 0) return;

	const edits = plan(lines);

	const changes = [];
	const deltas = new Map();
	for (const [line, next] of edits) {
		const text = editor.getLine(line);
		if (next === text) continue;

		changes.push({ from: { line, ch: 0 }, to: { line, ch: text.length }, text: next });
		deltas.set(line, next.length - text.length);
	}
	if (changes.length === 0) return;

	changes.sort((a, b) => a.from.line - b.from.line); // CodeMirror 要求改动按位置排好
	// selections 用 from/to，不是 listSelections 的 anchor/head
	editor.transaction({
		changes,
		selections: selections.map((sel) => ({
			from: shift(sel.anchor, deltas),
			to: shift(sel.head, deltas),
		})),
	});
}
