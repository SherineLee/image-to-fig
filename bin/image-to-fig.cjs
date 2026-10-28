#!/usr/bin/env node
/**
 * image-to-fig.cjs — macOS 版「图片 → 可编辑 .fig」
 *
 * 从 image-to-fig-pptx (MIT, Ye334-git) 的引擎 tools/image-to-html 改造而来。
 * 原仓库的 PPTX 环节强依赖 Windows + PowerPoint，这里整条砍掉；
 * .fig 导出链路（openfig-core / fig-codec）是纯 JS，可在 macOS 原生运行。
 *
 * 用法：
 *   node bin/image-to-fig.cjs --image slide.png --rects rects.json --out slide.fig
 *   node bin/image-to-fig.cjs --image slide.png                      # 只生成整图参考帧
 *   node bin/image-to-fig.cjs --manifest manifest.json --kind slice   # 直接吃 manifest
 */

const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { createRequire } = require("node:module");

const ENGINE_DIR = path.resolve(__dirname, "..", "engine");
const engineRequire = createRequire(path.join(ENGINE_DIR, "package.json"));

function printHelp() {
  console.log([
    "image-to-fig — 把平面图片转成可导入 Figma 的 .fig（macOS）",
    "",
    "  --image <path>       输入图片（png/jpg/webp，必填，除非用 --manifest）",
    "  --rects <json|file>  切图区域数组，形如：",
    "                       [{\"name\":\"logo\",\"x\":24,\"y\":18,\"width\":160,\"height\":48}]",
    "                       传文件路径或直接传 JSON 字符串均可",
    "  --manifest <file>    直接提交已有的 manifest（slice / editable）",
    "  --kind <slice|editable>  配合 --manifest 使用，默认按 manifest.kind，否则 slice",
    "  --out <path>         输出 .fig 路径，默认与输入同名同目录",
    "  --name <name>        Figma 里顶层画框的名字，默认取文件名",
    "  --max-preview <px>   整图参考帧的最长边上限，默认 4096",
    "  -h, --help           显示帮助",
    "",
    "说明：不给 --rects 时，产出的是「整图参考帧 + 空图层」的 .fig，",
    "导入 Figma 后可自行排版；给了 --rects 才会按坐标切成独立图层。"
  ].join("\n"));
}

function parseArgs(argv) {
  const opts = {
    image: null,
    rects: null,
    manifest: null,
    kind: null,
    out: null,
    name: null,
    maxPreview: 4096,
    help: false
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") { opts.help = true; continue; }
    const [name, inline] = arg.split("=", 2);
    const known = ["--image", "--rects", "--manifest", "--kind", "--out", "--name", "--max-preview"];
    if (!known.includes(name)) throw new Error(`未知参数：${arg}`);
    const value = inline ?? argv[++i];
    if (!value) throw new Error(`${name} 缺少值`);
    if (name === "--image") opts.image = value;
    if (name === "--rects") opts.rects = value;
    if (name === "--manifest") opts.manifest = value;
    if (name === "--kind") opts.kind = value;
    if (name === "--out") opts.out = value;
    if (name === "--name") opts.name = value;
    if (name === "--max-preview") opts.maxPreview = Number(value);
  }
  return opts;
}

async function loadRects(input) {
  if (!input) return [];
  const raw = await fsp.readFile(input, "utf8").catch(() => null);
  const text = raw ?? input;
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("--rects 既不是合法 JSON，也不是一个可读的 JSON 文件");
  }
  if (!Array.isArray(parsed)) throw new Error("--rects 必须是数组");
  return parsed.map((rect, index) => {
    const x = Number(rect.x);
    const y = Number(rect.y);
    const width = Number(rect.width ?? rect.w);
    const height = Number(rect.height ?? rect.h);
    if (![x, y, width, height].every(Number.isFinite)) {
      throw new Error(`--rects 第 ${index + 1} 项的坐标不是数字`);
    }
    if (width <= 0 || height <= 0) {
      throw new Error(`--rects 第 ${index + 1} 项的宽高必须为正数`);
    }
    return {
      name: String(rect.name || `slice-${index + 1}`),
      x: Math.round(x),
      y: Math.round(y),
      width: Math.round(width),
      height: Math.round(height)
    };
  });
}

function toDataUrl(buffer, mime = "image/png") {
  return `data:${mime};base64,${buffer.toString("base64")}`;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) { printHelp(); return; }

  const sharp = engineRequire("sharp");
  const { exportFigManifest } = engineRequire("./src/fig-export/export-fig.js");

  let manifest;
  let kind = opts.kind || "slice";
  let defaultStem = "image-to-fig";

  if (opts.manifest) {
    const raw = await fsp.readFile(path.resolve(opts.manifest), "utf8");
    const parsed = JSON.parse(raw);
    manifest = parsed.manifest || parsed;
    kind = opts.kind || parsed.kind || "slice";
    defaultStem = path.basename(opts.manifest, path.extname(opts.manifest));
  } else if (opts.image) {
    const imagePath = path.resolve(opts.image);
    if (!fs.existsSync(imagePath)) throw new Error(`找不到图片：${imagePath}`);
    defaultStem = path.basename(imagePath, path.extname(imagePath));

    const meta = await sharp(imagePath).metadata();
    const width = meta.width;
    const height = meta.height;
    if (!width || !height) throw new Error("无法读取图片尺寸");

    // 整图参考帧：超大图按最长边缩放，避免 .fig 体积失控
    const longest = Math.max(width, height);
    const scale = longest > opts.maxPreview ? opts.maxPreview / longest : 1;
    const previewBuffer = await sharp(imagePath)
      .resize({ width: Math.round(width * scale), height: Math.round(height * scale), fit: "fill" })
      .png({ compressionLevel: 6 })
      .toBuffer();

    const rects = await loadRects(opts.rects);
    const assets = [];
    for (const rect of rects) {
      const left = Math.max(0, Math.min(rect.x, width - 1));
      const top = Math.max(0, Math.min(rect.y, height - 1));
      const cropWidth = Math.max(1, Math.min(rect.width, width - left));
      const cropHeight = Math.max(1, Math.min(rect.height, height - top));
      const buffer = await sharp(imagePath)
        .extract({ left, top, width: cropWidth, height: cropHeight })
        .png({ compressionLevel: 6 })
        .toBuffer();
      assets.push({
        name: rect.name,
        selected: true,
        placement: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        dataUrl: toDataUrl(buffer)
      });
    }

    manifest = {
      version: "ui-asset-manifest",
      screen: {
        name: opts.name || defaultStem,
        width,
        height
      },
      previewImage: { dataUrl: toDataUrl(previewBuffer) },
      assets
    };

    console.log(`图片：${width} × ${height}`);
    console.log(`切图图层：${assets.length} 个${scale < 1 ? `（整图参考帧已缩放到 ${scale.toFixed(2)}×）` : ""}`);
  } else {
    throw new Error("必须给 --image 或 --manifest");
  }

  const bytes = await exportFigManifest({ kind, manifest });
  const outPath = path.resolve(opts.out || `${defaultStem}.fig`);
  await fsp.writeFile(outPath, bytes);
  console.log(`已生成：${outPath}（${(bytes.length / 1024).toFixed(1)} KB）`);
  console.log("导入 Figma：File → Import，或把 .fig 直接拖进 Figma 画布。");
}

main().catch((error) => {
  console.error(`失败：${error.message}`);
  process.exit(1);
});
