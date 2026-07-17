import esbuild from "esbuild";
import { readFile } from "node:fs/promises";
import { builtinModules } from "node:module";
import process from "process";

const production = process.argv[2] === "production";
const builtins = [...builtinModules, ...builtinModules.map((name) => `node:${name}`)];
const packageJson = JSON.parse(await readFile(new URL("./package.json", import.meta.url), "utf8"));

const context = await esbuild.context({
  banner: { js: `/* Inkplane ${packageJson.version} for Obsidian */` },
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: ["obsidian", "electron", "@codemirror/*", "@lezer/*", ...builtins],
  format: "cjs",
  target: "es2018",
  logLevel: "info",
  sourcemap: production ? false : "inline",
  treeShaking: true,
  outfile: "main.js",
  minify: production
});

if (production) {
  await context.rebuild();
  await context.dispose();
} else {
  await context.watch();
}
