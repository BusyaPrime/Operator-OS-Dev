#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# eas-build-post-install.sh — runs on EAS Build server after `pnpm install`
# completes, before Metro bundling starts.
#
# Why we need this: Operator-OS uses pnpm workspaces with two TS-only
# library packages (@operator-os/config + @operator-os/contracts) whose
# package.json declares `"main": "dist/index.js"`. The `dist/` folder is
# produced by `pnpm -F <pkg> build` (= `tsc -p tsconfig.json`). Local
# development has `dist/` populated from previous builds. The EAS Build
# server runs only `pnpm install --no-frozen-lockfile` and therefore
# leaves `dist/` empty — Metro then fails with:
#   "While trying to resolve module `@operator-os/config` ... However,
#    this package itself specifies a `main` module field that could not
#    be resolved (.../dist/index.js. Indeed, none of these files exist:"
#
# Fix: build the two TS-only library packages here so `dist/` exists by
# the time Metro starts bundling.
#
# Idempotent: re-running after a successful build is a no-op (tsc skips
# unchanged outputs via incremental compilation).
#
# Reference: https://docs.expo.dev/build-reference/npm-hooks/
# ---------------------------------------------------------------------------

set -euo pipefail

echo "[post-install] cwd: $(pwd)"
echo "[post-install] building workspace TS library packages…"

# EAS sets the working directory to the project root passed to `eas build`
# (apps/mobile/ here). Step out to the monorepo root.
cd ../..

echo "[post-install] building @operator-os/config"
pnpm --filter @operator-os/config build

echo "[post-install] building @operator-os/contracts"
pnpm --filter @operator-os/contracts build

echo "[post-install] verifying dist/ outputs"
test -f packages/config/dist/index.js
test -f packages/contracts/dist/index.js

echo "[post-install] done"
