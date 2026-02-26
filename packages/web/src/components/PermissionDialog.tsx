import { useState, useEffect, useCallback } from 'react';
import { Shield, FileText, Terminal, X } from 'lucide-react';
import { useAppStore } from '../stores/appStore';
import { useApi } from '../hooks/useApi';
import type { AgentInfo, AcpPermissionRequest } from '../types';

const AUTO_DENY_SECONDS = 60;

function getLocalStorageKey(agentRole: string) {
  return `acp-always-allow:${agentRole}`;
}

function formatArgs(args: Record<string, any> | undefined): string {
  if (!args || typeof args !== 'object') return '{}';
  const json = JSON.stringify(args, null, 2);
  return json.length > 400 ? json.slice(0, 400) + '\n…' : json;
}

const TOOL_ICONS = { file: FileText, terminal: Terminal, shield: Shield } as const;

function getToolIcon(toolName: string | undefined) {
  if (!toolName) return Shield;
  if (toolName.startsWith('fs/') || toolName.includes('file')) return FileText;
  if (toolName.startsWith('terminal/') || toolName.includes('command')) return Terminal;
  return Shield;
}

function getToolSummary(toolName: string | undefined, args: Record<string, any> | undefined): string | null {
  if (!toolName || !args) return null;
  if (toolName.includes('write') && args.path) return args.path;
  if (toolName.includes('create') && args.command) return args.command;
  if (args.command) return args.command;
  if (args.path) return args.path;
  return null;
}

export function PermissionDialog() {
  const agents = useAppStore((s) => s.agents);
  const clearPermission = useAppStore((s) => s.clearPermission);
  const api = useApi();

  const agentWithPermission: AgentInfo | undefined = agents.find((a) => a.pendingPermission);
  const request: AcpPermissionRequest | undefined = agentWithPermission?.pendingPermission;

  const [alwaysAllow, setAlwaysAllow] = useState(false);
  const [countdown, setCountdown] = useState(AUTO_DENY_SECONDS);

  // Reset state when a new request appears
  useEffect(() => {
    if (request) {
      setAlwaysAllow(false);
      setCountdown(AUTO_DENY_SECONDS);

      // Auto-allow if previously set
      if (agentWithPermission) {
        const saved = localStorage.getItem(getLocalStorageKey(agentWithPermission.role.id));
        if (saved === 'true') {
          api.resolvePermission(agentWithPermission.id, true);
          clearPermission(agentWithPermission.id);
        }
      }
    }
  }, [request?.id]);

  // Countdown timer
  useEffect(() => {
    if (!request || !agentWithPermission) return;

    // Check if auto-allowed
    const saved = localStorage.getItem(getLocalStorageKey(agentWithPermission.role.id));
    if (saved === 'true') return;

    const interval = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          api.resolvePermission(agentWithPermission.id, false);
          clearPermission(agentWithPermission.id);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [request?.id, agentWithPermission?.id, api, clearPermission]);

  const handleResolve = useCallback(
    (approved: boolean) => {
      if (!agentWithPermission || !request) return;

      if (approved && alwaysAllow) {
        localStorage.setItem(getLocalStorageKey(agentWithPermission.role.id), 'true');
      }

      api.resolvePermission(agentWithPermission.id, approved);
      clearPermission(agentWithPermission.id);
    },
    [agentWithPermission, request, alwaysAllow, api, clearPermission],
  );

  // Don't render if nothing pending (or auto-allowed)
  if (!agentWithPermission || !request) return null;

  const saved = localStorage.getItem(getLocalStorageKey(agentWithPermission.role.id));
  if (saved === 'true') return null;

  const ToolIcon = getToolIcon(request.toolName);
  const summary = getToolSummary(request.toolName, request.arguments);
  const toolLabel = request.toolName ?? 'unknown tool';
  const argsObj = request.arguments ?? {};

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-surface-raised border border-gray-700 rounded-xl shadow-2xl w-full max-w-lg mx-4">
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-gray-700">
          <Shield size={20} className="text-amber-400" />
          <h2 className="text-base font-semibold text-gray-100 flex-1">Permission Request</h2>
          <span className="text-xs text-gray-500 tabular-nums">{countdown}s</span>
          <button
            onClick={() => handleResolve(false)}
            className="text-gray-500 hover:text-gray-300"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-4">
          {/* Agent info */}
          <div className="flex items-center gap-2">
            <span className="text-lg">{agentWithPermission.role.icon}</span>
            <span className="text-sm font-medium text-gray-200">
              {agentWithPermission.role.name}
            </span>
            <span className="text-xs text-gray-500 font-mono">
              {agentWithPermission.id.slice(0, 8)}
            </span>
          </div>

          {/* Tool name */}
          <div className="flex items-center gap-2">
            <ToolIcon size={16} className="text-blue-400 shrink-0" />
            <code className="text-sm text-blue-300 bg-blue-900/20 px-2 py-0.5 rounded">
              {toolLabel}
            </code>
          </div>

          {/* Summary line */}
          {summary && (
            <div className="text-sm text-gray-300 bg-gray-800 rounded px-3 py-2 font-mono truncate">
              {summary}
            </div>
          )}

          {/* Arguments preview */}
          <details className="group">
            <summary className="text-xs text-gray-500 cursor-pointer hover:text-gray-400">
              Arguments
            </summary>
            <pre className="mt-2 text-xs text-gray-400 bg-gray-800 rounded p-3 overflow-auto max-h-48 font-mono">
              {formatArgs(argsObj)}
            </pre>
          </details>

          {/* Always allow checkbox */}
          <label className="flex items-center gap-2 text-sm text-gray-400 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={alwaysAllow}
              onChange={(e) => setAlwaysAllow(e.target.checked)}
              className="rounded border-gray-600 bg-gray-800 text-blue-500 focus:ring-blue-500/30"
            />
            Always allow for this agent role
          </label>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-5 py-4 border-t border-gray-700">
          <button
            onClick={() => handleResolve(false)}
            className="px-4 py-2 text-sm font-medium rounded-lg bg-red-600/20 text-red-400 border border-red-600/30 hover:bg-red-600/30 transition-colors"
          >
            Deny
          </button>
          <button
            onClick={() => handleResolve(true)}
            className="px-4 py-2 text-sm font-medium rounded-lg bg-green-600/20 text-green-400 border border-green-600/30 hover:bg-green-600/30 transition-colors"
          >
            Allow
          </button>
        </div>
      </div>
    </div>
  );
}
