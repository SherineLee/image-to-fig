# image-to-fig（macOS 版）

把一张平面图片转成**可导入 Figma 的 `.fig` 文件**，在 macOS 上原生跑。

仓库：<https://github.com/SherineLee/image-to-fig>

## 换台电脑怎么用

```bash
git clone https://github.com/SherineLee/image-to-fig.git
cd image-to-fig
./setup-mac.sh          # 检查 Node → 装依赖 → 构建界面 → 自检，一条命令搞定
```

需要 Node ≥ 20.19。依赖不会随仓库走（`node_modules/` 已在 `.gitignore` 里，约 59 MB），换机器重新 `npm install` 即可。


## 它和原仓库的关系

| | 原仓库 `image-to-fig-pptx` | 本目录 |
|---|---|---|
| 运行环境 | **仅 Windows x64**（PPTX 环节依赖 Windows 版 PowerPoint 的 COM 自动化） | macOS（Apple Silicon / Intel 均可） |
| 产物 | 可编辑 PPTX | 可编辑 `.fig`（拖进 Figma 即可） |
| 卡死的那行 | `html-to-pptx.mjs:272` 里 `if (process.platform !== "win32") throw ...` | **已整条移除** |
| 保留的部分 | — | 引擎 `tools/image-to-html`（切图 / HTML 重建 / `.fig` 编码） |
| 许可证 | MIT | 沿用 MIT，见 `LICENSE-upstream` |

改造逻辑很直接：原项目只有**最后一步**「HTML → PPTX」绑死 Windows，而 `.fig` 编码（`openfig-core` + `fig-codec`）是纯 JS，本来就跨平台。所以砍掉 PPTX 转换器，把引擎单独拎出来，再补一个 macOS 命令行入口。

## 两种用法

### 用法 A：命令行（不需要 API Key）

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

### 用法 B：Web 界面（AI 切图，需要自备模型 Key）

```bash
cd engine && npm install && npm run build    # 首次
./start-mac.sh                                # 打开 http://127.0.0.1:18789
```

界面里走完整的五步流程：送图 → 一键切图 → 人工校准 → 生成 HTML → **导出 .fig**。
AI 切图需要你在左下角「设置」里配两个模型（图片理解 / 图片生成），**导出 .fig 这一步本身不消耗 Key**。

## 自检

```bash
node verify-mac.cjs
```

不联网、不要 Key，会真实产出一份 `output/verify-demo.fig` 并检查结构确认链路通畅。

**已在本机（macOS arm64 + Node v22.22.2）实测通过**：依赖全绿、界面已构建、端到端产出 `.fig`，
服务端 `POST /api/v1/exports/fig` 返回 HTTP 200 + 合法 `.fig`（外层 ZIP，内层 `canvas.fig` 头为 `fig-kiwi`）。

> 注意：HTTP 接口的前缀是 **`/api/v1/`**，例如 `/api/v1/exports/fig`，不是 `/api/exports/fig`。

## 目录

```
image-to-fig/
├── bin/image-to-fig.cjs    命令行入口（本次新写）
├── setup-mac.sh            换机一键复原（本次新写）
├── start-mac.sh            Web 界面启动脚本（本次新写）
├── verify-mac.cjs          自检（本次新写）
├── examples/               示例输入 + rects 样例
├── output/                 产物输出目录（.fig 不入库）
├── LICENSE                 MIT（保留上游版权声明）
└── engine/                 原仓库 tools/image-to-html，未改动
```

## 已知边界

- **命令行模式不做 AI 识图**：坐标要你给（`--rects`）。想要 AI 自动拆图走用法 B。
- `.fig` 里的文字**不是**可编辑文本框（图片本来就没有文字层）；要真正的文本节点，得先走「生成 HTML」再用 editable 模式导出。
- 原仓库的 PPTX 能力在本目录不可用（Windows 专属），需要 PPTX 请在 Windows 上用原仓库的 Release 包。
