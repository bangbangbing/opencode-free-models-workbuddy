#!/bin/bash
# Run the OpenCode free-model bridge in the foreground.
# Needs Node ^22.19 || >=24 on PATH. For a persistent daemon see references/persistence.md.
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
exec node "$DIR/bridge.mjs"
