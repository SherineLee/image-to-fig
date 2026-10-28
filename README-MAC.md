# image-to-fig（macOS 版）

把一张平面图片转成**可导入 Figma 的 `.fig` 文件**，在 macOS 上原生跑。

仓库：<https://github.com/SherineLee/image-to-fig>

## 换台电脑怎么用（完整步骤）

**1. 两个前置条件**

- Node ≥ 20.19（`node -v` 查看；没有就 `brew install node`）
- Xcode Command Line Tools（提供 `swiftc`，用来编译 macOS 原生 OCR）：`xcode-select --install`

**2. 取代码**

```bash
git clone https://github.com/SherineLee/image-to-fig.git
cd image-to-fig
```

**3. 一条命令装好**

```bash
./setup-mac.sh
```

它会依次做：检查 Node 版本 → `npm install` → 构建 Web 界面 → 编译 OCR → 跑两轮自检（图片图层链路 + 文字可编辑链路）。全程不联网调 API、不需要任何 Key，约 1-3 分钟。

依赖不随仓库走（`node_modules/` 约 59 MB 已在 `.gitignore` 里），换机器重装即可。

**4. 日常使用就是拖图**

```bash
./fig-text.sh
```

终端提示「把图片拖到这里，然后回车」→ 把图片文件**直接拖进终端窗口** → 回车。
`output/` 下会出现 `<文件名>-editable.fig` 并自动打开该目录，把它拖进 Figma，文字就能双击改。

**5. 在 Figma 里**

`File → Open` 选 `.fig`（或拖进 Figma 画布）。图层面板里会看到两类东西：

- `原图底图` —— 原始图片，用于对照；不需要就删掉
- `text-001-xxx`、`text-002-xxx`… —— 真正的文本节点，改字、改字体、改颜色随便来

如果 OCR 漏字或错字（复杂公式、艺术字容易错），在 Figma 里直接双击改掉即可；
也可以用 `--dry-run` 先看识别结果，`--min-confidence` 调过滤阈值。


## 它和原仓库的关系

| | 原仓库 `image-to-fig-pptx` | 本目录 |
|---|---|---|
| 运行环境 | **仅 Windows x64**（PPTX 环节依赖 Windows 版 PowerPoint 的 COM 自动化） | macOS（Apple Silicon / Intel 均可） |
| 产物 | 可编辑 PPTX | 可编辑 `.fig`（拖进 Figma 即可） |
| 卡死的那行 | `html-to-pptx.mjs:272` 里 `if (process.platform !== "win32") throw ...` | **已整条移除** |
| 保留的部分 | — | 引擎 `tools/image-to-html`（切图 / HTML 重建 / `.fig` 编码） |
| 许可证 | MIT | 沿用 MIT，见 `LICENSE-upstream` |

改造逻辑很直接：原项目只有**最后一步**「HTML → PPTX」绑死 Windows，而 `.fig` 编码（`openfig-core` + `fig-codec`）是纯 JS，本来就跨平台。所以砍掉 PPTX 转换器，把引擎单独拎出来，再补一个 macOS 命令行入口。

## 三种用法

### 用法 A：拖图转「文字可编辑」的 .fig（不需要 Key，主力用法）

图片里的文字会被 macOS 原生 Vision OCR 认出来，变成 Figma 里**真正的 TEXT 节点** —— 双击就能改字、改字体、改颜色。

```bash
./fig-text.sh                    # 把图片拖进终端窗口，回车
# 等价命令
node bin/image-to-fig-text.cjs --image 你的图.png --out output/editable.fig
```

产出的 `.fig`：原图作为底图（可删），每个识别到的文本块一个 TEXT 节点，按原坐标、原颜色摆放。

| 参数 | 作用 |
|---|---|
| `--lang zh-Hans,en-US` | OCR 语言，默认中英 |
| `--no-background` | 不铺原图底图，只留文字层（适合重新排版） |
| `--font-scale 1.05` | 字号估算偏小时调大 |
| `--font-weight 400` | 强制字重，跳过自动判断 |
| `--min-confidence 0.3` | 过滤置信度低的 OCR 结果 |
| `--dry-run` | 只打印识别到的文字清单，不生成文件 |

三个估算的依据：字号 = 文本块宽度 ÷ 字符宽度单位（中文一字宽≈字号，拉丁字母≈0.55 倍）；
字重按**同一张图内**的相对墨迹密度分位判断（绝对阈值对中文不可靠）；颜色取笔画像素（排掉抗锯齿边缘与极端像素）的平均。

### 用法 B：命令行（不需要 API Key，纯图片图层）

```bash
# 整图参考帧（导入 Figma 后自己排版）
node bin/image-to-fig.cjs --image 你的图.png --out 输出.fig

# 按坐标切成独立图层
node bin/image-to-fig.cjs --image 你的图.png --rects rects.json --out 输出.fig
```

`rects.json` 长这样：

```json
[
  { "name": "logo",   "x": 24,  "y": 18,  "width": 160, "height": 48 },
  { "name": "banner", "x": 200, "y": 120, "width": 640, "height": 360 }
]
```

产出的 `.fig` 里：整图作为**锁定的参考底图**，每个 rect 一个**独立的图片图层**（按原坐标摆放、带名字、可导出 PNG）。拖进 Figma 就能改。

### 用法 C：Web 界面（AI 切图 + 重建 HTML，需要自备模型 Key）

```bash
cd engine && npm install && npm run build    # 首次
./start-mac.sh                                # 打开 http://127.0.0.1:18789
```

界面里走完整的五步流程：送图 → 一键切图 → 人工校准 → 生成 HTML → **导出 .fig**。
AI 切图需要你在左下角「设置」里配两个模型（图片理解 / 图片生成），**导出 .fig 这一步本身不消耗 Key**。

## 自检

```bash
node verify-mac.cjs     # 图片图层链路
node verify-text.cjs    # 文字可编辑链路（会真实跑一次 OCR）
```

都不联网、不要 Key。`verify-text.cjs` 会解回 `.fig` 并断言里面确实有 TEXT 节点、有字符内容和字号。

**已在本机（macOS arm64 + Node v22.22.2）实测通过**：依赖全绿、界面已构建、端到端产出 `.fig`，
服务端 `POST /api/v1/exports/fig` 返回 HTTP 200 + 合法 `.fig`（外层 ZIP，内层 `canvas.fig` 头为 `fig-kiwi`）。

> 注意：HTTP 接口的前缀是 **`/api/v1/`**，例如 `/api/v1/exports/fig`，不是 `/api/exports/fig`。

## 目录

```
image-to-fig/
├── fig-text.sh             拖图即转「文字可编辑」.fig（最常用入口）
├── bin/image-to-fig-text.cjs  OCR → TEXT 节点（本次新写）
├── bin/image-to-fig.cjs    纯图片图层入口（本次新写）
├── setup-mac.sh            换机一键复原（本次新写）
├── start-mac.sh            Web 界面启动脚本（本次新写）
├── verify-mac.cjs          图片图层自检（本次新写）
├── verify-text.cjs         文字可编辑自检（本次新写）
├── tools/vision-ocr.swift  macOS Vision OCR 源码（本次新写）
├── examples/               示例输入 + rects 样例
├── output/                 产物输出目录（.fig 不入库）
├── LICENSE                 MIT（保留上游版权声明）
└── engine/                 原仓库 tools/image-to-html，未改动
```

## 已知边界

- **OCR 认的是文字，不是版面**：用法 A 只把文字抽成文本节点，背景、色块、插图和矢量形状仍然是底图里的像素，不会自动变成可编辑矩形/矢量。要整页 1:1 重建，走用法 C（AI 重建 HTML）。
- **OCR 对复杂内容会出错**：手写体、艺术字、数学公式、竖排文字识别率明显下降（示例图里 `V=RS9` 这类公式就是典型的错识）。这类内容建议在 Figma 里手动改。
- **字号、字重、颜色都是估算**，靠像素反推，不是从字体元数据读出来的。排版要求严的场合，导入后仍需微调；`--font-scale` 和 `--font-weight` 就是给这个用的。
- **用法 B 不做 AI 识图**：坐标要你给（`--rects`）。
- 原仓库的 PPTX 能力在本目录不可用（Windows 专属），需要 PPTX 请在 Windows 上用原仓库的 Release 包。
- OCR 用的是 macOS Vision 框架，**只在 macOS 上可用**；Linux/Windows 上 `fig-text.sh` 会提示找不到 OCR 工具（图片图层用法仍可正常跑）。
