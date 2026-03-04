import { describe, it, expect } from 'vitest';

// WebSocketServer requires a full HTTP server + ws setup.
// Extract the core filtering logic into standalone functions for focused unit testing.

interface MockClientConnection {
  id: string;
  subscribedAgents: Set<string>;
  subscribedProject: string | null;
  received: any[];
}

/** Mirror of WebSocketServer.broadcastToProject filter logic */
function shouldReceiveBroadcast(
  client: MockClientConnection,
  eventProjectId: string | undefined,
): boolean {
  return !client.subscribedProject || !eventProjectId || client.subscribedProject === eventProjectId;
}

/** Mirror of the agent:data filter (project + agent subscription combined) */
function shouldReceiveAgentData(
  client: MockClientConnection,
  eventProjectId: string | undefined,
  agentId: string,
): boolean {
  const projectMatch = !client.subscribedProject || !eventProjectId || client.subscribedProject === eventProjectId;
  const agentMatch = client.subscribedAgents.has(agentId) || client.subscribedAgents.has('*');
  return projectMatch && agentMatch;
}

// ── Mock helpers ─────────────────────────────────────────────────────

interface MockAgent {
  id: string;
  projectId?: string;
  parentId?: string;
}

/** Mirror of AgentManager.getProjectIdForAgent */
function getProjectIdForAgent(
  agents: Map<string, MockAgent>,
  agentId: string,
): string | undefined {
  const agent = agents.get(agentId);
  if (!agent) return undefined;
  if (agent.projectId) return agent.projectId;
  if (agent.parentId) return getProjectIdForAgent(agents, agent.parentId);
  return undefined;
}

function createClient(overrides: Partial<MockClientConnection> = {}): MockClientConnection {
  return {
    id: 'client-1',
    subscribedAgents: new Set(),
    subscribedProject: null,
    received: [],
    ...overrides,
  };
}

/** Simulate broadcastToProject across multiple clients */
function broadcastToProject(
  clients: MockClientConnection[],
  msg: any,
  eventProjectId: string | undefined,
): void {
  for (const client of clients) {
    if (shouldReceiveBroadcast(client, eventProjectId)) {
      client.received.push(msg);
    }
  }
}

// ── Tests ────────────────────────────────────────────────────────────

describe('WebSocket project scoping', () => {
  describe('shouldReceiveBroadcast (broadcastToProject filter)', () => {
    it('client with no project subscription receives all events', () => {
      const client = createClient({ subscribedProject: null });
      expect(shouldReceiveBroadcast(client, 'proj-a')).toBe(true);
      expect(shouldReceiveBroadcast(client, 'proj-b')).toBe(true);
      expect(shouldReceiveBroadcast(client, undefined)).toBe(true);
    });

    it('client subscribed to project A receives events from project A', () => {
      const client = createClient({ subscribedProject: 'proj-a' });
      expect(shouldReceiveBroadcast(client, 'proj-a')).toBe(true);
    });

    it('client subscribed to project A does NOT receive events from project B', () => {
      const client = createClient({ subscribedProject: 'proj-a' });
      expect(shouldReceiveBroadcast(client, 'proj-b')).toBe(false);
    });

    it('client subscribed to a project receives events with no projectId (global events)', () => {
      const client = createClient({ subscribedProject: 'proj-a' });
      expect(shouldReceiveBroadcast(client, undefined)).toBe(true);
    });

    it('unsubscribed client receives events with no projectId', () => {
      const client = createClient({ subscribedProject: null });
      expect(shouldReceiveBroadcast(client, undefined)).toBe(true);
    });
  });

  describe('shouldReceiveAgentData (combined project + agent filter)', () => {
    it('client subscribed to agent and correct project receives data', () => {
      const client = createClient({
        subscribedProject: 'proj-a',
        subscribedAgents: new Set(['agent-1']),
      });
      expect(shouldReceiveAgentData(client, 'proj-a', 'agent-1')).toBe(true);
    });

    it('client subscribed to agent but wrong project does NOT receive data', () => {
      const client = createClient({
        subscribedProject: 'proj-b',
        subscribedAgents: new Set(['agent-1']),
      });
      expect(shouldReceiveAgentData(client, 'proj-a', 'agent-1')).toBe(false);
    });

    it('client subscribed to wildcard (*) and correct project receives data', () => {
      const client = createClient({
        subscribedProject: 'proj-a',
        subscribedAgents: new Set(['*']),
      });
      expect(shouldReceiveAgentData(client, 'proj-a', 'agent-1')).toBe(true);
    });

    it('client with no project subscription and agent subscription receives data', () => {
      const client = createClient({
        subscribedProject: null,
        subscribedAgents: new Set(['agent-1']),
      });
      expect(shouldReceiveAgentData(client, 'proj-a', 'agent-1')).toBe(true);
    });

    it('client with no agent subscription does NOT receive data regardless of project', () => {
      const client = createClient({
        subscribedProject: 'proj-a',
        subscribedAgents: new Set(),
      });
      expect(shouldReceiveAgentData(client, 'proj-a', 'agent-1')).toBe(false);
    });

    it('client with project sub but unknown event projectId still checks agent sub', () => {
      const client = createClient({
        subscribedProject: 'proj-a',
        subscribedAgents: new Set(['agent-1']),
      });
      // undefined eventProjectId → project filter passes, agent filter must pass too
      expect(shouldReceiveAgentData(client, undefined, 'agent-1')).toBe(true);
      expect(shouldReceiveAgentData(client, undefined, 'agent-2')).toBe(false);
    });
  });

  describe('broadcastToProject simulation with multiple clients', () => {
    it('routes project A events only to project A subscribers', () => {
      const clientA = createClient({ id: 'a', subscribedProject: 'proj-a' });
      const clientB = createClient({ id: 'b', subscribedProject: 'proj-b' });
      const clientAll = createClient({ id: 'all', subscribedProject: null });

      const clients = [clientA, clientB, clientAll];
      broadcastToProject(clients, { type: 'agent:spawned', agent: { id: 'x' } }, 'proj-a');

      expect(clientA.received).toHaveLength(1);
      expect(clientB.received).toHaveLength(0);
      expect(clientAll.received).toHaveLength(1);
    });

    it('routes global events (no projectId) to all clients', () => {
      const clientA = createClient({ id: 'a', subscribedProject: 'proj-a' });
      const clientB = createClient({ id: 'b', subscribedProject: 'proj-b' });

      const clients = [clientA, clientB];
      broadcastToProject(clients, { type: 'system:paused', paused: true }, undefined);

      expect(clientA.received).toHaveLength(1);
      expect(clientB.received).toHaveLength(1);
    });

    it('isolates events between multiple projects', () => {
      const clientA = createClient({ id: 'a', subscribedProject: 'proj-a' });
      const clientB = createClient({ id: 'b', subscribedProject: 'proj-b' });
      const clientC = createClient({ id: 'c', subscribedProject: 'proj-c' });

      const clients = [clientA, clientB, clientC];

      broadcastToProject(clients, { type: 'agent:text', agentId: 'dev-a1' }, 'proj-a');
      broadcastToProject(clients, { type: 'agent:text', agentId: 'dev-b1' }, 'proj-b');
      broadcastToProject(clients, { type: 'dag:updated' }, 'proj-c');

      expect(clientA.received).toHaveLength(1);
      expect(clientA.received[0].agentId).toBe('dev-a1');

      expect(clientB.received).toHaveLength(1);
      expect(clientB.received[0].agentId).toBe('dev-b1');

      expect(clientC.received).toHaveLength(1);
      expect(clientC.received[0].type).toBe('dag:updated');
    });
  });

  describe('project resolution from agent hierarchy', () => {
    it('resolves projectId for events from sub-agents via parent chain', () => {
      const agents = new Map<string, MockAgent>();
      agents.set('lead-a', { id: 'lead-a', projectId: 'proj-a' });
      agents.set('dev-a1', { id: 'dev-a1', parentId: 'lead-a' });

      const projectId = getProjectIdForAgent(agents, 'dev-a1');
      expect(projectId).toBe('proj-a');

      // This projectId would be used in broadcastToProject
      const clientA = createClient({ subscribedProject: 'proj-a' });
      const clientB = createClient({ subscribedProject: 'proj-b' });
      broadcastToProject(
        [clientA, clientB],
        { type: 'agent:status', agentId: 'dev-a1', status: 'running' },
        projectId,
      );

      expect(clientA.received).toHaveLength(1);
      expect(clientB.received).toHaveLength(0);
    });

    it('events from unknown agents (projectId undefined) reach all clients', () => {
      const agents = new Map<string, MockAgent>();
      const projectId = getProjectIdForAgent(agents, 'nonexistent');
      expect(projectId).toBeUndefined();

      const clientA = createClient({ subscribedProject: 'proj-a' });
      const clientB = createClient({ subscribedProject: 'proj-b' });
      broadcastToProject(
        [clientA, clientB],
        { type: 'agent:terminated', agentId: 'nonexistent' },
        projectId,
      );

      // Both receive because projectId is undefined → no filtering
      expect(clientA.received).toHaveLength(1);
      expect(clientB.received).toHaveLength(1);
    });
  });

  describe('subscribe-project behavior', () => {
    it('subscribing to a project filters subsequent events', () => {
      const client = createClient({ subscribedProject: null });

      // Before subscription: receives everything
      expect(shouldReceiveBroadcast(client, 'proj-a')).toBe(true);
      expect(shouldReceiveBroadcast(client, 'proj-b')).toBe(true);

      // Subscribe to project A
      client.subscribedProject = 'proj-a';

      // After subscription: only project A
      expect(shouldReceiveBroadcast(client, 'proj-a')).toBe(true);
      expect(shouldReceiveBroadcast(client, 'proj-b')).toBe(false);
    });

    it('unsubscribing (null) restores all-project visibility', () => {
      const client = createClient({ subscribedProject: 'proj-a' });

      expect(shouldReceiveBroadcast(client, 'proj-b')).toBe(false);

      // Unsubscribe
      client.subscribedProject = null;

      expect(shouldReceiveBroadcast(client, 'proj-b')).toBe(true);
    });

    it('switching projects changes filter immediately', () => {
      const client = createClient({ subscribedProject: 'proj-a' });

      expect(shouldReceiveBroadcast(client, 'proj-a')).toBe(true);
      expect(shouldReceiveBroadcast(client, 'proj-b')).toBe(false);

      // Switch to project B
      client.subscribedProject = 'proj-b';

      expect(shouldReceiveBroadcast(client, 'proj-a')).toBe(false);
      expect(shouldReceiveBroadcast(client, 'proj-b')).toBe(true);
    });
  });

  describe('backward compatibility', () => {
    it('clients that never send subscribe-project see all events', () => {
      const legacyClient = createClient({ subscribedProject: null });
      const modernClient = createClient({ subscribedProject: 'proj-a' });

      const clients = [legacyClient, modernClient];

      broadcastToProject(clients, { type: 'agent:spawned' }, 'proj-a');
      broadcastToProject(clients, { type: 'agent:spawned' }, 'proj-b');

      // Legacy sees all
      expect(legacyClient.received).toHaveLength(2);
      // Modern sees only proj-a
      expect(modernClient.received).toHaveLength(1);
    });

    it('system-wide events (broadcastAll) reach all clients regardless of subscription', () => {
      // system:paused uses broadcastAll, not broadcastToProject
      const clientA = createClient({ subscribedProject: 'proj-a' });
      const clientB = createClient({ subscribedProject: 'proj-b' });
      const clientNone = createClient({ subscribedProject: null });

      // Simulate broadcastAll (always returns true)
      for (const c of [clientA, clientB, clientNone]) {
        c.received.push({ type: 'system:paused', paused: true });
      }

      expect(clientA.received).toHaveLength(1);
      expect(clientB.received).toHaveLength(1);
      expect(clientNone.received).toHaveLength(1);
    });
  });

  describe('edge cases', () => {
    it('empty string projectId treated as no filter', () => {
      // broadcastToProject with empty string eventProjectId
      const client = createClient({ subscribedProject: 'proj-a' });
      // Empty string is falsy → !eventProjectId is true → passes
      expect(shouldReceiveBroadcast(client, '')).toBe(true);
    });

    it('client subscribedProject set to empty string acts as unsubscribed', () => {
      const client = createClient({ subscribedProject: '' as any });
      // Empty string is falsy → !client.subscribedProject is true → passes
      expect(shouldReceiveBroadcast(client, 'proj-a')).toBe(true);
    });

    it('broadcastEvent with no projectId reaches all clients', () => {
      const clientA = createClient({ subscribedProject: 'proj-a' });
      const clientB = createClient({ subscribedProject: 'proj-b' });

      broadcastToProject([clientA, clientB], { type: 'ci:complete' }, undefined);

      expect(clientA.received).toHaveLength(1);
      expect(clientB.received).toHaveLength(1);
    });
  });
});
