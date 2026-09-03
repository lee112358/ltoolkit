import { Notice, Platform, Plugin, PluginSettingTab, Setting } from "obsidian";
import { DEFAULT_GROUP, FEATURES, GROUPS } from "./features/index.js";

/* 功能参数以 "功能id.参数名" 的形式和开关存在同一份设置里 */
function optionKey(featureId, key) {
	return `${featureId}.${key}`;
}

const DEFAULTS = {};
for (const feature of FEATURES) {
	DEFAULTS[feature.id] = feature.enabledByDefault !== false;
	for (const option of feature.options ?? []) {
		DEFAULTS[optionKey(feature.id, option.key)] = option.default;
	}
}

export default class LToolkit extends Plugin {
	async onload() {
		this.settings = Object.assign({}, DEFAULTS, await this.loadData());
		this.running = new Map();

		/* CodeMirror 扩展没法按功能单独摘：registerEditorExtension 是挂在插件
		 * 寿命上的。所以只注册一个数组，功能上下线时增删数组里的元素，
		 * 再让工作区重新配置一次。必须在跑 apply 之前登记好。 */
		this.editorExtensions = [];
		this.registerEditorExtension(this.editorExtensions);

		this.addSettingTab(new LToolkitSettingTab(this.app, this));
		for (const feature of FEATURES) this.apply(feature);
	}

	onunload() {
		// addChild 注册的功能由 Obsidian 自动 unload，这里只收尾 body class
		for (const feature of FEATURES) {
			if (feature.bodyClass) document.body.classList.remove(feature.bodyClass);
		}
	}

	available(feature) {
		return !(feature.desktopOnly && !Platform.isDesktop);
	}

	isOn(feature) {
		return this.available(feature) && this.settings[feature.id] === true;
	}

	getOption(featureId, key) {
		const value = this.settings[optionKey(featureId, key)];
		return typeof value === "string" ? value.trim() : value;
	}

	/* 把某项功能切到它当前应有的状态。纯 CSS 功能只翻 body class；
	 * 带 JS 的功能通过 addChild/removeChild 上下线，Component 会自动
	 * 清理它注册的所有事件监听，不需要重载整个插件。 */
	apply(feature) {
		const on = this.isOn(feature);

		if (feature.bodyClass) document.body.classList.toggle(feature.bodyClass, on);
		if (!feature.create) return;

		const child = this.running.get(feature.id);
		if (on && !child) {
			try {
				const created = feature.create(this.app, this);
				this.addChild(created);
				this.running.set(feature.id, created);
			} catch (err) {
				// 单个功能挂掉不应该连累其它功能
				console.error(`[ltoolkit] 功能 "${feature.id}" 启动失败`, err);
				new Notice(`Lee Toolkit：${feature.name} 启动失败，详见控制台`);
			}
		} else if (!on && child) {
			this.removeChild(child);
			this.running.delete(feature.id);
		}
	}

	/* 功能在 onload 里调它挂上自己的 CodeMirror 扩展，返回的函数交给
	 * this.register()，功能一关就摘掉。 */
	useEditorExtension(extension) {
		this.editorExtensions.push(extension);
		this.app.workspace.updateOptions();

		return () => {
			const at = this.editorExtensions.indexOf(extension);
			if (at !== -1) this.editorExtensions.splice(at, 1);
			this.app.workspace.updateOptions();
		};
	}

	async setEnabled(feature, on) {
		this.settings[feature.id] = on;
		await this.saveData(this.settings);
		this.apply(feature);
	}

	async setOption(featureId, key, value) {
		this.settings[optionKey(featureId, key)] = value;
		await this.saveData(this.settings);
		// 功能实现了 refresh 就通知它一声，参数改完立刻生效，不用重开开关
		this.running.get(featureId)?.refresh?.();
	}
}

class LToolkitSettingTab extends PluginSettingTab {
	constructor(app, plugin) {
		super(app, plugin);
		this.plugin = plugin;
		/* 哪些分组是收起的。初值取 GROUPS 里的 collapsed，之后跟着用户点击走 */
		this.collapsed = new Set(GROUPS.filter((g) => g.collapsed).map((g) => g.id));
	}

	display() {
		const { containerEl } = this;
		containerEl.empty();
		containerEl.addClass("ltoolkit-settings");

		for (const group of GROUPS) {
			const features = FEATURES.filter((f) => (f.group ?? DEFAULT_GROUP) === group.id);
			if (features.length === 0) continue; // 空分组不占地方

			const body = this.renderGroup(group);
			for (const feature of features) this.renderFeature(body, feature);
		}
	}

	/* 一个可折叠区块。折叠状态记在 this.collapsed 里而不是靠 DOM ——
	 * 切换任一功能都会重画整个面板，不自己记就会弹回默认状态。 */
	renderGroup(group) {
		const details = this.containerEl.createEl("details", { cls: "lt-group" });
		details.open = !this.collapsed.has(group.id);
		details.addEventListener("toggle", () => {
			if (details.open) this.collapsed.delete(group.id);
			else this.collapsed.add(group.id);
		});

		const summary = details.createEl("summary", { cls: "lt-group-summary" });
		summary.createSpan({ cls: "lt-group-name", text: group.name });
		if (group.desc) summary.createSpan({ cls: "lt-group-desc", text: group.desc });

		return details.createDiv({ cls: "lt-group-body" });
	}

	renderFeature(parent, feature) {
		const block = parent.createDiv({ cls: "lt-feature" });
		const usable = this.plugin.available(feature);
		const desc = usable ? feature.desc : `${feature.desc}（仅桌面端可用）`;

		new Setting(block)
			.setClass("lt-feature-setting")
			.setName(feature.name)
			.setDesc(desc)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.isOn(feature))
					.setDisabled(!usable)
					.onChange(async (value) => {
						await this.plugin.setEnabled(feature, value);
						this.display(); // 重画以显示/隐藏它的子设置
					}),
			);

		if (this.plugin.isOn(feature)) this.displaySubSettings(block, feature);
	}

	/* 参数和操作按钮只在功能开着的时候显示。
	 * 它们统一装进一个 .lt-sub-group，缩进和归属竖线由这一层承担，
	 * 这样竖线是连续的一条，而不是每行各画一段。 */
	displaySubSettings(block, feature) {
		const options = feature.options ?? [];
		if (options.length === 0 && !feature.action) return;

		const container = block.createDiv({ cls: "lt-sub-group" });

		for (const option of options) {
			const setting = new Setting(container)
				.setClass("lt-sub-setting")
				.setName(option.name)
				.setDesc(option.desc ?? "");

			if (option.type === "toggle") {
				setting.addToggle((toggle) =>
					toggle
						.setValue(this.plugin.getOption(feature.id, option.key) !== false)
						.onChange((value) => this.plugin.setOption(feature.id, option.key, value)),
				);
				continue;
			}

			if (option.type === "color") {
				setting.addColorPicker((picker) =>
					picker
						.setValue(
							String(this.plugin.getOption(feature.id, option.key) ?? option.default),
						)
						.onChange((value) => this.plugin.setOption(feature.id, option.key, value)),
				);
				continue;
			}

			setting.addText((text) =>
				text
					.setPlaceholder(option.placeholder ?? "")
					.setValue(String(this.plugin.getOption(feature.id, option.key) ?? ""))
					.onChange((value) => this.plugin.setOption(feature.id, option.key, value)),
			);
		}

		if (!feature.action) return;

		new Setting(container)
			.setClass("lt-sub-setting")
			.setName(feature.action.name)
			.setDesc(feature.action.desc ?? "")
			.addButton((button) =>
				button
					.setButtonText(feature.action.cta)
					.setCta()
					.onClick(() => {
						const instance = this.plugin.running.get(feature.id);
						if (instance?.run) instance.run();
						else new Notice("功能未在运行，请重新开关一次");
					}),
			);
	}
}
