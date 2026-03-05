import { useState, useEffect } from 'react';
import { useAppStore } from '../../stores/appStore';
import { useSettingsStore } from '../../stores/settingsStore';
import type { ThemeMode } from '../../stores/settingsStore';
import { Trash2, Plus, Sun, Moon, Monitor, Settings, Cpu, Users, Terminal, ChevronDown, ChevronRight, Zap, Volume2 } from 'lucide-react';
import { DashboardCustomizer } from './DashboardCustomizer';
import { PlaybookLibrary } from '../Playbooks';
import { IntentRulesDashboard } from '../IntentRules';
import { RecoverySettingsPanel, RecoveryMetricsCard } from '../Recovery';
import { NotificationPreferencesPanel, NotificationActivityLog } from '../Notifications';

interface Props {
  api: any;
}

export function SettingsPanel({ api }: Props) {
  const config = useAppStore((s) => s.config);
  const roles = useAppStore((s) => s.roles);
  const { soundEnabled, toggleSound } = useSettingsStore();
  const [maxAgents, setMaxAgents] = useState(config?.maxConcurrentAgents || 10);
  const [expandedRole, setExpandedRole] = useState<string | null>(null);

  useEffect(() => {
    if (config?.maxConcurrentAgents != null) {
      setMaxAgents(config.maxConcurrentAgents);
    }
  }, [config?.maxConcurrentAgents]);

  // New role form
  const [showRoleForm, setShowRoleForm] = useState(false);
  const [roleName, setRoleName] = useState('');
  const [roleId, setRoleId] = useState('');
  const [roleDesc, setRoleDesc] = useState('');
  const [rolePrompt, setRolePrompt] = useState('');
  const [roleColor, setRoleColor] = useState('#888888');
  const [roleIcon, setRoleIcon] = useState('🤖');

  const handleMaxAgentsChange = async (value: number) => {
    setMaxAgents(value);
    await api.updateConfig({ maxConcurrentAgents: value });
  };

  const handleCreateRole = async () => {
    if (!roleId || !roleName) return;
    await api.createRole({
      id: roleId,
      name: roleName,
      description: roleDesc,
      systemPrompt: rolePrompt,
      color: roleColor,
      icon: roleIcon,
    });
    setShowRoleForm(false);
    setRoleName('');
    setRoleId('');
    setRoleDesc('');
    setRolePrompt('');
    setRoleColor('#888888');
    setRoleIcon('🤖');
  };

  const themeMode = useSettingsStore((s) => s.themeMode);
  const setThemeMode = useSettingsStore((s) => s.setThemeMode);

  return (
    <div className="flex-1 overflow-auto p-6 max-w-5xl mx-auto">
      <div className="flex items-center gap-3 mb-8">
        <Settings className="w-6 h-6 text-th-text-muted" />
        <h2 className="text-xl font-semibold">Settings</h2>
      </div>

      {/* Appearance & Concurrency row */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        {/* Theme */}
        <section className="bg-surface-raised border border-th-border rounded-lg p-4">
          <h3 className="text-xs font-medium text-th-text-muted uppercase tracking-wider mb-3 flex items-center gap-2">
            <Sun className="w-3.5 h-3.5" /> Appearance
          </h3>
          <div className="flex gap-2">
            {([
              { mode: 'light' as ThemeMode, icon: <Sun size={14} />, label: 'Light' },
              { mode: 'dark' as ThemeMode, icon: <Moon size={14} />, label: 'Dark' },
              { mode: 'system' as ThemeMode, icon: <Monitor size={14} />, label: 'System' },
            ]).map(({ mode, icon, label }) => (
              <button
                key={mode}
                onClick={() => setThemeMode(mode)}
                className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-md text-sm transition-colors ${
                  themeMode === mode
                    ? 'bg-accent text-black font-medium'
                    : 'bg-th-bg-alt text-th-text-muted hover:text-th-text hover:bg-th-bg-muted'
                }`}
              >
                {icon}
                {label}
              </button>
            ))}
          </div>
        </section>

        {/* Concurrency */}
        <section className="bg-surface-raised border border-th-border rounded-lg p-4">
          <h3 className="text-xs font-medium text-th-text-muted uppercase tracking-wider mb-3 flex items-center gap-2">
            <Zap className="w-3.5 h-3.5" /> Concurrency
          </h3>
          <label className="flex items-center justify-between mb-2">
            <span className="text-sm text-th-text-alt">Max concurrent agents</span>
            <span className="text-sm font-mono font-semibold text-accent">{maxAgents}</span>
          </label>
          <input
            type="range"
            min={1}
            max={50}
            value={maxAgents}
            onChange={(e) => handleMaxAgentsChange(Number(e.target.value))}
            disabled={!config}
            className="w-full accent-accent"
          />
          <div className="flex justify-between text-[10px] text-th-text-muted mt-1">
            <span>1</span>
            <span>10</span>
            <span>20</span>
            <span>30</span>
            <span>40</span>
            <span>50</span>
          </div>
        </section>
      </div>

      {/* Sound Notifications */}
      <section className="bg-surface-raised border border-th-border rounded-lg p-4 mb-6">
        <h3 className="text-xs font-medium text-th-text-muted uppercase tracking-wider mb-3 flex items-center gap-2">
          <Volume2 className="w-3.5 h-3.5" /> Sound Notifications
        </h3>
        <label className="flex items-center justify-between cursor-pointer">
          <div>
            <span className="text-sm text-th-text-alt">Enable sound alerts</span>
            <p className="text-xs text-th-text-muted mt-0.5">
              Play a sound when agents request input or all work is complete
            </p>
          </div>
          <button
            onClick={toggleSound}
            className={`relative w-10 h-5 rounded-full transition-colors ${
              soundEnabled ? 'bg-accent' : 'bg-th-bg-hover'
            }`}
          >
            <span
              className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                soundEnabled ? 'translate-x-5' : 'translate-x-0'
              }`}
            />
          </button>
        </label>
      </section>

      {/* CLI Config */}
      <section className="bg-surface-raised border border-th-border rounded-lg p-4 mb-6">
        <h3 className="text-xs font-medium text-th-text-muted uppercase tracking-wider mb-3 flex items-center gap-2">
          <Terminal className="w-3.5 h-3.5" /> CLI Configuration
        </h3>
        <div className="flex items-center gap-3">
          <div className="flex-1">
            <label className="text-xs text-th-text-muted block mb-1">Command</label>
            <code className="text-sm text-th-text-alt bg-th-bg-alt px-3 py-1.5 rounded-md block font-mono">
              {config?.cliCommand || 'copilot'}
            </code>
          </div>
          {config?.cliArgs && config.cliArgs.length > 0 && (
            <div className="flex-1">
              <label className="text-xs text-th-text-muted block mb-1">Arguments</label>
              <code className="text-sm text-th-text-alt bg-th-bg-alt px-3 py-1.5 rounded-md block font-mono truncate">
                {config.cliArgs.join(' ')}
              </code>
            </div>
          )}
        </div>
        <p className="text-xs text-th-text-muted mt-2">
          Set via <code className="text-th-text-muted">COPILOT_CLI_PATH</code> environment variable
        </p>
      </section>

      {/* Dashboard Layout */}
      <DashboardCustomizer />

      {/* Playbooks */}
      <section className="bg-surface-raised border border-th-border rounded-lg p-4 mb-6">
        <PlaybookLibrary />
      </section>

      {/* Intent Rules */}
      <section className="bg-surface-raised border border-th-border rounded-lg p-4 mb-6">
        <IntentRulesDashboard />
      </section>

      {/* Recovery Settings */}
      <section className="bg-surface-raised border border-th-border rounded-lg p-4 mb-6">
        <RecoverySettingsPanel />
      </section>

      {/* Recovery Metrics */}
      <section className="bg-surface-raised border border-th-border rounded-lg p-4 mb-6">
        <RecoveryMetricsCard />
      </section>

      {/* Notification Preferences */}
      <section className="bg-surface-raised border border-th-border rounded-lg p-4 mb-6">
        <NotificationPreferencesPanel />
      </section>

      {/* Notification Activity Log */}
      <section className="bg-surface-raised border border-th-border rounded-lg p-4 mb-6">
        <NotificationActivityLog />
      </section>

      {/* Roles */}
      <section className="mb-8">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-medium text-th-text-muted uppercase tracking-wider flex items-center gap-2">
            <Users className="w-3.5 h-3.5" /> Agent Roles
          </h3>
          <button
            onClick={() => setShowRoleForm(!showRoleForm)}
            className="flex items-center gap-1.5 text-xs text-accent hover:text-accent-muted transition-colors px-2 py-1 rounded hover:bg-th-bg-alt"
          >
            <Plus size={12} />
            Add Custom Role
          </button>
        </div>

        {showRoleForm && (
          <div className="bg-surface-raised border border-accent/30 rounded-lg p-4 mb-4 space-y-3">
            <div className="text-xs font-medium text-accent mb-1">New Custom Role</div>
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="Role ID (e.g. designer)"
                value={roleId}
                onChange={(e) => setRoleId(e.target.value)}
                className="flex-1 bg-th-bg-alt border border-th-border rounded-md px-3 py-1.5 text-sm font-mono focus:outline-none focus:border-accent"
              />
              <input
                type="text"
                placeholder="🤖"
                value={roleIcon}
                onChange={(e) => setRoleIcon(e.target.value)}
                className="w-14 bg-th-bg-alt border border-th-border rounded-md px-2 py-1.5 text-sm text-center focus:outline-none focus:border-accent"
              />
              <input
                type="color"
                value={roleColor}
                onChange={(e) => setRoleColor(e.target.value)}
                className="w-10 h-8 bg-th-bg-alt border border-th-border rounded-md cursor-pointer"
              />
            </div>
            <input
              type="text"
              placeholder="Display name"
              value={roleName}
              onChange={(e) => setRoleName(e.target.value)}
              className="w-full bg-th-bg-alt border border-th-border rounded-md px-3 py-1.5 text-sm focus:outline-none focus:border-accent"
            />
            <input
              type="text"
              placeholder="Short description"
              value={roleDesc}
              onChange={(e) => setRoleDesc(e.target.value)}
              className="w-full bg-th-bg-alt border border-th-border rounded-md px-3 py-1.5 text-sm focus:outline-none focus:border-accent"
            />
            <textarea
              placeholder="System prompt — define the agent's behavior..."
              value={rolePrompt}
              onChange={(e) => setRolePrompt(e.target.value)}
              rows={4}
              className="w-full bg-th-bg-alt border border-th-border rounded-md px-3 py-1.5 text-sm font-mono focus:outline-none focus:border-accent resize-none"
            />
            <div className="flex justify-end gap-2 pt-1">
              <button
                onClick={() => setShowRoleForm(false)}
                className="px-3 py-1.5 text-xs text-th-text-muted hover:text-th-text rounded-md hover:bg-th-bg-muted transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateRole}
                disabled={!roleId || !roleName}
                className="px-4 py-1.5 text-xs bg-accent text-black rounded-md font-semibold disabled:opacity-50 transition-colors hover:bg-accent-muted"
              >
                Create Role
              </button>
            </div>
          </div>
        )}

        <div className="space-y-2">
          {roles.map((role) => {
            const isExpanded = expandedRole === role.id;
            return (
              <div
                key={role.id}
                className="bg-surface-raised border border-th-border rounded-lg overflow-hidden transition-colors hover:border-th-border-hover"
              >
                <div
                  className="flex items-center gap-3 p-3 cursor-pointer"
                  onClick={() => setExpandedRole(isExpanded ? null : role.id)}
                >
                  <span className="text-lg">{role.icon}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-th-text-alt">{role.name}</span>
                      <span
                        className="w-2 h-2 rounded-full shrink-0"
                        style={{ backgroundColor: role.color }}
                      />
                      {role.builtIn && (
                        <span className="text-[10px] text-th-text-muted bg-th-bg-alt px-1.5 py-0.5 rounded">built-in</span>
                      )}
                    </div>
                    <div className="text-xs text-th-text-muted truncate">{role.description}</div>
                  </div>
                  {role.model && (
                    <span className="text-[10px] font-mono text-th-text-muted bg-th-bg-alt px-2 py-0.5 rounded shrink-0 flex items-center gap-1">
                      <Cpu className="w-2.5 h-2.5" />
                      {role.model}
                    </span>
                  )}
                  {!role.builtIn && (
                    <button
                      onClick={(e) => { e.stopPropagation(); api.deleteRole(role.id); }}
                      className="p-1.5 text-th-text-muted hover:text-red-400 rounded hover:bg-th-bg-alt transition-colors"
                    >
                      <Trash2 size={13} />
                    </button>
                  )}
                  {isExpanded
                    ? <ChevronDown className="w-4 h-4 text-th-text-muted shrink-0" />
                    : <ChevronRight className="w-4 h-4 text-th-text-muted shrink-0" />
                  }
                </div>
                {isExpanded && (
                  <div className="border-t border-th-border px-4 py-3 bg-th-bg-alt/30">
                    <label className="text-[10px] font-medium text-th-text-muted uppercase tracking-wider">System Prompt</label>
                    <pre className="text-xs font-mono text-th-text-alt mt-1.5 whitespace-pre-wrap leading-relaxed max-h-60 overflow-y-auto">
                      {role.systemPrompt}
                    </pre>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
