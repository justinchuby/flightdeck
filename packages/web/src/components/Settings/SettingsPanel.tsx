import { useState, useEffect } from 'react';
import { useAppStore } from '../../stores/appStore';
import { Trash2, Plus, Sun, Moon, Settings, Cpu, Users, Terminal, ChevronDown, ChevronRight, Zap } from 'lucide-react';

interface Props {
  api: any;
}

export function SettingsPanel({ api }: Props) {
  const { config, roles } = useAppStore();
  const [maxAgents, setMaxAgents] = useState(config?.maxConcurrentAgents || 5);
  const [expandedRole, setExpandedRole] = useState<string | null>(null);

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

  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    return (localStorage.getItem('theme') as 'dark' | 'light') || 'dark';
  });

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    document.documentElement.classList.toggle('light', theme === 'light');
    localStorage.setItem('theme', theme);
  }, [theme]);

  return (
    <div className="flex-1 overflow-auto p-6 max-w-3xl mx-auto">
      <div className="flex items-center gap-3 mb-8">
        <Settings className="w-6 h-6 text-gray-400" />
        <h2 className="text-xl font-semibold">Settings</h2>
      </div>

      {/* Appearance & Concurrency row */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        {/* Theme */}
        <section className="bg-surface-raised border border-gray-700 rounded-lg p-4">
          <h3 className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-3 flex items-center gap-2">
            <Sun className="w-3.5 h-3.5" /> Appearance
          </h3>
          <div className="flex gap-2">
            <button
              onClick={() => setTheme('light')}
              className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-md text-sm transition-colors ${
                theme === 'light'
                  ? 'bg-accent text-black font-medium'
                  : 'bg-gray-800 text-gray-400 hover:text-white hover:bg-gray-700'
              }`}
            >
              <Sun size={14} />
              Light
            </button>
            <button
              onClick={() => setTheme('dark')}
              className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-md text-sm transition-colors ${
                theme === 'dark'
                  ? 'bg-accent text-black font-medium'
                  : 'bg-gray-800 text-gray-400 hover:text-white hover:bg-gray-700'
              }`}
            >
              <Moon size={14} />
              Dark
            </button>
          </div>
        </section>

        {/* Concurrency */}
        <section className="bg-surface-raised border border-gray-700 rounded-lg p-4">
          <h3 className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-3 flex items-center gap-2">
            <Zap className="w-3.5 h-3.5" /> Concurrency
          </h3>
          <label className="flex items-center justify-between mb-2">
            <span className="text-sm text-gray-300">Max concurrent agents</span>
            <span className="text-sm font-mono font-semibold text-accent">{maxAgents}</span>
          </label>
          <input
            type="range"
            min={1}
            max={20}
            value={maxAgents}
            onChange={(e) => handleMaxAgentsChange(Number(e.target.value))}
            className="w-full accent-accent"
          />
          <div className="flex justify-between text-[10px] text-gray-600 mt-1">
            <span>1</span>
            <span>5</span>
            <span>10</span>
            <span>15</span>
            <span>20</span>
          </div>
        </section>
      </div>

      {/* CLI Config */}
      <section className="bg-surface-raised border border-gray-700 rounded-lg p-4 mb-6">
        <h3 className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-3 flex items-center gap-2">
          <Terminal className="w-3.5 h-3.5" /> CLI Configuration
        </h3>
        <div className="flex items-center gap-3">
          <div className="flex-1">
            <label className="text-xs text-gray-500 block mb-1">Command</label>
            <code className="text-sm text-gray-200 bg-gray-800 px-3 py-1.5 rounded-md block font-mono">
              {config?.cliCommand || 'copilot'}
            </code>
          </div>
          {config?.cliArgs && config.cliArgs.length > 0 && (
            <div className="flex-1">
              <label className="text-xs text-gray-500 block mb-1">Arguments</label>
              <code className="text-sm text-gray-200 bg-gray-800 px-3 py-1.5 rounded-md block font-mono truncate">
                {config.cliArgs.join(' ')}
              </code>
            </div>
          )}
        </div>
        <p className="text-xs text-gray-600 mt-2">
          Set via <code className="text-gray-400">COPILOT_CLI_PATH</code> environment variable
        </p>
      </section>

      {/* Roles */}
      <section className="mb-8">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-medium text-gray-400 uppercase tracking-wider flex items-center gap-2">
            <Users className="w-3.5 h-3.5" /> Agent Roles
          </h3>
          <button
            onClick={() => setShowRoleForm(!showRoleForm)}
            className="flex items-center gap-1.5 text-xs text-accent hover:text-accent-muted transition-colors px-2 py-1 rounded hover:bg-gray-800"
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
                className="flex-1 bg-gray-800 border border-gray-700 rounded-md px-3 py-1.5 text-sm font-mono focus:outline-none focus:border-accent"
              />
              <input
                type="text"
                placeholder="🤖"
                value={roleIcon}
                onChange={(e) => setRoleIcon(e.target.value)}
                className="w-14 bg-gray-800 border border-gray-700 rounded-md px-2 py-1.5 text-sm text-center focus:outline-none focus:border-accent"
              />
              <input
                type="color"
                value={roleColor}
                onChange={(e) => setRoleColor(e.target.value)}
                className="w-10 h-8 bg-gray-800 border border-gray-700 rounded-md cursor-pointer"
              />
            </div>
            <input
              type="text"
              placeholder="Display name"
              value={roleName}
              onChange={(e) => setRoleName(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:border-accent"
            />
            <input
              type="text"
              placeholder="Short description"
              value={roleDesc}
              onChange={(e) => setRoleDesc(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:border-accent"
            />
            <textarea
              placeholder="System prompt — define the agent's behavior..."
              value={rolePrompt}
              onChange={(e) => setRolePrompt(e.target.value)}
              rows={4}
              className="w-full bg-gray-800 border border-gray-700 rounded-md px-3 py-1.5 text-sm font-mono focus:outline-none focus:border-accent resize-none"
            />
            <div className="flex justify-end gap-2 pt-1">
              <button
                onClick={() => setShowRoleForm(false)}
                className="px-3 py-1.5 text-xs text-gray-400 hover:text-white rounded-md hover:bg-gray-700 transition-colors"
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
                className="bg-surface-raised border border-gray-700 rounded-lg overflow-hidden transition-colors hover:border-gray-600"
              >
                <div
                  className="flex items-center gap-3 p-3 cursor-pointer"
                  onClick={() => setExpandedRole(isExpanded ? null : role.id)}
                >
                  <span className="text-lg">{role.icon}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-gray-200">{role.name}</span>
                      <span
                        className="w-2 h-2 rounded-full shrink-0"
                        style={{ backgroundColor: role.color }}
                      />
                      {role.builtIn && (
                        <span className="text-[10px] text-gray-600 bg-gray-800 px-1.5 py-0.5 rounded">built-in</span>
                      )}
                    </div>
                    <div className="text-xs text-gray-500 truncate">{role.description}</div>
                  </div>
                  {role.model && (
                    <span className="text-[10px] font-mono text-gray-500 bg-gray-800 px-2 py-0.5 rounded shrink-0 flex items-center gap-1">
                      <Cpu className="w-2.5 h-2.5" />
                      {role.model}
                    </span>
                  )}
                  {!role.builtIn && (
                    <button
                      onClick={(e) => { e.stopPropagation(); api.deleteRole(role.id); }}
                      className="p-1.5 text-gray-500 hover:text-red-400 rounded hover:bg-gray-800 transition-colors"
                    >
                      <Trash2 size={13} />
                    </button>
                  )}
                  {isExpanded
                    ? <ChevronDown className="w-4 h-4 text-gray-500 shrink-0" />
                    : <ChevronRight className="w-4 h-4 text-gray-500 shrink-0" />
                  }
                </div>
                {isExpanded && (
                  <div className="border-t border-gray-700 px-4 py-3 bg-gray-800/30">
                    <label className="text-[10px] font-medium text-gray-500 uppercase tracking-wider">System Prompt</label>
                    <pre className="text-xs font-mono text-gray-300 mt-1.5 whitespace-pre-wrap leading-relaxed max-h-60 overflow-y-auto">
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
