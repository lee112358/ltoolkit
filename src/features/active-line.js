/* 当前行高亮的形状 —— 圆角、左右外扩，以及代码块里的例外。
 *
 * 主题（Typewriter 是 8px 圆角）画的这块底色紧贴着字，两头看着发挤。
 * 数值装不进 bodyClass，所以由功能实例写成 body 上的 CSS 变量，
 * 配套的 active-line.css 再去用它们。
 *
 * 代码块的底色就画在 .cm-line 自己身上（Obsidian 给它挂 HyperMD-codeblock-bg），
 * 高亮再往外扩就会顶出代码块的边。所以外扩有两份值：正文一份、代码块一份，
 * 后者由「代码块里贴合边界」这个开关决定是收成 0 还是跟正文一样。
 */

import { Component } from "obsidian";

export const ID = "activeLine";

/* variable 是写到 body 上的名字，其余三项是范围与兜底，单位一律 px */
const RADIUS = { variable: "--lt-active-line-radius", fallback: 0, min: 0, max: 24 };
const PADDING = { variable: "--lt-active-line-pad", fallback: 2, min: 0, max: 24 };
const PADDING_IN_CODE = { variable: "--lt-active-line-pad-code" };

export class ActiveLine extends Component {
	constructor(app, plugin) {
		super();
		this.app = app;
		this.plugin = plugin;
	}

	onload() {
		this.refresh();
		this.register(() => {
			for (const spec of [RADIUS, PADDING, PADDING_IN_CODE]) {
				document.body.style.removeProperty(spec.variable);
			}
		});
	}

	/* 设置面板里改完数字或开关，main.js 的 setOption 会回调这里 */
	refresh() {
		const pad = this.clamp(this.plugin.getOption(ID, "pad"), PADDING);
		const flush = this.plugin.getOption(ID, "flushInCode") !== false;

		this.write(RADIUS, this.clamp(this.plugin.getOption(ID, "radius"), RADIUS));
		this.write(PADDING, pad);
		this.write(PADDING_IN_CODE, flush ? 0 : pad);
	}

	clamp(raw, spec) {
		const parsed = Number.parseFloat(raw);
		return Number.isFinite(parsed)
			? Math.min(Math.max(parsed, spec.min), spec.max)
			: spec.fallback;
	}

	write(spec, value) {
		document.body.style.setProperty(spec.variable, `${value}px`);
	}
}
