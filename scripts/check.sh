#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
# Mirror CI exactly: a frozen install (catches lockfile drift), then `pnpm check`.
pnpm install --frozen-lockfile
pnpm check
