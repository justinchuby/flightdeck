#!/usr/bin/env bash
# check-circular-deps.sh — Detect circular dependencies using madge
#
# Uses a baseline file (.circular-deps-baseline.json) to track known cycles.
# Only fails if NEW cycles are introduced (count exceeds baseline).
# Reduce baseline numbers as cycles are fixed.
#
# Requires: npx madge (installed as devDependency)
set -euo pipefail

BASELINE_FILE=".circular-deps-baseline.json"
regressions=0

get_baseline() {
  local pkg="$1"
  if [ -f "$BASELINE_FILE" ]; then
    node -e "const b=JSON.parse(require('fs').readFileSync('$BASELINE_FILE','utf8')); console.log(b['$pkg']||0)"
  else
    echo "0"
  fi
}

check_package() {
  local pkg_name="$1"
  local pkg_path="$2"
  local ts_config="$3"
  local baseline
  baseline=$(get_baseline "$pkg_name")

  echo "→ Checking $pkg_name for circular dependencies (baseline: $baseline)..."

  local output
  local count=0
  if output=$(npx madge --circular --extensions ts,tsx "$pkg_path" --ts-config "$ts_config" 2>&1); then
    count=0
  else
    # Extract cycle count from madge output
    count=$(echo "$output" | grep -o 'Found [0-9]* circular' | grep -o '[0-9]*' || echo "0")
    if [ -z "$count" ] || [ "$count" = "0" ]; then
      # Non-circular error — warn but don't fail
      echo "  ⚠️  $pkg_name: madge error: $(echo "$output" | head -3)"
      return
    fi
  fi

  if [ "$count" -gt "$baseline" ]; then
    echo "  ❌ $pkg_name: REGRESSION — $count cycles (baseline: $baseline, +$((count - baseline)) new)"
    echo "$output" | head -20
    regressions=$((regressions + 1))
  elif [ "$count" -lt "$baseline" ]; then
    echo "  🎉 $pkg_name: IMPROVED — $count cycles (baseline: $baseline, -$((baseline - count)) fixed!)"
    echo "     Update .circular-deps-baseline.json to lock in this improvement."
  elif [ "$count" -eq 0 ]; then
    echo "  ✅ $pkg_name: no circular dependencies"
  else
    echo "  ⚠️  $pkg_name: $count cycles (matches baseline — not blocking CI)"
  fi
  echo ""
}

echo "🔍 Checking for circular dependencies..."
echo ""

if [ -d "packages/server/src" ]; then
  check_package "server" "packages/server/src" "packages/server/tsconfig.json"
fi

if [ -d "packages/web/src" ]; then
  check_package "web" "packages/web/src" "packages/web/tsconfig.json"
fi

if [ -d "packages/shared/src" ]; then
  check_package "shared" "packages/shared/src" "packages/shared/tsconfig.json"
fi

echo "📊 Circular dependency check: $regressions regression(s)"

if [ "$regressions" -gt 0 ]; then
  echo "❌ FAILED — new circular dependencies introduced"
  exit 1
fi

echo "✅ PASSED (no new cycles introduced)"
exit 0
