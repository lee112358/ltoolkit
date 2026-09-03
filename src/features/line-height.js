/* 正文行高 —— 从主题的 Style Settings 搬进插件里自己管。
 *
 * 行高是个数值，纯 CSS 的 bodyClass 装不下，所以由功能实例把它写成
 * body 上的 CSS 变量，配套的 line-height.css 再去用它。
 *
 * 不去改主题的 --line-height-customize，用自己的变量和选择器：换主题以后
 * 这条设置照样有效，也不会和主题面板里的同名设置互相覆盖得莫名其妙。
 */

import { Component } from "obsidian";

export const ID = "lineHeight";

const VARIABLE = "--lt-line-height";
const FALLBACK = 1.6;
const MIN = 1;
const MAX = 3;

export class LineHeight extends Component {
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
		const raw = Number.parseFloat(this.plugin.getOption(ID, "value"));
		const value = Number.isFinite(raw) ? Math.min(Math.max(raw, MIN), MAX) : FALLBACK;
		document.body.style.setProperty(VARIABLE, String(value));
	}
}
