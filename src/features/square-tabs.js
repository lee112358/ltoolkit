/* 编辑区标签页改成直角分离式 —— 底色由这里算，形状交给 square-tabs.css。
 *
 * 底色两种来法：
 *   自动  拿编辑区底色和 --mono-100 混一点。--mono-100 亮色模式是黑、
 *         暗色模式是白，所以「加深」在暗色模式下自动变成「提亮」，
 *         两边都是朝着更有对比的方向走，不用各配一次。
 *   自定义  取色器挑一个死值，明暗模式共用。
 */

import { Component } from "obsidian";

export const ID = "squareTabs";

const VARIABLE = "--lt-tab-bg";
const FALLBACK_COLOR = "#e6e6e6";
const DEFAULT_DEPTH = 8;
const MAX_DEPTH = 40;

export class SquareTabs extends Component {
	constructor(app, plugin) {
		super();
		this.app = app;
		this.plugin = plugin;
	}

	onload() {
		this.refresh();
		this.register(() => document.body.style.removeProperty(VARIABLE));
	}

	/* 设置面板里改完开关、数值或颜色，main.js 的 setOption 会回调这里 */
	refresh() {
		document.body.style.setProperty(VARIABLE, this.color());
	}

	color() {
		if (this.plugin.getOption(ID, "auto") === false) {
			// 正常情况下值来自取色器，一定是合法的 #rrggbb；
			// 手改过 data.json 的话挡一下，别把整条声明写废了
			const value = this.plugin.getOption(ID, "color");
			return typeof value === "string" && CSS.supports("color", value)
				? value
				: FALLBACK_COLOR;
		}

		const parsed = Number.parseFloat(this.plugin.getOption(ID, "depth"));
		const depth = Number.isFinite(parsed)
			? Math.min(Math.max(parsed, 0), MAX_DEPTH)
			: DEFAULT_DEPTH;

		return `color-mix(in srgb, var(--background-primary) ${100 - depth}%, var(--mono-100))`;
	}
}
