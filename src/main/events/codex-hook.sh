#!/usr/bin/env bash
#
# Codex session-complete → LocalCortex ingress bridge.
#
# Spec: docs/architecture.md §6.7 ("Bridging external systems to the ingress").
#
# Codex's first-party hooks system fires a `session-complete` event. Install
# this script into your Codex hooks config so that, when a session completes,
# the session context is POSTed to LocalCortex's local event ingress.
#
# Usage (in your Codex hooks config):
#   session-complete = "/path/to/codex-hook.sh"
#
# The script reads optional context from stdin / env (Codex passes session
# metadata when invoking hooks) and POSTs a JSON event to
# http://127.0.0.1:${LC_PORT:-4729}/event.
#
# A shared secret may be required by the ingress (architecture.md §8). If
# $LC_SECRET is set, it's sent in the `x-localcortex-secret` header.
#
# This script is intentionally dependency-light: only curl + standard tools.

set -euo pipefail

PORT="${LC_PORT:-4729}"
HOST="${LC_HOST:-127.0.0.1}"
URL="http://${HOST}:${PORT}/event"
SECRET="${LC_SECRET:-}"
SESSION_ID="${LC_SESSION_ID:-${CODEX_SESSION_ID:-}}"
WORKDIR="${LC_WORKDIR:-${PWD:-}}"
SUMMARY="${LC_SUMMARY:-${CODEX_SUMMARY:-}}"
TIMESTAMP="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

# Build the JSON payload. We use a small printf + sed escaper to avoid a jq dep.
json_escape() {
  # Escape backslash and double-quote, then newline, for a JSON string body.
  sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' -e ':a' -e 'N' -e '$!ba' -e 's/\n/\\n/g'
}

ESCAPED_SUMMARY="$(printf '%s' "${SUMMARY}" | json_escape)"
ESCAPED_WORKDIR="$(printf '%s' "${WORKDIR}" | json_escape)"
ESCAPED_SESSION_ID="$(printf '%s' "${SESSION_ID}" | json_escape)"

read -r -d '' PAYLOAD <<-JSON || true
{
  "type": "codex.session-complete",
  "source": "codex",
  "timestamp": "${TIMESTAMP}",
  "payload": {
    "sessionId": "${ESCAPED_SESSION_ID}",
    "workdir": "${ESCAPED_WORKDIR}",
    "summary": "${ESCAPED_SUMMARY}"
  }
}
JSON

HEADER_ARGS=()
if [[ -n "${SECRET}" ]]; then
  HEADER_ARGS+=("-H" "x-localcortex-secret: ${SECRET}")
fi

# Fire-and-forget; never fail the Codex hook if the ingress is down.
curl -sS -m 5 -X POST "${URL}" \
  -H "Content-Type: application/json" \
  "${HEADER_ARGS[@]}" \
  -d "${PAYLOAD}" >/dev/null 2>&1 || true

exit 0
