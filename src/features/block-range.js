/* 找出光标所在「块」的行范围。
 *
 * 纯函数，只依赖 getLine / lineCount，不碰 obsidian，可单独测试。
 * 「渐进全选」和「Esc 选中整块」共用这一份。
 *
 * 块的判定顺序（先匹配到的赢）：
 *   围栏代码块 → 表格 → 引用块 → 列表项（含子项和续行）→ 标题 → 段落
 */

import { indentWidth, parseLine, quoteDepth } from "./line-edit.js";

/* 起止围栏：三个以上的反引号或波浪线。前面允许任意缩进，
 * 这样列表项里缩进的代码块同样能匹配。 */
const FENCE = /^\s*(`{3,}|~{3,})(.*)$/;

export function findFences(getLine, lineCount) {
	const blocks = [];
	let open = null;

	for (let i = 0; i < lineCount; i++) {
		const match = FENCE.exec(getLine(i));
		if (!match) continue;

		const marker = match[1];
		const char = marker[0];

		if (!open) {
			// 反引号围栏的语言标识里不能再出现反引号
			if (char === "`" && match[2].includes("`")) continue;
			open = { start: i, char, len: marker.length };
		} else if (char === open.char && marker.length >= open.len && match[2].trim() === "") {
			blocks.push({ start: open.start, end: i, closed: true });
			open = null;
		}
	}

	// 没闭合的围栏一直算到文末，行为与编辑器渲染一致
	if (open) blocks.push({ start: open.start, end: lineCount - 1, closed: false });

	return blocks;
}

function fenceAt(fences, line) {
	for (const fence of fences) {
		if (line >= fence.start && line <= fence.end) return fence;
	}
	return null;
}

const isTable = (text) => text.trimStart().startsWith("|");

/* 表格行里光标所在那一格的正文范围（不含两侧空白）。
 * 实时预览下 Obsidian 会把嵌套单元格编辑器的选区同步到主编辑器，
 * 反过来往主编辑器设这个范围也能正确显示，所以只需要按源码算出列的边界。 */
export function tableCellRange(text, ch) {
	const bars = [];
	for (let i = 0; i < text.length; i++) {
		if (text[i] === "|" && text[i - 1] !== "\\") bars.push(i);
	}
	if (bars.length < 2) return null;

	for (let i = 0; i < bars.length - 1; i++) {
		const open = bars[i] + 1;
		const close = bars[i + 1];
		if (ch < open || ch > close) continue;

		let from = open;
		let to = close;
		while (from < to && /\s/.test(text[from])) from++;
		while (to > from && /\s/.test(text[to - 1])) to--;
		return { from, to };
	}
	return null;
}

/* 从 line 出发，把满足 test 的连续行都圈进来 */
function spread(getLine, lineCount, line, test) {
	let start = line;
	while (start > 0 && test(start - 1)) start--;

	let end = line;
	while (end < lineCount - 1 && test(end + 1)) end++;

	return { start, end };
}

/* 列表项：往上找拥有这一行的那个带标记的行，往下把缩进更深的子项和续行收进来 */
function listRange(getLine, lineCount, line, tabSize) {
	let start = line;
	while (!parseLine(getLine(start)).bullet) {
		// 上面是空行或已经到文首，说明这行不属于任何列表项
		if (start === 0 || getLine(start - 1).trim() === "") return null;
		start--;
	}

	const base = indentWidth(parseLine(getLine(start)).indent, tabSize);
	let end = start;
	for (let i = start + 1; i < lineCount; i++) {
		if (getLine(i).trim() === "") break;
		if (indentWidth(parseLine(getLine(i)).indent, tabSize) <= base) break;
		end = i;
	}

	return { kind: "list", start, end };
}

/* 普通段落行：非空，且不是围栏、表格、引用、列表、标题 */
function isPlain(getLine, line) {
	const text = getLine(line);
	if (text.trim() === "" || FENCE.test(text) || isTable(text)) return false;

	const parsed = parseLine(text);
	return !parsed.bullet && parsed.heading === 0 && quoteDepth(parsed.quote) === 0;
}

export function blockRangeAt(getLine, lineCount, line, tabSize = 4) {
	const fence = fenceAt(findFences(getLine, lineCount), line);
	if (fence) return { kind: "code", start: fence.start, end: fence.end, closed: fence.closed };

	const text = getLine(line);
	if (text.trim() === "") return null; // 空行没有块可选

	if (isTable(text)) {
		return { kind: "table", ...spread(getLine, lineCount, line, (i) => isTable(getLine(i))) };
	}

	if (quoteDepth(parseLine(text).quote) > 0) {
		const test = (i) => getLine(i).trim() !== "" && quoteDepth(parseLine(getLine(i)).quote) > 0;
		return { kind: "quote", ...spread(getLine, lineCount, line, test) };
	}

	const list = listRange(getLine, lineCount, line, tabSize);
	if (list) return list;

	if (parseLine(text).heading > 0) return { kind: "heading", start: line, end: line };

	return { kind: "paragraph", ...spread(getLine, lineCount, line, (i) => isPlain(getLine, i)) };
}

/* ── 选区分级推进 ─────────────────────────────────────
 * 两个功能都是「按一次放大一级，到顶就放行交回编辑器」，逻辑放这里共用。 */

export function normalize(selection) {
	const { anchor, head } = selection;
	const anchorFirst =
		anchor.line < head.line || (anchor.line === head.line && anchor.ch <= head.ch);
	return anchorFirst ? { from: anchor, to: head } : { from: head, to: anchor };
}

const samePos = (a, b) => a.line === b.line && a.ch === b.ch;
export const sameRange = (a, b) => samePos(a.from, b.from) && samePos(a.to, b.to);

/* 当前选区在第几级就返回下一级；已经是最大一级（或没有级）返回 null 表示放行 */
export function nextStage(stages, current) {
	if (stages.length === 0) return null;

	const index = stages.findIndex((stage) => sameRange(current, stage));
	if (index === stages.length - 1) return null;
	return stages[index + 1]; // index 为 -1 时正好取到第 0 级
}
