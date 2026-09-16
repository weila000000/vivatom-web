#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_dir"

if [[ ! -d node_modules ]]; then
  pnpm install --frozen-lockfile
fi

exec pnpm dev
