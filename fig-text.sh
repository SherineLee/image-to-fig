#!/bin/bash
# 拖图即转：把图片拖进终端窗口，回车，产出「文字可编辑」的 .fig
#   ./fig-text.sh
# 也可以直接带路径：
#   ./fig-text.sh /path/to/你的图.png
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
IMAGE="$*"

if [ -z "${IMAGE// /}" ]; then
  read -r -p "把图片拖到这里，然后回车： " IMAGE
fi

# 拖进终端时 macOS 会转义空格、也可能带引号，这里还原成真实路径
IMAGE="${IMAGE//\\ / }"
IMAGE="${IMAGE%\'}"
IMAGE="${IMAGE#\'}"
IMAGE="${IMAGE%\"}"
IMAGE="${IMAGE#\"}"
IMAGE="$(printf '%s' "$IMAGE" | sed 's/^[[:space:]]*//; s/[[:space:]]*$//')"

if [ ! -f "$IMAGE" ]; then
  echo "找不到文件：$IMAGE"
  exit 1
fi

BASENAME="$(basename "${IMAGE%.*}")"
OUT="$DIR/output/${BASENAME}-editable.fig"

node "$DIR/bin/image-to-fig-text.cjs" --image "$IMAGE" --out "$OUT"
echo
echo "完成：$OUT"
open "$DIR/output"
