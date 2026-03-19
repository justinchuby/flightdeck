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
import { getAllProviders, getAcpCapabilities, type ProviderDefinition, type AcpProviderCapabilities } from '@flightdeck/shared';
import { Check, X, Minus, Info, Zap, Shield, Layers, AlertTriangle, Terminal, Code } from 'lucide-react';
import { ProviderIcon } from '../ui/ProviderIcon';

// ── Types ────────────────────────────────────────────────────────

interface ProviderCapabilities {
  id: string;
  name: string;
  icon: string;
  iconUrl?: string;
  isPreview: boolean;
  /** Runtime-verified via ACP probe (March 2026) */
  resume: boolean;
  /** Runtime-verified: all 4 probed providers support images */
  images: boolean;
  /** Runtime-verified: only Gemini supports audio */
  audio: boolean | 'not-probed';
  /** Runtime-verified: Claude+Gemini http+sse, Codex http only, Copilot none */
  mcpServers: boolean | 'partial' | 'not-probed';
  /** Runtime-verified: all 4 probed providers support embeddedContext */
  embeddedContext: boolean | 'not-probed';
  systemPromptMethod: string;
  authMethod: string;
  modelSelectionStyle: string;
  modelTiers: string;
  uniqueFeatures: string[];
  /** Version from ACP probe (undefined if not probed) */
  probeVersion?: string;
}

type CapStatus = boolean | 'advertised' | 'none' | 'untapped' | 'partial' | 'not-probed';

// ── Data ─────────────────────────────────────────────────────────

/**
 * Supplemental per-provider metadata not in the shared ACP_CAPABILITIES.
 * Model tiers and unique features are UI-specific display data.
 */
const PROVIDER_DISPLAY_DATA: Record<string, {
  modelSelectionStyle: string;
  modelTiers: string;
  uniqueFeatures: string[];
}> = {
  copilot: {
    modelSelectionStyle: '--model flag',
    modelTiers: 'haiku, sonnet, opus, gpt-4.1, gemini-pro',
    uniqueFeatures: ['Multi-backend (Anthropic, OpenAI, Google, xAI)', 'Agent file support (--agent)', 'GitHub-managed auth'],
  },
  claude: {
    modelSelectionStyle: '--model flag with alias system',
    modelTiers: 'haiku, sonnet (default), opus',
    uniqueFeatures: ['Model alias system (opus → claude-opus-4.6)', '_meta.systemPrompt extension', 'CLAUDE.md agent file', 'promptQueueing support'],
  },
  gemini: {
    modelSelectionStyle: '--model flag',
    modelTiers: 'flash-lite, flash, gemini-pro',
    uniqueFeatures: ['Google-native models only', 'Agent directory (.gemini/agents/*.md)', 'Audio input support', '4 auth methods (OAuth, API key, Vertex AI, Gateway)'],
  },
  codex: {
    modelSelectionStyle: '-c model=name (config style)',
    modelTiers: 'codex-mini, codex, gpt-5.x',
    uniqueFeatures: ['Config-style model args (-c model=name)', '3 auth methods (ChatGPT login, CODEX_API_KEY, OPENAI_API_KEY)'],
  },
  cursor: {
    modelSelectionStyle: 'Not configurable via CLI',
    modelTiers: 'haiku, sonnet, opus (via Cursor backend)',
    uniqueFeatures: ['Multi-backend (Anthropic, OpenAI, Google)', '.cursorrules agent file', 'Model selection managed by Cursor'],
  },
  opencode: {
    modelSelectionStyle: 'Not configurable via CLI',
    modelTiers: 'anthropic/*, openai/*, google/*, local/*',
    uniqueFeatures: ['Local model support', 'Self-managed authentication', 'Model prefix system (provider/model)'],
  },
  kimi: {
    modelSelectionStyle: '--model flag',
    modelTiers: 'moonshot-v1-8k, kimi-latest',
    uniqueFeatures: ['Moonshot AI models', 'Session list + resume', 'MCP HTTP support', 'Terminal-based login'],
  },
  'qwen-code': {
    modelSelectionStyle: '--model flag',
    modelTiers: 'qwen-coder-plus-latest',
    uniqueFeatures: ['Audio input support', 'Qwen OAuth (free daily requests)', 'OpenAI API key fallback', 'Session list + resume'],
  },
};

function buildCapabilities(): ProviderCapabilities[] {
  return getAllProviders().map((p: ProviderDefinition) => {
    const caps = getAcpCapabilities(p.id);
    const display = PROVIDER_DISPLAY_DATA[p.id];
    const hasMcp = caps ? (caps.mcpHttp && caps.mcpSse ? true : caps.mcpHttp ? ('partial' as const) : false) : ('not-probed' as const);
    return {
      id: p.id,
      name: p.name,
      icon: p.icon,
      iconUrl: p.iconUrl,
      isPreview: p.isPreview,
      resume: p.supportsResume,
      images: caps?.images ?? false,
      audio: caps?.probed ? caps.audio : ('not-probed' as const),
      mcpServers: hasMcp,
      embeddedContext: caps?.probed ? caps.embeddedContext : ('not-probed' as const),
      systemPromptMethod: caps?.systemPromptMethod ?? 'Unknown',
      authMethod: caps?.authMethod ?? 'Unknown',
      modelSelectionStyle: display?.modelSelectionStyle ?? 'Unknown',
      modelTiers: display?.modelTiers ?? 'Unknown',
      uniqueFeatures: display?.uniqueFeatures ?? [],
      probeVersion: caps?.probeVersion,
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
  if (status === 'untapped' || status === 'not-probed') {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-th-text-muted/50" title={status === 'not-probed' ? 'Provider not installed — not probed' : 'Protocol supports this, but not implemented'}>
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
  if (status === 'partial') {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-yellow-400" title="Partial support (e.g., HTTP only, no SSE)">
        <Minus className="w-3.5 h-3.5" />
        {label ?? 'Partial'}
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
      <div className="mb-2 flex items-center gap-2 text-[10px] text-green-400">
        <Check className="w-3 h-3" />
        <span>Verified via live ACP probe (March 2026). Resume column uses preset config; all others from runtime handshake.</span>
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
                  <ProviderIcon provider={cap} className="w-4 h-4" />
                  <span className="text-th-text-alt font-medium">{cap.name}</span>
                  {cap.probeVersion && (
                    <span className="text-[9px] text-th-text-muted font-mono">v{cap.probeVersion}</span>
                  )}
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
        <span className="flex items-center gap-1"><Minus className="w-3 h-3 text-yellow-400" /> Partial (e.g., HTTP only)</span>
        <span className="flex items-center gap-1"><Minus className="w-3 h-3 text-th-text-muted/50" /> Not probed (binary not installed)</span>
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
                  <ProviderIcon provider={cap} className="w-4 h-4" />
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
            <ProviderIcon provider={cap} className="w-4 h-4" />
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
          Analysis of Agent Client Protocol capabilities across Flightdeck&apos;s 8 provider adapters.
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
              <div className="text-th-text font-medium mb-1">8 Adapters</div>
              <div className="text-th-text-muted">Copilot, Claude, Gemini, Codex, Kimi, Qwen Code + Cursor, OpenCode (preview)</div>
            </div>
            <div className="bg-th-bg-alt border border-th-border rounded-md p-3">
              <div className="text-th-text font-medium mb-1">stdio Transport</div>
              <div className="text-th-text-muted">All providers use JSON-RPC over stdin/stdout</div>
            </div>
            <div className="bg-th-bg-alt border border-th-border rounded-md p-3">
              <div className="text-th-text font-medium mb-1">Session Resume</div>
              <div className="text-th-text-muted">Only Claude has full resume+fork. Copilot/Codex have list only. Gemini has none.</div>
            </div>
          </div>
        </div>
      </SectionCard>

      {/* Critical Gap */}
      <SectionCard title="Gap: Unused Capabilities" icon={<AlertTriangle className="w-3.5 h-3.5 text-yellow-400" />}>
        <div className="bg-yellow-400/5 border border-yellow-400/20 rounded-md p-3 text-xs text-th-text-alt space-y-2">
          <p>
            <strong className="text-yellow-400">Flightdeck sends empty <code className="text-yellow-300">clientCapabilities: {'{}'}</code></strong> — it
            does not advertise its own capabilities (filesystem access, terminal, etc.) to providers.
          </p>
          <p>
            The capability matrix above now uses <strong>live probe data</strong> from the ACP initialize handshake.
            Fields like <code className="text-accent">audio</code>,
            <code className="text-accent"> embeddedContext</code>, <code className="text-accent">mcpCapabilities</code>,
            and <code className="text-accent">sessionCapabilities</code> are captured by AcpAdapter.ts but not yet consumed by Flightdeck.
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
{`// Verified via live ACP probe — actual agentCapabilities responses
interface AgentCapabilities {
  loadSession?: boolean;        // All 4 probed: true
  promptCapabilities?: {
    image?: boolean;            // All 4: true
    audio?: boolean;            // Only Gemini: true
    embeddedContext?: boolean;   // All 4: true
  };
  sessionCapabilities?: {       // Claude: fork+list+resume, Copilot/Codex: list only, Gemini: absent
    list?: {};
    resume?: {};
    fork?: {};
  };
  mcpCapabilities?: {           // Claude+Gemini: http+sse, Codex: http only, Copilot: absent
    http?: boolean;
    sse?: boolean;
  };
  _meta?: Record<string, unknown>; // Claude: { claudeCode: { promptQueueing: true } }
}`}
        </div>
        <p className="text-[10px] text-th-text-muted mt-2">
          From <code className="text-accent">@agentclientprotocol/sdk v0.16.1</code> — verified by running{' '}
          <code className="text-accent">scripts/query-acp-capabilities.ts</code> against installed providers.
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
              description: 'All 8 providers advertise supportsImages:true but Flightdeck never sends image content. Adding screenshot/diagram sharing would leverage existing provider capabilities.',
              priority: 'Low',
            },
            {
              title: '5. Fix Resume Gaps',
              description: 'Both Gemini and Codex lack session resume. Consider a compatibility shim that replays context on reconnection, or document this as a known limitation for these providers.',
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
          <li><strong>Gemini does NOT support session resume</strong> — no sessionCapabilities at all (preset was incorrectly set to true, now fixed)</li>
          <li><strong>Claude</strong> is the only provider with full session management (fork + list + resume) and unique <code className="text-accent">promptQueueing</code> support</li>
          <li><strong>Gemini</strong> is the only provider supporting <code className="text-accent">audio</code> input</li>
          <li>All 4 probed providers support <code className="text-accent">loadSession</code>, <code className="text-accent">images</code>, and <code className="text-accent">embeddedContext</code></li>
          <li>MCP support varies: Claude+Gemini have HTTP+SSE, Codex has HTTP only, Copilot has none</li>
          <li>System prompt delivery varies: Claude uses <code className="text-accent">_meta.systemPrompt</code> extension, Copilot uses <code className="text-accent">--agent</code> flag, others use first user message</li>
          <li>Model selection style differs: flag-based (Copilot, Claude, Gemini), config-based (Codex <code className="text-accent">-c model=</code>), or not configurable (Cursor, OpenCode)</li>
          <li>Copilot is the most versatile — accesses Anthropic, OpenAI, Google, and xAI backends through a single CLI</li>
          <li>OpenCode uniquely supports <strong>local models</strong>, enabling air-gapped or offline operation</li>
        </ul>
      </SectionCard>
    </div>
  );
}
