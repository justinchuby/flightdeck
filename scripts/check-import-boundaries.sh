#!/usr/bin/env bash
# check-import-boundaries.sh — Enforce package import boundaries
#
# Rules:
#   - packages/web/  CANNOT import from packages/server/ (or @flightdeck/server)
#   - packages/server/ CANNOT import from packages/web/ (or @flightdeck/web)
#   - Both CAN import from packages/shared/ (or @flightdeck/shared)
#
# Scans actual source files for cross-boundary imports.
set -euo pipefail

errors=0

echo "🔍 Checking import boundaries..."
echo ""

# Rule 1: web/ cannot import from server/
echo "→ Checking: web/ does not import from server/"
while IFS= read -r file; do
  # Check for relative imports reaching into server
  if grep -nE "from ['\"].*packages/server" "$file" 2>/dev/null; then
    echo "❌ $file imports from packages/server/"
    errors=$((errors + 1))
  fi
  # Check for package imports from @flightdeck/server
  if grep -nE "from ['\"]@flightdeck/server" "$file" 2>/dev/null; then
    echo "❌ $file imports from @flightdeck/server"
    errors=$((errors + 1))
  fi
done < <(find packages/web/src -name '*.ts' -o -name '*.tsx' 2>/dev/null | grep -v node_modules | grep -v dist)

# Rule 2: server/ cannot import from web/
echo "→ Checking: server/ does not import from web/"
while IFS= read -r file; do
  if grep -nE "from ['\"].*packages/web" "$file" 2>/dev/null; then
    echo "❌ $file imports from packages/web/"
    errors=$((errors + 1))
  fi
  if grep -nE "from ['\"]@flightdeck/web" "$file" 2>/dev/null; then
    echo "❌ $file imports from @flightdeck/web"
    errors=$((errors + 1))
  fi
done < <(find packages/server/src -name '*.ts' -o -name '*.tsx' 2>/dev/null | grep -v node_modules | grep -v dist)

echo ""
echo "📊 Import boundary check: $errors violation(s)"

if [ "$errors" -gt 0 ]; then
  echo "❌ FAILED — cross-package imports detected"
  exit 1
fi

echo "✅ PASSED"
exit 0
