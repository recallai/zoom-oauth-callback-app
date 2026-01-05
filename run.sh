#!/usr/bin/env bash
set -euo pipefail

# Compile TypeScript to ./dist and run the compiled app with Node
./node_modules/.bin/tsc --project tsconfig.json --outDir dist --rootDir .
node dist/index.js
