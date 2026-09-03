/* 把 src/ 打包成 Obsidian 插件。
 *
 *   node build.mjs            构建一次并装进 vault
 *   node build.mjs --watch    改动即重建（重建后在 Obsidian 里重载插件即可看到）
 *   node build.mjs --dist     产物输出到 dist/，用来当 GitHub release 的附件
 *
 * vault 路径可用环境变量 OBSIDIAN_VAULT 覆盖。
 */

import { context } from "esbuild";
import { copyFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const vault = process.env.OBSIDIAN_VAULT ?? "/Users/lee/Documents/obsidian";

const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));
const watch = process.argv.includes("--watch");
const dist = process.argv.includes("--dist");

/* 发布模式落在 dist/，其余情况装进 vault 的插件目录。
 * 装到哪个子目录由 manifest 的 id 决定，不在这里写第二遍 ——
 * 改 id 时只改 manifest.json 一处，产物自然跟着走。 */
const outDir = dist ? join(root, "dist") : join(vault, ".obsidian", "plugins", manifest.id);

mkdirSync(outDir, { recursive: true });

/* Obsidian 在运行时提供这些模块，不能打进包里 */
const external = ["obsidian", "electron", "@codemirror/*", "@lezer/*", "node:*"];

const js = await context({
	entryPoints: [join(root, "src/main.js")],
	outfile: join(outDir, "main.js"),
	bundle: true,
	format: "cjs",
	target: "es2018",
	platform: "browser",
	external,
	logLevel: "info",
});

/* src/styles.css 里的 @import 会被内联成单个 styles.css，
 * Obsidian 在插件启用时自动加载它、禁用时自动移除。 */
const css = await context({
	entryPoints: [join(root, "src/styles.css")],
	outfile: join(outDir, "styles.css"),
	bundle: true,
	logLevel: "info",
});

copyFileSync(join(root, "manifest.json"), join(outDir, "manifest.json"));

if (watch) {
	await Promise.all([js.watch(), css.watch()]);
	console.log(`watching -> ${outDir}`);
} else {
	await Promise.all([js.rebuild(), css.rebuild()]);
	await Promise.all([js.dispose(), css.dispose()]);
	console.log(`${dist ? "built" : "installed"} -> ${outDir}`);
}
