#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
bun install
mkdir -p bin
bun build src/index.ts --compile --outfile bin/fledge-memory
