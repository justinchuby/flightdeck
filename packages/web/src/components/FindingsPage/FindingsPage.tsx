/**
 * FindingsPage — ACP capability research results.
 *
 * Displays a comparison matrix of provider capabilities, protocol overview,
 * and analysis of unused ACP features Flightdeck could leverage.
 *
 * IMPORTANT: Capability data is STATIC (from presets/research), not runtime.
 * Flightdeck sends empty clientCapabilities: {} — actual runtime capabilities
 * are captured in AcpAdapter.ts but not surfaced to the UI.
 */
import { getAllProviders, type ProviderDefinition } from '@flightdeck/shared';
import { Check, X, Minus, Info, Zap, Shield, Layers, AlertTriangle, Terminal, Code } from 'lucide-react';

// ── Types ────────────────────────────────────────────────────────

interface ProviderCapabilities {
  id: string;
  name: string;
  icon: string;
  isPreview: boolean;
  /** Static preset — not runtime-verified */
  resume: boolean;
  /** All providers advertise this, but Flightdeck never sends images */
  images: 'advertised';
  /** Protocol field exists, no providers implement */
  audio: 'none';
  /** Protocol available, untapped */
  mcpServers: 'untapped';
  /** Protocol available, untapped */
  embeddedContext: 'untapped';
  systemPromptMethod: string;
  authMethod: string;
  modelSelectionStyle: string;
  modelTiers: string;
  uniqueFeatures: string[];
}

type CapStatus = boolean | 'advertised' | 'none' | 'untapped';

// ── Data ─────────────────────────────────────────────────────────

/** Per-provider research data (from architecture team analysis, March 2026). */
const RESEARCH_DATA: Record<string, {
  systemPromptMethod: string;
  authMethod: string;
  modelSelectionStyle: string;
  modelTiers: string;
  uniqueFeatures: string[];
}> = {
  copilot: {
    systemPromptMethod: '--agent flag + .agent.md',
    authMethod: 'gh auth status (GitHub OAuth)',
    modelSelectionStyle: '--model flag',
    modelTiers: 'haiku, sonnet, opus, gpt-4.1, gemini-pro',
    uniqueFeatures: ['Multi-backend (Anthropic, OpenAI, Google, xAI)', 'Agent file support (--agent)', 'GitHub-managed auth'],
  },
  claude: {
    systemPromptMethod: '_meta.systemPrompt ACP extension',
    authMethod: 'ANTHROPIC_API_KEY env var',
    modelSelectionStyle: '--model flag with alias system',
    modelTiers: 'haiku, sonnet (default), opus',
    uniqueFeatures: ['Model alias system (opus → claude-opus-4.6)', '_meta.systemPrompt extension', 'CLAUDE.md agent file'],
  },
  gemini: {
    systemPromptMethod: 'First user message',
    authMethod: 'GEMINI_API_KEY env var',
    modelSelectionStyle: '--model flag',
    modelTiers: 'flash-lite, flash, gemini-pro',
    uniqueFeatures: ['Google-native models only', 'Agent directory (.gemini/agents/*.md)'],
  },
  codex: {
    systemPromptMethod: 'First user message',
    authMethod: 'OPENAI_API_KEY env var',
    modelSelectionStyle: '-c model=name (config style)',
    modelTiers: 'codex-mini, codex, gpt-5.x',
    uniqueFeatures: ['⚠️ No session resume (only provider)', 'Config-style model args (-c model=name)'],
  },
  cursor: {
    systemPromptMethod: 'First user message',
    authMethod: 'CURSOR_API_KEY env var',
    modelSelectionStyle: 'Not configurable via CLI',
    modelTiers: 'haiku, sonnet, opus (via Cursor backend)',
    uniqueFeatures: ['Multi-backend (Anthropic, OpenAI, Google)', '.cursorrules agent file', 'Model selection managed by Cursor'],
  },
  opencode: {
    systemPromptMethod: 'First user message',
    authMethod: 'Self-managed (provider handles keys)',
    modelSelectionStyle: 'Not configurable via CLI',
    modelTiers: 'anthropic/*, openai/*, google/*, local/*',
    uniqueFeatures: ['Local model support', 'Self-managed authentication', 'Model prefix system (provider/model)'],
  },
};

function buildCapabilities(): ProviderCapabilities[] {
  return getAllProviders().map((p: ProviderDefinition) => {
    const research = RESEARCH_DATA[p.id];
    return {
      id: p.id,
      name: p.name,
      icon: p.icon,
      isPreview: p.isPreview,
      resume: p.supportsResume,
      images: 'advertised' as const,
      audio: 'none' as const,
      mcpServers: 'untapped' as const,
      embeddedContext: 'untapped' as const,
      systemPromptMethod: research?.systemPromptMethod ?? 'Unknown',
      authMethod: research?.authMethod ?? 'Unknown',
      modelSelectionStyle: research?.modelSelectionStyle ?? 'Unknown',
      modelTiers: research?.modelTiers ?? 'Unknown',
      uniqueFeatures: research?.uniqueFeatures ?? [],
    };
  });
}

// ── Components ───────────────────────────────────────────────────

function CapBadge({ status, label }: { status: CapStatus; label?: string }) {
  if (status === 'advertised') {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-yellow-400" title="Providers advertise support, but Flightdeck does not use this capability">
        <Minus className="w-3.5 h-3.5" />
        {label}
      </span>
    );
  }
  if (status === 'untapped') {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-th-text-muted/50" title="Protocol supports this, but not implemented">
        <Minus className="w-3.5 h-3.5" />
        {label}
      </span>
    );
  }
  if (status === 'none') {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-th-text-muted/50">
        <X className="w-3.5 h-3.5" />
        {label}
      </span>
    );
  }
  return status ? (
    <span className="inline-flex items-center gap-1 text-xs text-green-400">
      <Check className="w-3.5 h-3.5" />
      {label}
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 text-xs text-red-400">
      <X className="w-3.5 h-3.5" />
      {label}
    </span>
  );
}

function SectionCard({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="bg-surface-raised border border-th-border rounded-lg p-4 mb-4">
      <h3 className="text-xs font-medium text-th-text-muted uppercase tracking-wider flex items-center gap-2 mb-3">
        {icon} {title}
      </h3>
      {children}
    </section>
  );
}

function CapabilityMatrix({ capabilities }: { capabilities: ProviderCapabilities[] }) {
  return (
    <div className="overflow-x-auto">
      <div className="mb-2 flex items-center gap-2 text-[10px] text-yellow-400">
        <AlertTriangle className="w-3 h-3" />
        <span>Static config — not runtime-verified. Flightdeck sends empty clientCapabilities.</span>
      </div>
      <table className="w-full text-xs" data-testid="capability-matrix">
        <thead>
          <tr className="border-b border-th-border">
            <th className="text-left py-2 pr-3 text-th-text-muted font-medium">Provider</th>
            <th className="text-center py-2 px-2 text-th-text-muted font-medium">Resume</th>
            <th className="text-center py-2 px-2 text-th-text-muted font-medium">Images</th>
            <th className="text-center py-2 px-2 text-th-text-muted font-medium">Audio</th>
            <th className="text-center py-2 px-2 text-th-text-muted font-medium">MCP</th>
            <th className="text-center py-2 px-2 text-th-text-muted font-medium">Embedded Ctx</th>
            <th className="text-left py-2 pl-3 text-th-text-muted font-medium">System Prompt</th>
          </tr>
        </thead>
        <tbody>
          {capabilities.map((cap) => (
            <tr key={cap.id} className="border-b border-th-border/50 hover:bg-th-bg-alt/30 transition-colors">
              <td className="py-2 pr-3">
                <span className="flex items-center gap-2">
                  <span>{cap.icon}</span>
                  <span className="text-th-text-alt font-medium">{cap.name}</span>
                  {cap.isPreview && (
                    <span className="text-[9px] text-blue-400 bg-blue-500/10 px-1 py-0.5 rounded-full">Preview</span>
                  )}
                </span>
              </td>
              <td className="text-center py-2 px-2"><CapBadge status={cap.resume} /></td>
              <td className="text-center py-2 px-2"><CapBadge status={cap.images} /></td>
              <td className="text-center py-2 px-2"><CapBadge status={cap.audio} /></td>
              <td className="text-center py-2 px-2"><CapBadge status={cap.mcpServers} /></td>
              <td className="text-center py-2 px-2"><CapBadge status={cap.embeddedContext} /></td>
              <td className="py-2 pl-3 text-th-text-muted font-mono text-[10px]">{cap.systemPromptMethod}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-2 flex flex-wrap gap-3 text-[10px] text-th-text-muted">
        <span className="flex items-center gap-1"><Check className="w-3 h-3 text-green-400" /> Supported</span>
        <span className="flex items-center gap-1"><X className="w-3 h-3 text-red-400" /> Not supported</span>
        <span className="flex items-center gap-1"><Minus className="w-3 h-3 text-yellow-400" /> Advertised but unused</span>
        <span className="flex items-center gap-1"><Minus className="w-3 h-3 text-th-text-muted/50" /> Protocol available, untapped</span>
      </div>
    </div>
  );
}

function ProviderDetailsTable({ capabilities }: { capabilities: ProviderCapabilities[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs" data-testid="provider-details-table">
        <thead>
          <tr className="border-b border-th-border">
            <th className="text-left py-2 pr-3 text-th-text-muted font-medium">Provider</th>
            <th className="text-left py-2 px-2 text-th-text-muted font-medium">Auth Method</th>
            <th className="text-left py-2 px-2 text-th-text-muted font-medium">Model Selection</th>
            <th className="text-left py-2 px-2 text-th-text-muted font-medium">Model Tiers</th>
          </tr>
        </thead>
        <tbody>
          {capabilities.map((cap) => (
            <tr key={cap.id} className="border-b border-th-border/50">
              <td className="py-2 pr-3">
                <span className="flex items-center gap-2">
                  <span>{cap.icon}</span>
                  <span className="text-th-text-alt font-medium">{cap.name}</span>
                  {cap.isPreview && (
                    <span className="text-[9px] text-blue-400 bg-blue-500/10 px-1 py-0.5 rounded-full">Preview</span>
                  )}
                </span>
              </td>
              <td className="py-2 px-2 text-th-text-muted font-mono text-[10px]">{cap.authMethod}</td>
              <td className="py-2 px-2 text-th-text-muted font-mono text-[10px]">{cap.modelSelectionStyle}</td>
              <td className="py-2 px-2">
                <div className="flex flex-wrap gap-1">
                  {cap.modelTiers.split(', ').map((tier) => (
                    <span key={tier} className="inline-block bg-th-bg-alt border border-th-border rounded px-1.5 py-0.5 text-th-text-alt font-mono text-[10px]">
                      {tier}
                    </span>
                  ))}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function UniqueFeatures({ capabilities }: { capabilities: ProviderCapabilities[] }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {capabilities.map((cap) => (
        <div key={cap.id} className="bg-th-bg-alt border border-th-border rounded-md p-3">
          <div className="flex items-center gap-2 mb-2">
            <span>{cap.icon}</span>
            <span className="text-xs text-th-text font-medium">{cap.name}</span>
            {cap.isPreview && (
              <span className="text-[9px] text-blue-400 bg-blue-500/10 px-1 py-0.5 rounded-full">Preview</span>
            )}
          </div>
          <ul className="text-[11px] text-th-text-muted space-y-1">
            {cap.uniqueFeatures.map((feat) => (
              <li key={feat} className="flex items-start gap-1.5">
                <span className="text-accent mt-0.5 shrink-0">•</span>
                <span>{feat}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

// ── Main Page ────────────────────────────────────────────────────

export function FindingsPage() {
  const capabilities = buildCapabilities();

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-2" data-testid="findings-page">
      <div className="mb-6">
        <h2 className="text-lg font-semibold text-th-text">ACP Capability Research</h2>
        <p className="text-xs text-th-text-muted mt-1">
          Analysis of Agent Client Protocol capabilities across Flightdeck&apos;s 6 provider adapters.
          Research conducted March 19, 2026.
        </p>
      </div>

      {/* Protocol Overview */}
      <SectionCard title="Protocol Overview" icon={<Info className="w-3.5 h-3.5" />}>
        <div className="text-xs text-th-text-alt space-y-2">
          <p>
            The <strong>Agent Client Protocol (ACP)</strong> is a standard interface for communicating
            with AI coding agents. Flightdeck orchestrates multiple ACP-compatible CLI tools
            as a multi-agent crew, routing tasks and coordinating output via JSON-RPC over stdio.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-3">
            <div className="bg-th-bg-alt border border-th-border rounded-md p-3">
              <div className="text-th-text font-medium mb-1">6 Adapters</div>
              <div className="text-th-text-muted">Copilot, Claude, Gemini, Codex + Cursor, OpenCode (preview)</div>
            </div>
            <div className="bg-th-bg-alt border border-th-border rounded-md p-3">
              <div className="text-th-text font-medium mb-1">stdio Transport</div>
              <div className="text-th-text-muted">All providers use JSON-RPC over stdin/stdout</div>
            </div>
            <div className="bg-th-bg-alt border border-th-border rounded-md p-3">
              <div className="text-th-text font-medium mb-1">Session Resume</div>
              <div className="text-th-text-muted">5 of 6 support loadSession (Codex is the exception)</div>
            </div>
          </div>
        </div>
      </SectionCard>

      {/* Critical Gap */}
      <SectionCard title="Critical Gap: Static vs Runtime" icon={<AlertTriangle className="w-3.5 h-3.5 text-yellow-400" />}>
        <div className="bg-yellow-400/5 border border-yellow-400/20 rounded-md p-3 text-xs text-th-text-alt space-y-2">
          <p>
            <strong className="text-yellow-400">Flightdeck sends empty <code className="text-yellow-300">clientCapabilities: {'{}'}</code></strong> — it
            does not advertise its own capabilities (filesystem access, terminal, etc.) to providers.
          </p>
          <p>
            Only <code className="text-accent">supportsImages</code> is consumed from agent responses. The
            <code className="text-accent"> supportsResume</code> shown below is <em>static config</em> from presets,
            not a runtime capability check. Fields like <code className="text-accent">audio</code>,
            <code className="text-accent"> embeddedContext</code>, <code className="text-accent">mcpCapabilities</code>,
            and <code className="text-accent">sessionCapabilities</code> are captured in AcpAdapter.ts but never consumed.
          </p>
        </div>
      </SectionCard>

      {/* Capability Matrix */}
      <SectionCard title="Capability Comparison" icon={<Layers className="w-3.5 h-3.5" />}>
        <CapabilityMatrix capabilities={capabilities} />
      </SectionCard>

      {/* Provider Details */}
      <SectionCard title="Provider Details" icon={<Terminal className="w-3.5 h-3.5" />}>
        <ProviderDetailsTable capabilities={capabilities} />
      </SectionCard>

      {/* Per-Provider Unique Features */}
      <SectionCard title="Per-Provider Features" icon={<Zap className="w-3.5 h-3.5" />}>
        <UniqueFeatures capabilities={capabilities} />
      </SectionCard>

      {/* ACP SDK Types */}
      <SectionCard title="ACP SDK Type Definitions" icon={<Code className="w-3.5 h-3.5" />}>
        <div className="bg-th-bg-alt border border-th-border rounded-md p-3 font-mono text-[11px] text-th-text-alt overflow-x-auto whitespace-pre">
{`interface AgentCapabilities {
  promptCapabilities?: {
    image?: boolean;    // All providers: true
  };
  audio?: boolean;      // No providers implement
  loadSession?: boolean; // 5/6 providers: true (not Codex)
  mcpServers?: boolean;  // Protocol available, untapped
  embeddedContext?: boolean; // Protocol available, untapped
}`}
        </div>
        <p className="text-[10px] text-th-text-muted mt-2">
          From <code className="text-accent">@agentclientprotocol/sdk</code> — captured in AcpAdapter.ts on session init.
        </p>
      </SectionCard>

      {/* Recommendations */}
      <SectionCard title="Recommendations" icon={<Shield className="w-3.5 h-3.5" />}>
        <div className="space-y-3">
          {[
            {
              title: '1. Advertise Client Capabilities',
              description: 'Send fs+terminal in clientCapabilities to unlock richer agent behavior. Providers can tailor responses when they know the client supports file operations and shell execution.',
              priority: 'High',
            },
            {
              title: '2. Surface Runtime Capabilities',
              description: 'AcpAdapter.ts already captures agentCapabilities on session init. Surface these to the UI so operators can see what each running agent actually supports, not just static presets.',
              priority: 'Medium',
            },
            {
              title: '3. Leverage MCP Server Passthrough',
              description: 'The ACP protocol supports passing MCP server configurations to agents. This could enable agents to use external tools (databases, APIs, custom services) beyond their built-in capabilities.',
              priority: 'Medium',
            },
            {
              title: '4. Image Content Support',
              description: 'All 6 providers advertise supportsImages:true but Flightdeck never sends image content. Adding screenshot/diagram sharing would leverage existing provider capabilities.',
              priority: 'Low',
            },
            {
              title: '5. Fix Codex Resume Gap',
              description: 'Codex is the only provider without session resume. Consider a compatibility shim that replays context on reconnection, or document this as a known limitation.',
              priority: 'Low',
            },
          ].map((item) => (
            <div key={item.title} className="bg-th-bg-alt border border-th-border rounded-md p-3">
              <div className="flex items-center justify-between">
                <span className="text-xs text-th-text font-medium">{item.title}</span>
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                  item.priority === 'High' ? 'text-red-400 bg-red-400/10' :
                  item.priority === 'Medium' ? 'text-yellow-400 bg-yellow-400/10' :
                  'text-th-text-muted bg-th-bg-muted'
                }`}>
                  {item.priority}
                </span>
              </div>
              <p className="text-[11px] text-th-text-muted mt-1">{item.description}</p>
            </div>
          ))}
        </div>
      </SectionCard>

      {/* Key Findings */}
      <SectionCard title="Key Findings" icon={<Info className="w-3.5 h-3.5" />}>
        <ul className="text-xs text-th-text-alt space-y-1.5 list-disc list-inside">
          <li>Only <code className="text-accent">supportsImages</code> is consumed from agent responses; other capability fields are captured but unused</li>
          <li><strong>Codex</strong> is the only provider that does NOT support session resume — all others support <code className="text-accent">loadSession</code></li>
          <li>System prompt delivery varies: Claude uses <code className="text-accent">_meta.systemPrompt</code> extension, Copilot uses <code className="text-accent">--agent</code> flag, others use first user message</li>
          <li>Model selection style differs: flag-based (Copilot, Claude, Gemini), config-based (Codex <code className="text-accent">-c model=</code>), or not configurable (Cursor, OpenCode)</li>
          <li>Copilot is the most versatile — accesses Anthropic, OpenAI, Google, and xAI backends through a single CLI</li>
          <li>OpenCode uniquely supports <strong>local models</strong>, enabling air-gapped or offline operation</li>
          <li>Claude&apos;s model alias system (<code className="text-accent">opus → claude-opus-4.6</code>) requires special mapping in Flightdeck&apos;s model resolver</li>
        </ul>
      </SectionCard>
    </div>
  );
}
