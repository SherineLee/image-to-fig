#!/usr/bin/env node
// 图片 → 可编辑文字的 .fig
//
// 与 bin/image-to-fig.cjs 的区别：那个把整图和切片都当图片图层，文字改不了；
// 这个先用 macOS Vision 做 OCR，把每个文字块变成 Figma 真正的 TEXT 节点，
// 文字可在 Figma 里直接双击编辑、改字体、改颜色。
//
// 用法：
//   node bin/image-to-fig-text.cjs --image 你的图.png --out output/editable.fig
//
// 可选参数：
//   --lang zh-Hans,en-US   OCR 语言（默认 zh-Hans,en-US）
//   --no-background        不铺原图底图（只留文字层，方便重新排版）
//   --font-scale 1.05      字号微调系数（估算偏小时调大）
//   --font-weight 400      强制所有文字字重，跳过自动判断
//   --min-confidence 0.3   过滤低置信度 OCR 结果
//   --dry-run              只输出识别到的文本清单，不生成 .fig

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const ROOT = path.join(__dirname, "..");
const ENGINE = path.join(ROOT, "engine");
const OCR_BIN = path.join(ROOT, "tools", "vision-ocr");
const OCR_SRC = path.join(ROOT, "tools", "vision-ocr.swift");

const sharp = require(path.join(ENGINE, "node_modules", "sharp"));
const { createEditableDesignScreen } = require(path.join(ENGINE, "src", "plugin", "screen-importer"));
const { createFigExportApi, exportApiDocument } = require(path.join(ENGINE, "src", "fig-export", "figma-api-adapter"));

const atobNode = (base64) => Buffer.from(base64, "base64").toString("binary");

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      args[key] = true;
    } else {
      args[key] = next;
      i += 1;
    }
  }
  return args;
}

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function resolveOcrCommand() {
  if (fs.existsSync(OCR_BIN)) return { command: OCR_BIN, args: [] };
  if (fs.existsSync(OCR_SRC)) return { command: "swift", args: [OCR_SRC] };
  return null;
}

function runOcr(imagePath, languages) {
  const resolved = resolveOcrCommand();
  if (!resolved) {
    throw new Error(
      "找不到 OCR 工具。请先编译：swiftc -O tools/vision-ocr.swift -o tools/vision-ocr\n" +
      "（或直接跑 ./setup-mac.sh 自动编译）"
    );
  }
  const stdout = execFileSync(
    resolved.command,
    [...resolved.args, imagePath, languages],
    { maxBuffer: 64 * 1024 * 1024, encoding: "utf8" }
  );
  const parsed = JSON.parse(stdout);
  return {
    width: Number(parsed.width),
    height: Number(parsed.height),
    blocks: Array.isArray(parsed.blocks) ? parsed.blocks : []
  };
}

// 在文字块的包围盒里做像素分析：找背景、找墨迹、取文字颜色与笔画密度
async function analyzeBlock(imagePath, box, canvas) {
  const left = clamp(Math.floor(box.x), 0, canvas.width - 2);
  const top = clamp(Math.floor(box.y), 0, canvas.height - 2);
  const width = clamp(Math.ceil(box.width), 2, canvas.width - left);
  const height = clamp(Math.ceil(box.height), 2, canvas.height - top);
  if (width < 2 || height < 2) return null;

  const { data, info } = await sharp(imagePath)
    .extract({ left, top, width, height })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const channels = info.channels;
  const total = width * height;

  const luma = new Float32Array(total);
  const histogram = new Int32Array(32);
  for (let i = 0; i < total; i += 1) {
    const offset = i * channels;
    const value = 0.299 * data[offset] + 0.587 * data[offset + 1] + 0.114 * data[offset + 2];
    luma[i] = value;
    histogram[clamp(Math.floor(value / 8), 0, 31)] += 1;
  }

  let dominantBin = 0;
  for (let bin = 1; bin < histogram.length; bin += 1) {
    if (histogram[bin] > histogram[dominantBin]) dominantBin = bin;
  }
  const backgroundLuma = dominantBin * 8 + 4;

  const isInk = new Uint8Array(total);
  const inkDelta = new Float32Array(total);
  let backgroundR = 0;
  let backgroundG = 0;
  let backgroundB = 0;
  let backgroundCount = 0;
  let inkCount = 0;
  const rowInk = new Int32Array(height);

  for (let i = 0; i < total; i += 1) {
    const offset = i * channels;
    const delta = Math.abs(luma[i] - backgroundLuma);
    if (delta <= 35) {
      backgroundR += data[offset];
      backgroundG += data[offset + 1];
      backgroundB += data[offset + 2];
      backgroundCount += 1;
      continue;
    }
    isInk[i] = 1;
    inkDelta[i] = delta;
    inkCount += 1;
    rowInk[Math.floor(i / width)] += 1;
  }

  if (!inkCount) return null;

  let inkTop = 0;
  let inkBottom = height - 1;
  while (inkTop < height && rowInk[inkTop] === 0) inkTop += 1;
  while (inkBottom > inkTop && rowInk[inkBottom] === 0) inkBottom -= 1;
  const inkRows = Math.max(1, inkBottom - inkTop + 1);

  // 笔画宽度 = 水平方向连续墨迹段长度的中位数；整行长线（下划线、边框）不计入
  const strokeLengths = [];
  for (let row = inkTop; row <= inkBottom; row += 1) {
    let run = 0;
    const rowIsLine = rowInk[row] > width * 0.9;
    for (let col = 0; col < width; col += 1) {
      if (isInk[row * width + col]) {
        run += 1;
        continue;
      }
      if (run > 0 && !rowIsLine && run <= width * 0.8) strokeLengths.push(run);
      run = 0;
    }
    if (run > 0 && !rowIsLine && run <= width * 0.8) strokeLengths.push(run);
  }
  strokeLengths.sort((a, b) => a - b);
  const strokeWidth = strokeLengths.length
    ? strokeLengths[Math.floor(strokeLengths.length / 2)]
    : 0;

  // 颜色取墨迹中「离背景中等距离」的那批像素平均：
  // 太近的是抗锯齿边缘（发灰），太远的是极端像素（过饱和），都要排掉
  const inkPixels = [];
  for (let i = 0; i < total; i += 1) {
    if (isInk[i]) inkPixels.push(i);
  }
  inkPixels.sort((a, b) => inkDelta[a] - inkDelta[b]);
  const bandStart = Math.floor(inkPixels.length * 0.45);
  const bandEnd = Math.max(bandStart + 1, Math.floor(inkPixels.length * 0.85));
  let r = 0;
  let g = 0;
  let b = 0;
  for (let i = bandStart; i < bandEnd; i += 1) {
    const offset = inkPixels[i] * channels;
    r += data[offset];
    g += data[offset + 1];
    b += data[offset + 2];
  }
  const bandCount = bandEnd - bandStart;
  const toHex = (value) => clamp(Math.round(value), 0, 255).toString(16).padStart(2, "0");
  const color = `#${toHex(r / bandCount)}${toHex(g / bandCount)}${toHex(b / bandCount)}`;

  return {
    color,
    inkTop,
    inkBottom,
    inkRows,
    strokeWidth,
    density: inkCount / (inkRows * width),
    backgroundLuma,
    background: backgroundCount
      ? {
          r: backgroundR / backgroundCount,
          g: backgroundG / backgroundCount,
          b: backgroundB / backgroundCount
        }
      : null
  };
}

// 用「文本宽度 ÷ 字符宽度单位」估字号：中文一字宽约等于字号，拉丁字母约 0.55 倍
function estimateFontSize(text, boxWidth) {
  const cjk = (text.match(/[㐀-䶿一-鿿぀-ヿ＀-￯]/g) || []).length;
  const latin = (text.match(/[A-Za-z0-9]/g) || []).length;
  const spaces = (text.match(/\s/g) || []).length;
  const units = cjk * 1 + latin * 0.55 + spaces * 0.3;
  if (units <= 0) return null;
  return boxWidth / units;
}

function quantile(sortedValues, ratio) {
  if (!sortedValues.length) return 0;
  const index = clamp(Math.floor(sortedValues.length * ratio), 0, sortedValues.length - 1);
  return sortedValues[index];
}

async function buildTextNodes({ imagePath, blocks, canvas, options }) {
  const analyzed = [];
  let skipped = 0;

  for (let i = 0; i < blocks.length; i += 1) {
    const block = blocks[i];
    const text = String(block.text || "").trim();
    if (!text) {
      skipped += 1;
      continue;
    }
    if (Number(block.confidence) < options.minConfidence) {
      skipped += 1;
      continue;
    }

    const ink = await analyzeBlock(imagePath, block, canvas);
    const byWidth = estimateFontSize(text, block.width);
    let fontSize = byWidth;
    if (ink && !fontSize) {
      fontSize = ink.inkRows * 1.1;
    }
    if (!fontSize || !Number.isFinite(fontSize)) {
      skipped += 1;
      continue;
    }

    analyzed.push({
      index: i,
      text,
      block,
      ink,
      fontSize: clamp(fontSize * options.fontScale, 8, 160)
    });
  }

  // 字重按「同一张图内的相对墨迹密度」判断：
  // 绝对阈值不可靠（中文覆盖率天然偏高），用分位数只把明显更粗的那部分挑出来
  const densities = analyzed
    .filter((entry) => entry.ink)
    .map((entry) => entry.ink.density)
    .sort((a, b) => a - b);
  const boldLine = quantile(densities, 0.85);
  const mediumLine = quantile(densities, 0.7);

  const nodes = analyzed.map((entry) => {
    const { index, text, block, ink, fontSize } = entry;
    let fontWeight = options.fontWeight;
    if (!fontWeight) {
      const density = ink ? ink.density : 0;
      if (density >= boldLine && density > 0.3) fontWeight = 700;
      else if (density >= mediumLine && density > 0.25) fontWeight = 600;
      else fontWeight = 400;
    }
    return {
      type: "text",
      name: `text-${String(index + 1).padStart(3, "0")}-${text.slice(0, 12).replace(/\s+/g, "_")}`,
      x: Math.round(block.x * 100) / 100,
      y: Math.round(block.y * 100) / 100,
      width: Math.max(1, Math.round(block.width * 100) / 100),
      height: Math.max(fontSize * 1.4, Math.round(block.height * 100) / 100),
      text,
      fontSize: Math.round(fontSize * 10) / 10,
      fontWeight: Number(fontWeight),
      lineHeight: Math.round(fontSize * 1.35 * 10) / 10,
      letterSpacing: 0,
      color: ink ? ink.color : "#111318",
      density: ink ? Math.round(ink.density * 100) / 100 : 0
    };
  });

  return { nodes, skipped };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const imagePath = args.image ? path.resolve(args.image) : null;
  if (!imagePath) {
    console.error("用法：node bin/image-to-fig-text.cjs --image 你的图.png --out output/editable.fig");
    process.exit(1);
  }
  if (!fs.existsSync(imagePath)) {
    console.error(`图片不存在：${imagePath}`);
    process.exit(1);
  }

  const options = {
    languages: typeof args.lang === "string" ? args.lang : "zh-Hans,en-US",
    withBackground: args["no-background"] !== true,
    fontScale: Number(args["font-scale"]) > 0 ? Number(args["font-scale"]) : 1,
    fontWeight: args["font-weight"] ? Number(args["font-weight"]) : null,
    minConfidence: Number(args["min-confidence"]) >= 0 ? Number(args["min-confidence"]) : 0.3
  };

  const metadata = await sharp(imagePath).metadata();
  const canvas = { width: metadata.width, height: metadata.height };
  console.log(`图片 ${canvas.width}×${canvas.height}`);

  const ocr = await runOcr(imagePath, options.languages);
  console.log(`OCR 识别到 ${ocr.blocks.length} 个文字块`);

  const { nodes, skipped } = await buildTextNodes({
    imagePath,
    blocks: ocr.blocks,
    canvas,
    options
  });

  if (args["dry-run"]) {
    console.log("\n--dry-run：以下为将要写入的文本节点");
    for (const node of nodes.slice(0, 20)) {
      console.log(
        `  ${String(Math.round(node.x)).padStart(5)},${String(Math.round(node.y)).padStart(5)}` +
        `  ${String(node.fontSize).padStart(6)}px  w${node.fontWeight} 墨量${String(node.density).padEnd(5)}` +
        `  ${node.color}  ${node.text.slice(0, 26)}`
      );
    }
    console.log(`\n合计 ${nodes.length} 个文本节点，跳过 ${skipped} 个`);
    return;
  }

  const definitions = [];
  if (options.withBackground) {
    const backgroundPng = await sharp(imagePath).png().toBuffer();
    definitions.push({
      type: "image",
      name: "原图底图",
      x: 0,
      y: 0,
      width: canvas.width,
      height: canvas.height,
      dataUrl: `data:image/png;base64,${backgroundPng.toString("base64")}`,
      scaleMode: "FILL"
    });
  }
  definitions.push(...nodes);

  const api = createFigExportApi();
  const result = await createEditableDesignScreen({
    figmaApi: api,
    atob: atobNode,
    manifest: {
      screen: {
        name: path.basename(imagePath, path.extname(imagePath)).slice(0, 60),
        width: canvas.width,
        height: canvas.height,
        clipsContent: true
      },
      sourceImage: options.withBackground
        ? { dataUrl: `data:image/png;base64,${(await sharp(imagePath).png().toBuffer()).toString("base64")}` }
        : undefined,
      nodes: definitions
    }
  });

  const bytes = await exportApiDocument(api, {
    name: path.basename(imagePath, path.extname(imagePath)).slice(0, 60)
  });

  const outPath = args.out
    ? path.resolve(args.out)
    : path.join(ROOT, "output", `${path.basename(imagePath, path.extname(imagePath))}-editable.fig`);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, bytes);

  console.log(`\n已写出 ${path.relative(ROOT, outPath)}（${(bytes.length / 1024).toFixed(1)} KB）`);
  console.log(`文本节点 ${nodes.length} 个${skipped ? `，跳过 ${skipped} 个` : ""}`);
  if (result.skipped && result.skipped.length) {
    console.log(`引擎跳过 ${result.skipped.length} 个节点：${result.skipped[0].reason}`);
  }
}

main().catch((error) => {
  console.error(`失败：${error && error.message ? error.message : error}`);
  process.exit(1);
});
