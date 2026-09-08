/* 标题按级别分色 —— 七个颜色由设置面板里的取色器决定。
 *
 * 颜色是值，纯 CSS 的 bodyClass 装不下，所以由功能实例把它们写成 body 上的
 * CSS 变量，配套的 heading-colors.css 再把这些变量接到 Obsidian 的
 * --inline-title-color / --h1-color … --h6-color 上。
 *
 * 不直接在 setOption 里写 Obsidian 那几个变量：那样这项功能一关，用户挑的值
 * 就还留在 body 上，得额外记住去清。这里所有权很清楚 —— 自己的变量自己写、
 * 自己卸载时清掉，接不接到 Obsidian 的变量上是 CSS 那边的事，由 bodyClass 管。
 */

import { Component } from "obsidian";

export const ID = "headingColors";

/* key 是设置里的选项名，variable 是写到 body 上的变量名。
 *
 * fallback 兼两个用处：一是还没挑过颜色时（设置里没存值）实际用的那个色，
 * 二是万一取到非法值时的兜底 —— 正常情况取色器只会给合法的 #rrggbb，
 * 手改过 data.json 才可能出问题，挡一下别把整条声明写废。
 *
 * 这几个值要和 features/index.js 里 options 的 default 一一对上：那边是取色器
 * 初次显示的颜色，这边是没存过值时真正生效的颜色，对不上就会「显示一个色、
 * 渲染成另一个色」。 */
const COLORS = [
	{ key: "title", variable: "--lt-heading-title", fallback: "#000000" },
	{ key: "h1", variable: "--lt-heading-1", fallback: "#a81f1f" },
	{ key: "h2", variable: "--lt-heading-2", fallback: "#634393" },
	{ key: "h3", variable: "--lt-heading-3", fallback: "#1977ae" },
	{ key: "h4", variable: "--lt-heading-4", fallback: "#20a297" },
	{ key: "h5", variable: "--lt-heading-5", fallback: "#000000" },
	{ key: "h6", variable: "--lt-heading-6", fallback: "#000000" },
];

export class HeadingColors extends Component {
	constructor(app, plugin) {
		super();
		this.app = app;
		this.plugin = plugin;
	}

	onload() {
		this.refresh();
		this.register(() => {
			for (const spec of COLORS) document.body.style.removeProperty(spec.variable);
		});
	}

	/* 设置面板里挑完颜色，main.js 的 setOption 会回调这里 */
	refresh() {
		for (const spec of COLORS) {
			const value = this.plugin.getOption(ID, spec.key);
			const valid = typeof value === "string" && CSS.supports("color", value);
			document.body.style.setProperty(spec.variable, valid ? value : spec.fallback);
		}
	}
}
