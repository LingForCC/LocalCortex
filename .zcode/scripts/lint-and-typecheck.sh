#!/usr/bin/env bash
# ZCode Stop hook: run lint + typecheck on the project.
# Exit 0 = pass (turn allowed to complete), exit 2 = block (force a fix).
set -uo pipefail

# Resolve the project directory: prefer the hook var, fall back to this script's location.
PROJECT_DIR="${ZCODE_PROJECT_DIR:-${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}}"
cd "$PROJECT_DIR"

# Skip if this isn't a Node project (defensive; should never happen here).
[ -f "package.json" ] || exit 0

# The hook runs in a non-interactive shell, so nvm/Homebrew PATH setup isn't applied
# and `npm` won't be found. Load nvm explicitly, preferring a Node version that satisfies
# the repo's `engines.node` (>=22.14.0) when one is installed.
NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
if [ -s "$NVM_DIR/nvm.sh" ] && ! command -v npm >/dev/null 2>&1; then
  # shellcheck disable=SC1091
  . "$NVM_DIR/nvm.sh"
  # Prefer the exact version this repo targets; fall back to nvm's default.
  if nvm ls 22.14.0 >/dev/null 2>&1; then
    nvm use 22.14.0 >/dev/null 2>&1
  elif [ -f "$NVM_DIR/alias/default" ]; then
    nvm use default >/dev/null 2>&1
  fi
fi

# Bail clearly (without blocking) if Node is genuinely unavailable — better than a
# misleading "lint failed" message.
if ! command -v npm >/dev/null 2>&1; then
  echo "⚠️  npm not found on PATH; skipping lint/typecheck hook." >&2
  echo "    (nvm not detected or no Node installed)" >&2
  exit 0
fi

run() {
  local label="$1"
  shift
  local output
  local code
  output="$("$@" 2>&1)"
  code=$?
  # ALL output goes to stderr. ZCode parses a Stop hook's stdout as JSON (strict
  # schema); printing anything human-readable to stdout — even on success —
  # makes the run fail JSON validation and the hook is recorded as failed.
  # Empty stdout + exit code is the contract: 0 passes, 2 blocks.
  if [ "$code" -ne 0 ]; then
    echo "❌ $label failed (exit $code)" >&2
    echo "$output" >&2
    echo "" >&2
    echo "--- End of $label output ---" >&2
    return 1
  fi
  echo "✅ $label passed" >&2
  return 0
}

# Build a combined result so a failure in either is reported before blocking.
fail=0
run "typecheck" npm run typecheck || fail=1
run "lint"      npm run lint      || fail=1

if [ "$fail" -ne 0 ]; then
  echo "" >&2
  echo "Lint/typecheck failed. Fix the errors above before continuing." >&2
  exit 2
fi

exit 0
