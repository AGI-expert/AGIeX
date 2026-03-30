#!/usr/bin/env sh
# curl -sL agi.expert/install | sh
set -e

REPO="https://github.com/AGI-expert/AGIeX"
DIR="agi.expert"

echo ""
echo "  Installing AGI Expert..."
echo ""

if command -v git >/dev/null 2>&1; then
  git clone --depth 1 "$REPO.git" "$DIR" 2>/dev/null || git clone --depth 1 "$REPO.git" "$DIR"
else
  curl -sL "$REPO/archive/main.tar.gz" | tar xz
  mv AGIeX-main "$DIR"
fi

cd "$DIR"
exec ./start.sh "$@"
