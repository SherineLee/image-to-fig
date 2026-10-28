#!/usr/bin/env node
// 自检「文字可编辑」这条链路：OCR → 文本节点 → .fig
// 不联网、不要 API Key。跑完会产出 output/verify-text.fig

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const ROOT = path.join(__dirname);
const ENGINE = path.join(ROOT, "engine");
const IMAGE = path.join(ROOT, "examples", "sample.png");
const OUT = path.join(ROOT, "output", "verify-text.fig");

const { decodeFigDocument } = require(path.join(ENGINE, "src", "fig-export", "fig-codec"));

let failures = 0;
const pass = (message) => console.log(`  ✓ ${message}`);
const fail = (message) => {
  failures += 1;
  console.log(`  ✗ ${message}`);
};

console.log("自检：图片 → 可编辑文字 .fig\n");

if (!fs.existsSync(path.join(ROOT, "tools", "vision-ocr"))) {
  fail("tools/vision-ocr 未编译，先跑 ./setup-mac.sh 或：swiftc -O tools/vision-ocr.swift -o tools/vision-ocr");
  process.exit(1);
}
pass("OCR 工具就绪（tools/vision-ocr）");

try {
  execFileSync("node", [path.join(ROOT, "bin", "image-to-fig-text.cjs"), "--image", IMAGE, "--out", OUT], {
    encoding: "utf8",
    stdio: "pipe"
  });
} catch (error) {
  fail(`导出失败：${error.stdout || error.message}`);
  process.exit(1);
}

if (!fs.existsSync(OUT)) {
  fail("未产出 .fig");
  process.exit(1);
}
pass(`产出 .fig（${(fs.statSync(OUT).size / 1024).toFixed(1)} KB）→ ${path.relative(ROOT, OUT)}`);

const decoded = decodeFigDocument(fs.readFileSync(OUT));
const texts = decoded.nodes.filter((node) => node.type === "TEXT");
const images = decoded.nodes.filter((node) => node.fillPaints?.some((paint) => paint.type === "IMAGE"));

if (!texts.length) {
  fail("没有任何 TEXT 节点，文字不可编辑");
  process.exit(1);
}
pass(`含 ${texts.length} 个真正的 TEXT 节点（可在 Figma 里双击编辑）`);

const withCharacters = texts.filter((node) => node.textData && node.textData.characters);
if (withCharacters.length !== texts.length) {
  fail(`${texts.length - withCharacters.length} 个 TEXT 节点没有字符内容`);
} else {
  pass("所有 TEXT 节点都有文字内容");
}

const fonts = new Set(texts.map((node) => node.fontName && node.fontName.family).filter(Boolean));
if (!fonts.size) {
  fail("TEXT 节点没有字体信息");
} else {
  pass(`字体：${[...fonts].join(" / ")}`);
}

const sized = texts.filter((node) => node.fontSize > 0);
if (sized.length !== texts.length) {
  fail(`${texts.length - sized.length} 个 TEXT 节点缺字号`);
} else {
  const sizes = texts.map((node) => node.fontSize).sort((a, b) => a - b);
  pass(`字号范围 ${sizes[0].toFixed(1)} ~ ${sizes[sizes.length - 1].toFixed(1)} px`);
}

if (images.length) {
  pass(`底图保留为图片图层（${images.length} 个），可作为对照`);
}

console.log("\n前 5 个可编辑文字：");
for (const node of texts.slice(0, 5)) {
  const characters = node.textData.characters.replace(/\n/g, " ");
  console.log(`  ${node.fontSize.toFixed(1)}px ${node.fontName.family} — ${characters.slice(0, 32)}`);
}

console.log(failures ? `\n${failures} 项未通过` : "\n全部通过 ✓");
process.exit(failures ? 1 : 0);
