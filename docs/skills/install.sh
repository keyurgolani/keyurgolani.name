#!/usr/bin/env bash
# install.sh — symlink the vended skills into whichever harness discovery
# directories already exist for the current project. Idempotent.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
SKILLS=( "portfolio-author" "variant-developer" )

link_skill() {
  local target_dir="$1"
  local name="$2"
  local src="$SCRIPT_DIR/$name"
  local dest="$target_dir/$name"
  if [ ! -d "$target_dir" ]; then
    return 0
  fi
  if [ -e "$dest" ] || [ -L "$dest" ]; then
    echo "skip: $dest already exists (remove it first to relink)"
    return 0
  fi
  ln -s "$src" "$dest"
  echo "linked: $dest -> $src"
}

# Project-local discovery dirs — only link if the dir already exists.
for name in "${SKILLS[@]}"; do
  link_skill "$REPO_ROOT/.claude/skills" "$name"
  link_skill "$REPO_ROOT/.agents/skills" "$name"
done

# User-global Claude Code directory — link only if it exists.
for name in "${SKILLS[@]}"; do
  link_skill "$HOME/.claude/skills" "$name"
done

echo "done. skills available from: $SCRIPT_DIR"
