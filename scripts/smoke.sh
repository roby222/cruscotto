#!/bin/sh
# Smoke test against the real engine, which the unit tests only stub: a headless session loads the plugin from
# this folder and runs /cruscotto; the report must come back whole, with its settings line. A headless session
# lists no plugin rows in /config, so that line's count is checked only when the engine hands some.
# Usage: scripts/smoke.sh [path to the claude binary]
set -eu
dir=$(cd "$(dirname "$0")/.." && pwd)
claude=${1:-${CLAUDE_BIN:-claude}}
fields=$(node -e "console.log(Object.keys(require('$dir/.claude-plugin/plugin.json').userConfig).length)")
out=$("$claude" -p "/cruscotto" --plugin-dir "$dir" --model claude-haiku-5-5 --permission-mode plan 2>/dev/null)
for want in 'model: ' '^range verdict: ' '^lamps: ' '^settings: '; do
  printf '%s\n' "$out" | grep -q "$want" || { echo "smoke: no line matching $want in:"; printf '%s\n' "$out"; exit 1; } >&2
done
line=$(printf '%s\n' "$out" | grep '^settings: ')
echo "$line" | cut -c1-120
found=$(printf '%s' "$line" | sed -n 's/^settings: \([0-9]*\) rows ours.*/\1/p')
if [ "${found:-0}" -eq 0 ]; then
  echo "smoke ok: report whole; the engine listed no plugin rows here (headless), so the panel's filter is untested"
elif [ "$found" -lt "$fields" ]; then
  echo "smoke: $found rows of ours in /config, the manifest has $fields fields" >&2; exit 1
else
  echo "smoke ok: report whole, $found rows of ours in /config"
fi
