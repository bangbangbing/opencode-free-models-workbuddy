#!/bin/sh
# Run the OpenCode free-model bridge in the foreground (macOS / Linux).
# Needs Node ^22.19 || >=24 on PATH. For a persistent daemon see
# references/persistence.md.
set -eu
DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
exec node "$DIR/bridge.mjs" "$@"
