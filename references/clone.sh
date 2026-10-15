#!/usr/bin/env bash
# Shallow-clone reference projects (study only; gitignored).
cd "$(dirname "$0")"
while read -r name url; do
  [ -d "$name" ] || git clone --depth 1 -q "$url" "$name" && echo "ok $name"
done <<LIST
vibe-kanban https://github.com/BloopAI/vibe-kanban
plane https://github.com/makeplane/plane
linear-sdk https://github.com/linear/linear
motion https://github.com/motiondivision/motion
auto-animate https://github.com/formkit/auto-animate
dnd-kit https://github.com/clauderic/dnd-kit
magicui https://github.com/magicuidesign/magicui
LIST
