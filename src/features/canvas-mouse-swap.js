/* Canvas Mouse Swap —— 对调 Obsidian 画布的鼠标/空格交互模式
 *
 * 默认（不按空格）:
 *   左键拖空白区域 = 平移画布
 *   滚轮           = 缩放画布
 * 按住空格:
 *   左键拖空白区域 = 框选
 *   滚轮           = 上下平移
 *
 * 保持原生不变: 右键/中键拖动平移、Ctrl(⌘)+滚轮与触控板捏合缩放、Shift+滚轮横向平移。
 *
 * 实现原理:
 *  - 滚轮: 直接调用画布原生的缩放实现 zoomBy()(调整目标缩放 tZoom, 由画布动画
 *    循环平滑收敛, 与 Ctrl+滚轮/触控板捏合同一条代码路径, 保证丝滑度)。
 *    零位移的滚轮事件(手势结束标记)直接丢弃, 否则 macOS 上画布会把它当作捏合
 *    结束触发 smartZoom(缩放到节点/全局适配)造成"缩放后弹回原状"。
 *    按住空格时原样放行(画布的空格状态被回滚), 普通滚轮即上下平移。
 *  - 左键平移: 原生画布对空白处左键无条件进入框选手势（handleDragToSelect），
 *    且空格平移依赖 keydown 时垫入的 moverEl 覆盖层，事件目标在按下瞬间已定，
 *    事后注入空格状态无法改变手势。因此直接拦截空白处的 pointerdown，
 *    用画布自身的 panBy()/posFromEvt() 驱动平移（与原生中键拖动平移同一 API）。
 *  - 空格对调: 吞掉真空格 keydown（若画布的全局监听先于本功能运行，则显式回滚
 *    isHoldingSpace 并 detach moverEl），让空格下的左键拖动/滚轮回到原生无空格行为。
 */

import { Component, ItemView, Platform } from "obsidian";

const WRAPPER = ".canvas-wrapper";

// 命中这些元素的左键按下不做平移处理，走原生逻辑（选中/拖动节点、点按钮等）
const INTERACTIVE = [
	".canvas-node",
	".canvas-edges",
	".canvas-menu",
	".canvas-card-menu",
	".canvas-controls",
	".canvas-sidebar",
	".clickable-icon",
	"button",
	"a",
	"input",
	"textarea",
	"select",
	'[contenteditable="true"]',
	".menu",
	".popover",
	".modal",
].join(", ");

export class CanvasMouseSwap extends Component {
	constructor(app) {
		super();
		this.app = app;
	}

	onload() {
		this.realSpaceHeld = false; // 用户此刻是否真的按着空格键
		this.panning = null; // { canvas, startPos, wrapper } 当前左键平移会话

		this.registerDomEvent(window, "keydown", (e) => this.onSpaceKey(e, true), {
			capture: true,
		});
		this.registerDomEvent(window, "keyup", (e) => this.onSpaceKey(e, false), { capture: true });
		this.registerDomEvent(window, "wheel", (e) => this.onWheel(e), {
			capture: true,
			passive: false,
		});
		// 画布的手势判定挂在 pointer 事件上，必须在它之前拦截
		this.registerDomEvent(window, "pointerdown", (e) => this.onPress(e), { capture: true });
		this.registerDomEvent(window, "pointermove", (e) => this.onMove(e), { capture: true });
		this.registerDomEvent(window, "pointerup", (e) => this.onRelease(e), { capture: true });
		this.registerDomEvent(window, "blur", () => this.reset());
	}

	onunload() {
		this.reset();
	}

	reset() {
		this.realSpaceHeld = false;
		this.endPan();
	}

	canvasViews() {
		const views = [];
		this.app.workspace.iterateAllLeaves((leaf) => {
			if (leaf.view && leaf.view.getViewType() === "canvas" && leaf.view.canvas)
				views.push(leaf.view.canvas);
		});
		return views;
	}

	canvasViewActive() {
		const view = this.app.workspace.getActiveViewOfType(ItemView);
		if (view && view.getViewType() === "canvas") return true;
		const active = document.activeElement;
		return active instanceof Element && !!active.closest(WRAPPER);
	}

	onSpaceKey(e, down) {
		if (e.code !== "Space" && e.key !== " ") return;
		const el = e.target instanceof Element ? e.target : document.body;
		if (el.isContentEditable || el.closest('input, textarea, select, [contenteditable="true"]'))
			return;

		this.realSpaceHeld = down;
		if (!this.canvasViewActive()) return;

		// 让画布收不到真空格: 阻止其进入原生 "空格=平移" 模式。
		// 若画布的全局 keydown 监听先于本功能注册（窗口捕获阶段更早），
		// 拦截无效，这里再显式回滚它已设置的状态作为兜底。
		e.preventDefault();
		e.stopImmediatePropagation();
		if (down) {
			for (const c of this.canvasViews()) {
				if (c.isHoldingSpace) {
					c.isHoldingSpace = false;
					if (c.moverEl) c.moverEl.detach();
				}
			}
		}
	}

	onWheel(e) {
		if (!this.inCanvas(e.target)) return;
		// 空格按住: 保持原生 = 上下平移
		if (this.realSpaceHeld) return;
		// 捏合 / 真 Ctrl(⌘) 缩放 / Alt / 横移: 保持原生
		if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
		// 横向分量为主（触控板横滑、倾斜滚轮）: 保持原生
		if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;

		e.preventDefault();
		e.stopImmediatePropagation();

		// 零位移的滚轮事件是手势结束标记, 不含滚动量;
		// 若放行, macOS 上画布会把它当作捏合结束触发 smartZoom(缩放到节点/全局适配)导致回弹
		if (e.deltaX === 0 && e.deltaY === 0) return;

		const wrapper = e.target.closest(WRAPPER);
		const canvas = this.canvasViews().find((c) => c.wrapperEl === wrapper);
		if (!canvas || canvas.readonly) return;
		if (canvas.isDragging) return; // 拖拽节点过程中画布原生也不响应滚轮

		let dy = e.deltaY;
		if (e.deltaMode === 1)
			dy *= 40; // DOM_DELTA_LINE
		else if (e.deltaMode === 2) dy *= 800; // DOM_DELTA_PAGE

		// 与画布原生 Ctrl+滚轮缩放完全相同的实现:
		// 调整目标缩放(tZoom), 由画布动画循环平滑收敛到该值, 保证丝滑度
		let factor = -dy / 300;
		if (Platform.isMacOS && !Number.isInteger(dy)) factor *= 2;
		canvas.zoomBy(factor, dy < 0 ? canvas.domPosFromEvt(e) : undefined);
		canvas.pauseAnimation = Date.now() + 200;
	}

	inCanvas(target) {
		return target instanceof Element && !!target.closest(WRAPPER);
	}

	onPress(e) {
		if (this.panning) return;
		if (e.button !== 0) return;
		if (e.pointerType && e.pointerType !== "mouse") return; // 触摸/笔不动原生手势
		if (this.realSpaceHeld) return; // 空格+左键 = 原生框选
		if (!this.inCanvas(e.target)) return;
		if (e.target.closest(INTERACTIVE)) return; // 节点/连线/控件: 原生

		const wrapper = e.target.closest(WRAPPER);
		const canvas = this.canvasViews().find((c) => c.wrapperEl === wrapper);
		if (!canvas || canvas.readonly) return;

		// 拦截本次按下，画布不会进入框选；用原生中键平移同一 API 驱动视口
		e.preventDefault();
		e.stopImmediatePropagation();
		canvas.deselectAll();
		this.panning = {
			canvas,
			startPos: canvas.posFromEvt(e),
			wrapper,
		};
		wrapper.style.cursor = "grabbing";
	}

	onMove(e) {
		if (!this.panning) return;
		const { canvas, startPos } = this.panning;
		const pos = canvas.posFromEvt(e);
		canvas.panBy(startPos.x - pos.x, startPos.y - pos.y);
	}

	onRelease() {
		this.endPan();
	}

	endPan() {
		if (!this.panning) return;
		if (this.panning.wrapper) this.panning.wrapper.style.cursor = "";
		this.panning = null;
	}
}
