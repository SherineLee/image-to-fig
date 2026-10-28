#!/bin/bash
# 启动本地 Web 界面（macOS）
# 用途：带人工校准的完整五步流程（送图 → 切图 → 调整 → 预览 → 导出 .fig）
# 注意：切图与 HTML 重建需要你自备模型 API Key，导出 .fig 本身不需要。
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
PORT="${PORT:-18789}"
export IMAGE_TO_HTML_DATA_DIR="${IMAGE_TO_HTML_DATA_DIR:-$DIR/.image-to-fig-data}"

# 引擎做 HTML 预检时需要一个本机浏览器，默认指到 Chrome，没有就退回 Edge
if [ -z "${IMAGE_TO_HTML_BROWSER_PATH:-}" ]; then
  if [ -d "/Applications/Google Chrome.app" ]; then
    export IMAGE_TO_HTML_BROWSER_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
  elif [ -d "/Applications/Microsoft Edge.app" ]; then
    export IMAGE_TO_HTML_BROWSER_PATH="/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"
  fi
fi

if [ ! -d "$DIR/engine/node_modules" ]; then
  echo "依赖未安装，先跑：cd $DIR/engine && npm install"
  exit 1
fi

if [ ! -f "$DIR/engine/dist/ui.html" ]; then
  echo "界面尚未构建，先跑：cd $DIR/engine && npm run build"
  exit 1
fi

echo "启动中 → http://127.0.0.1:${PORT}"
exec node "$DIR/engine/bin/image-to-html.cjs" --port "$PORT" "$@"
