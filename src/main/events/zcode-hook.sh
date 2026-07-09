#!/usr/bin/env bash
#
# ZCode session-complete → LocalCortex ingress bridge.
#
# Spec: mirrors src/main/events/codex-hook.sh. ZCode's hook system exposes the
# current session id as the `CLAUDE_SESSION_ID` environment variable (and the
# `${CLAUDE_SESSION_ID}` template). This Stop hook fires when an agent turn
# ends; it POSTs the session context to LocalCortex's local event ingress so
# any event rule matching `zcode.session-complete` (e.g. a "create a review
# subtask" handoff rule) can react.
#
# Usage — register in your ZCode workspace config (.zcode/config.json):
#
#   {
#     "hooks": {
#       "enabled": true,
#       "events": {
#         "Stop": [
#           {
#             "hooks": [
#               { "type": "command",
#                 "command": "bash \"${ZCODE_PROJECT_DIR}/src/main/events/zcode-hook.sh\"",
#                 "timeout": 10,
#                 "statusMessage": "Notifying LocalCortex" }
#             ]
#           }
#         ]
#       }
#     }
#   }
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
SESSION_ID="${CLAUDE_SESSION_ID:-${LC_SESSION_ID:-}}"
WORKDIR="${LC_WORKDIR:-${ZCODE_PROJECT_DIR:-${PWD:-}}}"
SUMMARY="${LC_SUMMARY:-}"
TIMESTAMP="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

# Build the JSON payload. We escape with bash parameter expansion (no jq dep).
# NOTE: do not use `sed` here — the previous `sed -e ':a' -e 'N' -e '$!ba'`
# idiom silently returns EMPTY output on macOS BSD sed when the input lacks a
# trailing newline (printf '%s' produces none), so all fields were dropped.
json_escape() {
  local s="$1"
  s="${s//\\/\\\\}"    # backslash first
  s="${s//\"/\\\"}"    # double quote
  s="${s//$'\n'/\\n}"  # newline
  s="${s//$'\r'/\\r}"  # carriage return
  s="${s//$'\t'/\\t}"  # tab
  printf '%s' "$s"
}

ESCAPED_SUMMARY="$(json_escape "${SUMMARY}")"
ESCAPED_WORKDIR="$(json_escape "${WORKDIR}")"
ESCAPED_SESSION_ID="$(json_escape "${SESSION_ID}")"

read -r -d '' PAYLOAD <<-JSON || true
{
  "type": "zcode.session-complete",
  "source": "zcode",
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

# Fire-and-forget; never fail the ZCode hook if the ingress is down.
curl -sS -m 5 -X POST "${URL}" \
  -H "Content-Type: application/json" \
  "${HEADER_ARGS[@]}" \
  -d "${PAYLOAD}" >/dev/null 2>&1 || true

exit 0
