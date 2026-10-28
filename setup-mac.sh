#!/bin/bash
# 一键复原：换电脑 / 刚 clone 下来之后，跑这一条就够了
#   ./setup-mac.sh
# 它做四件事：检查 Node 版本 → 装依赖 → 构建界面 → 跑自检
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
ENGINE="$DIR/engine"

echo "==> 1/4 检查 Node 版本（需要 >= 20.19）"
if ! command -v node >/dev/null 2>&1; then
  echo "未检测到 node，请先安装 Node 20.19+（推荐 https://nodejs.org 或 brew install node）"
  exit 1
fi
NODE_VER="$(node -v | sed 's/^v//')"
NODE_MAJOR="${NODE_VER%%.*}"
NODE_MINOR="$(echo "$NODE_VER" | cut -d. -f2)"
if [ "$NODE_MAJOR" -lt 20 ] || { [ "$NODE_MAJOR" -eq 20 ] && [ "$NODE_MINOR" -lt 19 ]; }; then
  echo "Node 版本过低：v$NODE_VER，需要 >= 20.19"
  exit 1
fi
echo "    Node v$NODE_VER ✓"

echo "==> 2/4 安装依赖（约 1-3 分钟）"
cd "$ENGINE"
# 国内网络如遇 TAR_ENTRY_ERROR / broker timeout，加 --registry=https://registry.npmmirror.com --maxsockets 1
npm install --no-audit --no-fund

echo "==> 3/4 构建 Web 界面"
npm run build

echo "==> 4/4 自检（不联网、不需要 Key）"
cd "$DIR"
node verify-mac.cjs

cat <<EOF

完成。接下来：

  # 命令行导出（不需要 Key）
  node bin/image-to-fig.cjs --image examples/sample.png --rects examples/rects.example.json --out output/demo.fig

  # Web 界面（AI 切图，需自备模型 Key）
  ./start-mac.sh        # → http://127.0.0.1:18789
EOF
