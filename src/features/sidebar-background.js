/* 侧边栏背景色 —— 让左右侧边栏和编辑区共用一个底色，或者自己挑一个。
 *
 * 主题给侧边栏用 --background-secondary、给编辑区用 --background-primary，
 * 两者是不是同一个颜色完全看主题心情。这里不去动主题的变量定义，只在
 * 侧边栏这个范围内把它重定义一遍（见 sidebar-background.css）。
 *
 * 颜色是个值，纯 CSS 的 bodyClass 装不下，所以由功能实例写成 body 上的
 * CSS 变量：跟随时写 var(--background-primary)，明暗模式各自都对得上；
 * 自定义时写用户挑的那个颜色。
 */

import { Component } from "obsidian";

export const ID = "sidebarBackground";

const VARIABLE = "--lt-sidebar-bg";
const FOLLOW = "var(--background-primary)";
const FALLBACK = "#ffffff";

export class SidebarBackground extends Component {
	constructor(app, plugin) {
		super();
		this.app = app;
		this.plugin = plugin;
	}

	onload() {
		this.refresh();
		this.register(() => document.body.style.removeProperty(VARIABLE));
	}

	/* 设置面板里改完开关或颜色，main.js 的 setOption 会回调这里 */
	refresh() {
		document.body.style.setProperty(VARIABLE, this.color());
	}

	color() {
		if (this.plugin.getOption(ID, "follow") !== false) return FOLLOW;

		// 正常情况下值来自取色器，一定是合法的 #rrggbb；
		// 手改过 data.json 的话挡一下，别把整条声明写废了
		const value = this.plugin.getOption(ID, "color");
		return typeof value === "string" && CSS.supports("color", value) ? value : FALLBACK;
	}
}
