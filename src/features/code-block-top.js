/* 代码块顶部外扩 —— 让底色比第一行文字再往上多铺几个像素。
 *
 * 实时预览里代码块那层底色不是画在某个外层容器上，而是 Obsidian 给块内
 * 每一行 .cm-line 挂 HyperMD-codeblock-bg 直接铺的，所以块的上边界就是
 * 第一行的上边界，字顶着边。这里在起始那行上方补一条同色的窄条，
 * 圆角跟着 --code-radius 走，看起来就是整块往上长了几个像素。
 *
 * 高度装不进 bodyClass，由功能实例写成 body 上的 CSS 变量。
 */

import { Component } from "obsidian";

export const ID = "codeBlockTop";

const VARIABLE = "--lt-code-block-top";
const FALLBACK = 2;
const MIN = 0;
const MAX = 24;

export class CodeBlockTop extends Component {
	constructor(app, plugin) {
		super();
		this.app = app;
		this.plugin = plugin;
	}

	onload() {
		this.refresh();
		this.register(() => document.body.style.removeProperty(VARIABLE));
	}

	/* 设置面板里改完数字，main.js 的 setOption 会回调这里 */
	refresh() {
		const parsed = Number.parseFloat(this.plugin.getOption(ID, "size"));
		const value = Number.isFinite(parsed) ? Math.min(Math.max(parsed, MIN), MAX) : FALLBACK;
		document.body.style.setProperty(VARIABLE, `${value}px`);
	}
}
