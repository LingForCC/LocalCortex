#!/usr/bin/env bash
#
# Codex Desktop -> LocalCortex event bridge.
#
# Codex invokes this script for both UserPromptSubmit and Stop via the plugin's
# hooks/hooks.json. Hook metadata arrives as JSON on stdin. The bridge maps that
# metadata to LocalCortex's event schema and deliberately emits no stdout so it
# never changes or blocks the Codex turn.

set -uo pipefail

PORT="${LC_PORT:-4729}"
HOST="${LC_HOST:-127.0.0.1}"
URL="http://${HOST}:${PORT}/event"
SECRET="${LC_SECRET:-}"
EVENT_TYPE="${LC_EVENT_TYPE:-codex.session-complete}"
EVENT_SOURCE="${LC_EVENT_SOURCE:-codex}"
TIMESTAMP="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

HOOK_INPUT=""
if [[ ! -t 0 ]]; then
  HOOK_INPUT="$(cat || true)"
fi

# Codex passes hook metadata as JSON. Use a real JSON decoder so escaped values
# are never corrupted. If none is available, the LC_*/CODEX_* and PWD fallbacks
# below are safer than interpreting JSON fragments with regular expressions.
read_json_string() {
  local key="$1"

  if [[ -z "${HOOK_INPUT}" ]]; then
    return 0
  fi

  if [[ "$(uname -s 2>/dev/null || true)" == "Darwin" ]] && command -v plutil >/dev/null 2>&1; then
    printf '%s' "${HOOK_INPUT}" \
      | plutil -extract "${key}" raw -o - - 2>/dev/null || true
    return 0
  fi

  if command -v python3 >/dev/null 2>&1; then
    printf '%s' "${HOOK_INPUT}" \
      | python3 -c 'import json, sys; value = json.load(sys.stdin).get(sys.argv[1], ""); sys.stdout.write(value if isinstance(value, str) else "")' "${key}" \
        2>/dev/null || true
    return 0
  fi

  if command -v jq >/dev/null 2>&1; then
    printf '%s' "${HOOK_INPUT}" \
      | jq -j --arg key "${key}" '.[$key] | if type == "string" then . else "" end' \
        2>/dev/null || true
  fi

  return 0
}

INPUT_SESSION_ID="$(read_json_string session_id)"
INPUT_WORKDIR="$(read_json_string cwd)"
INPUT_SUMMARY=""
if [[ "${EVENT_TYPE}" == "codex.session-complete" ]]; then
  INPUT_SUMMARY="$(read_json_string last_assistant_message)"
fi

SESSION_ID="${LC_SESSION_ID:-${INPUT_SESSION_ID:-${CODEX_SESSION_ID:-}}}"
WORKDIR="${LC_WORKDIR:-${INPUT_WORKDIR:-${PWD:-}}}"
SUMMARY="${LC_SUMMARY:-${INPUT_SUMMARY:-${CODEX_SUMMARY:-}}}"

json_escape() {
  local value="$1"
  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  value="${value//$'\n'/\\n}"
  value="${value//$'\r'/\\r}"
  value="${value//$'\t'/\\t}"
  printf '%s' "${value}"
}

ESCAPED_EVENT_TYPE="$(json_escape "${EVENT_TYPE}")"
ESCAPED_EVENT_SOURCE="$(json_escape "${EVENT_SOURCE}")"
ESCAPED_SESSION_ID="$(json_escape "${SESSION_ID}")"
ESCAPED_WORKDIR="$(json_escape "${WORKDIR}")"
ESCAPED_SUMMARY="$(json_escape "${SUMMARY}")"

read -r -d '' PAYLOAD <<-JSON || true
{
  "type": "${ESCAPED_EVENT_TYPE}",
  "source": "${ESCAPED_EVENT_SOURCE}",
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

# LocalCortex may not be running. Delivery is best-effort and must never make
# the Codex hook fail. The guarded array expansion also works with macOS Bash
# 3.2 when no secret header is configured.
curl -sS -m 5 -X POST "${URL}" \
  -H "Content-Type: application/json" \
  ${HEADER_ARGS[@]+"${HEADER_ARGS[@]}"} \
  -d "${PAYLOAD}" >/dev/null 2>&1 || true

exit 0
