#!/usr/bin/env node
/**
 * verify-mac.cjs — macOS 自检
 * 不联网、不需要 API Key，真实产出一份 .fig 来确认链路通畅。
 */

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { createRequire } = require("node:module");

const ROOT = __dirname;
const ENGINE_DIR = path.join(ROOT, "engine");
const engineRequire = createRequire(path.join(ENGINE_DIR, "package.json"));

let failed = 0;
function pass(text) { console.log(`  ✅ ${text}`); }
function warn(text) { console.log(`  ⚠️  ${text}`); }
function fail(text) { failed += 1; console.log(`  ❌ ${text}`); }

function checkNode() {
  const major = Number(process.versions.node.split(".")[0]);
  const minor = Number(process.versions.node.split(".")[1]);
  const ok = major > 20 || (major === 20 && minor >= 19);
  ok ? pass(`Node.js ${process.version}（要求 ≥ 20.19）`) : fail(`Node.js ${process.version} 过低，要求 ≥ 20.19`);
}

function checkDeps() {
  for (const name of ["sharp", "openfig-core", "jszip", "zstd-codec", "makerjs", "svgpath", "fast-xml-parser"]) {
    try {
      engineRequire(name);
      pass(`依赖 ${name}`);
    } catch (error) {
      fail(`依赖 ${name} 缺失或损坏：${error.message.split("\n")[0]}`);
    }
  }
}

function checkUi() {
  const ui = path.join(ENGINE_DIR, "dist", "ui.html");
  if (fs.existsSync(ui)) {
    pass(`界面已构建（dist/ui.html，${(fs.statSync(ui).size / 1024).toFixed(0)} KB）`);
  } else {
    warn("界面未构建，Web 流程暂不可用。跑一次：cd engine && npm run build");
  }
}

function makeDemoFig() {
  const sample = path.join(ROOT, "examples", "sample.png");
  if (!fs.existsSync(sample)) {
    fail(`缺示例图片：${sample}`);
    return;
  }
  const out = path.join(ROOT, "output", "verify-demo.fig");
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const rects = [
    { name: "demo-top-left", x: 40, y: 40, width: 320, height: 180 },
    { name: "demo-bottom-right", x: 900, y: 500, width: 400, height: 260 }
  ];
  fs.writeFileSync(path.join(ROOT, "output", "verify-rects.json"), JSON.stringify(rects, null, 2));

  execFileSync(process.execPath, [
    path.join(ROOT, "bin", "image-to-fig.cjs"),
    "--image", sample,
    "--rects", path.join(ROOT, "output", "verify-rects.json"),
    "--out", out
  ], { stdio: "inherit" });

  if (!fs.existsSync(out)) { fail("未产出 .fig"); return; }
  const bytes = fs.readFileSync(out);

  // 新版 Figma .fig 是 ZIP 封装：外层 PK 头，内层 canvas.fig 才是 kiwi 编码（fig-kiwi 头）
  const zipMagic = bytes.subarray(0, 4).toString("hex");
  if (zipMagic !== "504b0304") {
    fail(`.fig 外层不是 ZIP（头部 ${zipMagic}）`);
    return;
  }
  const listing = execFileSync("unzip", ["-l", out], { encoding: "utf8" });
  for (const required of ["canvas.fig", "meta.json", "thumbnail.png"]) {
    listing.includes(required) ? pass(`包含 ${required}`) : fail(`缺少 ${required}`);
  }
  const canvasHead = execFileSync("bash", ["-c", `unzip -p "$1" canvas.fig | head -c 8`, "_", out], { encoding: "utf8" });
  if (canvasHead === "fig-kiwi") {
    pass(`canvas.fig 头部正确（fig-kiwi）`);
  } else {
    fail(`canvas.fig 头部异常：${JSON.stringify(canvasHead)}`);
  }
  const imageCount = (listing.match(/images\//g) || []).length;
  pass(`产出 ${path.relative(ROOT, out)}（${(bytes.length / 1024).toFixed(1)} KB，${imageCount} 个图片资源）`);
}

console.log("image-to-fig macOS 自检\n");
checkNode();
checkDeps();
checkUi();
console.log("\n端到端试产：");
try {
  makeDemoFig();
} catch (error) {
  fail(`端到端失败：${error.message.split("\n")[0]}`);
}

console.log(failed === 0 ? "\n全部通过。" : `\n${failed} 项未通过。`);
process.exit(failed === 0 ? 0 : 1);
