#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# heartbeat-probe.sh — passive monitor for TD-030 (recurrent transient
# unreachability on /v1/agent/heartbeat/agent)
#
# Usage:
#   bash apps/api/scripts/heartbeat-probe.sh
#   bash apps/api/scripts/heartbeat-probe.sh https://other-host
#
# Output format (one line per probe):
#   <UTC-ISO8601-timestamp> heartbeat: <HTTP-code>
# where HTTP code is:
#   401  — endpoint healthy (auth-guard rejected the unauthenticated POST, as expected)
#   000  — TD-030 failure pattern (curl exit 56 / connection reset by peer)
#   5xx  — upstream error worth investigating
#
# Intended use: run every 15-30 min over a few hours after a CD deploy.
# If 401 returns consistently, the endpoint has resolved (H1 / H2 match
# Phase 3.1's spontaneous-resolution precedent). If 000 persists >2h,
# escalate per TD-030 "Action on recurrence".
# ---------------------------------------------------------------------------

set -euo pipefail

BASE="${1:-https://operator-os-api-m545sz2isq-ez.a.run.app}"
TS=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

# curl never hard-fails — we always print a code (000 on network / TLS
# failure). --max-time bounds the probe so a hung connection does not
# stall the caller indefinitely.
CODE=$(curl -sS -X POST \
  --max-time 10 \
  -o /dev/null \
  -w "%{http_code}" \
  -H "Content-Type: application/json" \
  -d '{}' \
  "${BASE}/v1/agent/heartbeat/agent" \
  || echo "000")

echo "${TS} heartbeat: ${CODE}"
