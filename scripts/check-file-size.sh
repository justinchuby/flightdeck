#!/usr/bin/env bash
# check-file-size.sh — Warn at 400 LOC, error at 600 LOC for .ts/.tsx files
# Excludes test files and known exceptions (pre-existing large files).
# Exit code 1 if any non-excepted file exceeds the error threshold.
set -euo pipefail

WARN_THRESHOLD=400
ERROR_THRESHOLD=600

# Pre-existing large files — each has a TODO to be refactored.
# When you split a file below the threshold, remove it from this list.
EXCEPTIONS=(
  # TODO: Split AgentManager into lifecycle, messaging, and state modules
  "packages/server/src/agents/AgentManager.ts"
  # TODO: Split into sub-routers (session, agent, task, etc.)
  "packages/server/src/routes/projects.ts"
  # TODO: Extract DAG traversal and scheduling logic
  "packages/server/src/tasks/TaskDAG.ts"
  # TODO: Break ACP rendering into smaller components
  "packages/web/src/components/ChatPanel/AcpOutput.tsx"
  # TODO: Extract lifecycle sub-commands
  "packages/server/src/agents/commands/AgentLifecycle.ts"
  # TODO: Split NL parsing from command dispatch
  "packages/server/src/coordination/commands/NLCommandService.ts"
  # TODO: Extract graph layout and rendering
  "packages/web/src/components/TaskQueue/DagGraph.tsx"
  # TODO: Extract message list and input components
  "packages/web/src/components/GroupChat/GroupChat.tsx"
  # TODO: Extract timeline tracks into sub-components
  "packages/web/src/components/Timeline/TimelineContainer.tsx"
  # TODO: Extract role definitions into data files
  "packages/server/src/agents/RoleRegistry.ts"
  # TODO: Split Agent into core + capabilities
  "packages/server/src/agents/Agent.ts"
  # TODO: Extract knowledge sub-panels
  "packages/web/src/components/KnowledgePanel/KnowledgePanel.tsx"
  # TODO: Extract agent cards and filters
  "packages/web/src/components/CrewRoster/UnifiedCrewPage.tsx"
  # TODO: Extract task sub-commands
  "packages/server/src/agents/commands/TaskCommands.ts"
  # TODO: Extract dashboard widgets
  "packages/web/src/components/HomeDashboard/HomeDashboard.tsx"
  # TODO: Extract page sections into components
  "packages/web/src/pages/CrewPage.tsx"
  # TODO: Extract detail sections into sub-components
  "packages/web/src/components/AgentDetailPanel/AgentDetailPanel.tsx"
  # TODO: Extract task list and filters
  "packages/web/src/components/TaskQueue/TaskQueuePanel.tsx"
  # TODO: Split integration routing per-platform
  "packages/server/src/integrations/IntegrationRouter.ts"
  # TODO: Extract container registrations into modules
  "packages/server/src/container.ts"
)

is_exception() {
  local file="$1"
  for exc in "${EXCEPTIONS[@]}"; do
    if [[ "$file" == "$exc" ]]; then
      return 0
    fi
  done
  return 1
}

warnings=0
errors=0
exception_count=0

while IFS= read -r file; do
  # Skip test files
  if [[ "$file" == *"__tests__"* ]] || [[ "$file" == *".test."* ]] || [[ "$file" == *".spec."* ]]; then
    continue
  fi

  lines=$(wc -l < "$file" | tr -d ' ')

  if [ "$lines" -gt "$ERROR_THRESHOLD" ]; then
    if is_exception "$file"; then
      exception_count=$((exception_count + 1))
      echo "⚠️  EXCEPTED ($lines LOC): $file"
    else
      errors=$((errors + 1))
      echo "❌ ERROR ($lines LOC > $ERROR_THRESHOLD): $file"
    fi
  elif [ "$lines" -gt "$WARN_THRESHOLD" ]; then
    warnings=$((warnings + 1))
    echo "⚠️  WARN ($lines LOC > $WARN_THRESHOLD): $file"
  fi
done < <(find packages/server/src packages/web/src packages/shared/src \
  -name '*.ts' -o -name '*.tsx' 2>/dev/null | grep -v dist | grep -v node_modules | sort)

echo ""
echo "📊 File size check: $errors error(s), $warnings warning(s), $exception_count known exception(s)"
echo "   Thresholds: warn=$WARN_THRESHOLD, error=$ERROR_THRESHOLD"

if [ "$errors" -gt 0 ]; then
  echo "❌ FAILED — $errors file(s) exceed $ERROR_THRESHOLD LOC without an exception entry"
  exit 1
fi

echo "✅ PASSED"
exit 0
