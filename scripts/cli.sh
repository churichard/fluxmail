#!/usr/bin/env bash
set -euo pipefail
pnpm --filter fluxmail... build
exec node packages/server/dist/cli.js "$@"
