/**
 * CapabilityInjector — Dynamic Role Morphing system.
 *
 * Lets agents acquire additional capabilities on-demand without changing
 * their core role. Each capability injects extra instructions and optionally
 * unlocks gated commands (e.g. DELEGATE, COMMIT).
 */
import type { Agent } from '../Agent.js';
import type { ActivityLedger } from '../../coordination/activity/ActivityLedger.js';
import { logger } from '../../utils/logger.js';
import { shortAgentId } from '@flightdeck/shared';

// ── Capability definition ────────────────────────────────────────────

export interface CapabilityDefinition {
  id: string;
  name: string;
  description: string;
  instructions: string;
  gatedCommands?: string[];
}

// ── Built-in capabilities ────────────────────────────────────────────

const CAPABILITIES: Record<string, CapabilityDefinition> = {
  'code-review': {
    id: 'code-review',
    name: 'Code Review',
    description: 'Review code for correctness, security, and performance',
    instructions: `You have acquired CODE REVIEW capability. When reviewing:
- Focus on correctness, security, and performance — not style
- Be specific: cite file, line, and exact problem
- Suggest fixes, don't just point out problems`,
    gatedCommands: [],
  },
  'architecture': {
    id: 'architecture',
    name: 'Architecture',
    description: 'System design and high-level technical decisions',
    instructions: `You have acquired ARCHITECTURE capability. Consider:
- System-level impacts of changes
- Interface contracts between modules
- Performance implications at scale
- Backward compatibility`,
  },
  'delegation': {
    id: 'delegation',
    name: 'Delegation',
    description: 'Create and delegate to other agents',
    instructions: `You can now delegate tasks to other agents.
Use CREATE_AGENT and DELEGATE to assign work.
Use QUERY_CREW to check available agents first.`,
    gatedCommands: ['DELEGATE', 'CREATE_AGENT'],
  },
  'testing': {
    id: 'testing',
    name: 'Testing',
    description: 'Write and run automated tests',
    instructions: `You have acquired TESTING capability. When writing tests:
- Co-locate tests with the code they test (__tests__/ directory)
- Test behavior, not implementation details
- Include edge cases and error paths
- Use the existing vitest infrastructure`,
  },
  'devops': {
    id: 'devops',
    name: 'DevOps',
    description: 'CI/CD, deployment, and infrastructure',
    instructions: `You have acquired DEVOPS capability:
- Use COMMIT to commit verified changes
- Run builds before committing (npm run build)
- Check test results before pushing
- Use PROGRESS to report deployment status`,
    gatedCommands: ['COMMIT'],
  },
};

// ── CapabilityInjector ───────────────────────────────────────────────

export class CapabilityInjector {
  private agentCapabilities: Map<string, Set<string>> = new Map();

  getCapabilityDef(id: string): CapabilityDefinition | undefined {
    return CAPABILITIES[id];
  }

  getAllDefinitions(): CapabilityDefinition[] {
    return Object.values(CAPABILITIES);
  }

  acquire(
    agent: Agent,
    capabilityId: string,
    reason: string,
    activityLedger: ActivityLedger,
  ): { ok: boolean; message: string } {
    const cap = CAPABILITIES[capabilityId];
    if (!cap) {
      return {
        ok: false,
        message: `Unknown capability: "${capabilityId}". Available: ${Object.keys(CAPABILITIES).join(', ')}`,
      };
    }

    // Track per-agent capabilities
    if (!this.agentCapabilities.has(agent.id)) {
      this.agentCapabilities.set(agent.id, new Set());
    }
    const agentCaps = this.agentCapabilities.get(agent.id)!;

    if (agentCaps.has(capabilityId)) {
      return { ok: false, message: `You already have "${cap.name}" capability.` };
    }

    agentCaps.add(capabilityId);

    // Log to activity ledger
    activityLedger.log(
      agent.id,
      agent.role.id,
      'status_change',
      `Acquired "${cap.name}" capability: ${reason}`,
      { capability: capabilityId, reason },
      agent.projectId ?? '',
    );

    logger.info(
      'capability',
      `Agent ${shortAgentId(agent.id)} (${agent.role.id}) acquired "${cap.name}": ${reason}`,
    );

    const message = `✅ Capability acquired: **${cap.name}**\nReason: ${reason}\n\n== ADDITIONAL INSTRUCTIONS ==\n${cap.instructions}\n== END ==`;
    return { ok: true, message };
  }

  /** Check if an agent has a specific capability (via acquisition) */
  hasCapability(agentId: string, capabilityId: string): boolean {
    return this.agentCapabilities.get(agentId)?.has(capabilityId) ?? false;
  }

  /** Check if an agent has access to a gated command (via any acquired capability) */
  hasCommand(agentId: string, commandName: string): boolean {
    const caps = this.agentCapabilities.get(agentId);
    if (!caps) return false;
    for (const capId of caps) {
      const cap = CAPABILITIES[capId];
      if (cap?.gatedCommands?.includes(commandName)) return true;
    }
    return false;
  }

  /** Get all capabilities for an agent */
  getAgentCapabilities(agentId: string): string[] {
    return [...(this.agentCapabilities.get(agentId) ?? [])];
  }

  /** Clean up on agent termination */
  clearAgent(agentId: string): void {
    this.agentCapabilities.delete(agentId);
  }
}
