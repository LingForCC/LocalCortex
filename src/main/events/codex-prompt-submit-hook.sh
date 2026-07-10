#!/usr/bin/env bash
#
# Codex prompt-submit → LocalCortex ingress bridge.
#
# Spec: docs/architecture.md §6.7 ("Bridging external systems to the ingress"),
# docs/features/handoffs/README.md → "Prompt-submit prompt".
#
# Companion to src/main/events/codex-hook.sh (which bridges the completion
# event). Codex's hooks system fires a UserPromptSubmit event each time the user
# submits a prompt; this script POSTs a "codex.prompt-submit" event so
# LocalCortex opens the handoff-attach popup for that session.
#
# Codex passes session metadata to lifecycle hooks as JSON on STDIN, including a
# `session_id` field. This script reads stdin and extracts `session_id` (falling
# back to env vars), then POSTs it. No jq dependency — a portable sed/grep
# extractor is used so this runs anywhere curl does.
#
# Usage (in your Codex hooks config):
#   UserPromptSubmit = "/path/to/codex-prompt-submit-hook.sh"
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

# Codex passes session metadata as JSON on stdin. Read it (non-blocking: some
# hook sources may not pipe anything); if absent or unparseable, fall back to
# the same env vars the completion hook uses.
STDIN_JSON=""
if [[ ! -t 0 ]]; then
  STDIN_JSON="$(cat || true)"
fi

# Extract "session_id" from the stdin JSON without jq. Matches the first
# "session_id": "value" occurrence; tolerates surrounding whitespace.
SESSION_ID_FROM_STDIN="$(printf '%s' "${STDIN_JSON}" \
  | sed -n 's/.*"session_id"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' \
  | head -n1 || true)"

SESSION_ID="${SESSION_ID_FROM_STDIN:-${LC_SESSION_ID:-${CODEX_SESSION_ID:-}}}"
WORKDIR="${LC_WORKDIR:-${PWD:-}}"
TIMESTAMP="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

# Build the JSON payload. We escape with bash parameter expansion (no jq dep).
# NOTE: do not use `sed` for JSON building — the previous `sed -e ':a' -e 'N'`
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

ESCAPED_WORKDIR="$(json_escape "${WORKDIR}")"
ESCAPED_SESSION_ID="$(json_escape "${SESSION_ID}")"

read -r -d '' PAYLOAD <<-JSON || true
{
  "type": "codex.prompt-submit",
  "source": "codex",
  "timestamp": "${TIMESTAMP}",
  "payload": {
    "sessionId": "${ESCAPED_SESSION_ID}",
    "workdir": "${ESCAPED_WORKDIR}"
  }
}
JSON

HEADER_ARGS=()
if [[ -n "${SECRET}" ]]; then
  HEADER_ARGS+=("-H" "x-localcortex-secret: ${SECRET}")
fi

# Fire-and-forget; never fail the Codex hook if the ingress is down.
# ${arr[@]+...} guards the empty-array expansion so `set -u` doesn't abort on
# bash < 4.4 (e.g. macOS's /bin/bash 3.2) when no secret is configured.
curl -sS -m 5 -X POST "${URL}" \
  -H "Content-Type: application/json" \
  ${HEADER_ARGS[@]+"${HEADER_ARGS[@]}"} \
  -d "${PAYLOAD}" >/dev/null 2>&1 || true

exit 0
