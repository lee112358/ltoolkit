/* 编辑视图标记的竖线颜色 —— 颜色是个值，纯 CSS 的 bodyClass 装不下，
 * 所以由功能实例把它写成 body 上的 CSS 变量，配套的 edit-marker.css 再去用它。
 *
 * 和 heading-colors.js 一个路子：自己的变量自己写、自己卸载时清掉。
 */

import { Component } from "obsidian";

export const ID = "editMarker";

const VARIABLE = "--lt-edit-marker-color";

/* 还没挑过颜色时实际生效的色，也是取到非法值（手改过 data.json）时的兜底。
 * 这个值要和 features/index.js 里 options 的 default 对上 —— 那边是取色器初次
 * 显示的颜色，这边是真正渲染出来的颜色，对不上就会「显示一个色、画出另一个色」。
 *
 * 取的是 Obsidian 默认强调色在浅色下的 --interactive-accent，也就是这条线在
 * 做成设置项之前的样子。 */
const FALLBACK = "#af9af4";

export class EditMarker extends Component {
	constructor(app, plugin) {
		super();
		this.app = app;
		this.plugin = plugin;
	}

	onload() {
		this.refresh();
		this.register(() => document.body.style.removeProperty(VARIABLE));
	}

	/* 设置面板里挑完颜色，main.js 的 setOption 会回调这里 */
	refresh() {
		const value = this.plugin.getOption(ID, "color");
		const valid = typeof value === "string" && CSS.supports("color", value);
		document.body.style.setProperty(VARIABLE, valid ? value : FALLBACK);
	}
}
