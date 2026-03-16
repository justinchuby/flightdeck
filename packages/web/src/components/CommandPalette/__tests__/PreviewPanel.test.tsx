// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PreviewPanel, type PreviewData, buildPreviewData } from '../PreviewPanel';
import type { AgentInfo } from '../../../types';

describe('PreviewPanel', () => {
  it('renders nothing when data is null', () => {
    const { container } = render(<PreviewPanel data={null} />);
    expect(container.innerHTML).toBe('');
  });

  it('renders preview with title and fields', () => {
    const data: PreviewData = {
      type: 'agent',
      title: 'Developer Agent',
      subtitle: 'Running',
      fields: [
        { label: 'Model', value: 'gpt-4' },
        { label: 'Status', value: 'active' },
      ],
    };
    render(<PreviewPanel data={data} />);
    expect(screen.getByText('Developer Agent')).toBeInTheDocument();
    expect(screen.getByText('gpt-4')).toBeInTheDocument();
  });

  it('renders subtitle', () => {
    const data: PreviewData = {
      type: 'project',
      title: 'My Project',
      subtitle: 'In Progress',
      fields: [],
    };
    render(<PreviewPanel data={data} />);
    expect(screen.getByText('In Progress')).toBeInTheDocument();
  });

  it('renders action buttons', () => {
    const onClick = vi.fn();
    const data: PreviewData = {
      type: 'command',
      title: 'Run Tests',
      fields: [],
      actions: [{ label: 'Execute', onClick }],
    };
    render(<PreviewPanel data={data} />);
    fireEvent.click(screen.getByText('Execute'));
    expect(onClick).toHaveBeenCalled();
  });

  it('renders multiple fields', () => {
    const data: PreviewData = {
      type: 'info',
      title: 'Info Panel',
      fields: [
        { label: 'Field1', value: 'Value1' },
        { label: 'Field2', value: 'Value2' },
        { label: 'Field3', value: 'Value3' },
      ],
    };
    render(<PreviewPanel data={data} />);
    expect(screen.getByText('Value1')).toBeInTheDocument();
    expect(screen.getByText('Value3')).toBeInTheDocument();
  });
});

/**
 * Coverage tests for buildPreviewData — the untested export in PreviewPanel.tsx.
 * The existing test only covers the PreviewPanel component; this covers all
 * branches of buildPreviewData (agent, task, navigation, nl-command, suggestion, unknown).
 */

function makeAgent(overrides: Partial<AgentInfo> = {}): AgentInfo {
  return {
    id: 'agent-1',
    role: { id: 'dev', name: 'Developer', systemPrompt: '' },
    status: 'running',
    model: 'gpt-4',
    provider: 'openai',
    backend: 'acp',
    inputTokens: 0,
    outputTokens: 0,
    contextWindowSize: 128000,
    contextWindowUsed: 64000,
    contextBurnRate: 0,
    estimatedExhaustionMinutes: null,
    pendingMessages: 0,
    createdAt: new Date().toISOString(),
    childIds: [],
    toolCalls: [],
    messages: [],
    isSubLead: false,
    hierarchyLevel: 0,
    outputPreview: '',
    task: 'Implement feature X',
    ...overrides,
  } as AgentInfo;
}

describe('buildPreviewData', () => {
  const agents = [makeAgent()];

  it('builds agent preview with full details', () => {
    const item = { type: 'agent', label: 'Dev', agentId: 'agent-1' };
    const result = buildPreviewData(item, agents);
    expect(result).not.toBeNull();
    expect(result!.type).toBe('agent');
    expect(result!.title).toBe('Developer');
    expect(result!.subtitle).toBe('Status: running');
    expect(result!.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: 'Task', value: 'Implement feature X' }),
        expect.objectContaining({ label: 'Context' }),
        expect.objectContaining({ label: 'Provider', value: 'openai' }),
        expect.objectContaining({ label: 'Model', value: 'gpt-4' }),
      ]),
    );
  });

  it('shows dash for context when window size is 0', () => {
    const a = [makeAgent({ contextWindowSize: 0, contextWindowUsed: 0 })];
    const result = buildPreviewData({ type: 'agent', label: 'Dev', agentId: 'agent-1' }, a);
    const ctxField = result!.fields.find(f => f.label === 'Context');
    expect(ctxField!.value).toBe('—');
  });

  it('computes context percentage correctly', () => {
    const a = [makeAgent({ contextWindowSize: 100000, contextWindowUsed: 50000 })];
    const result = buildPreviewData({ type: 'agent', label: 'Dev', agentId: 'agent-1' }, a);
    const ctxField = result!.fields.find(f => f.label === 'Context');
    expect(ctxField!.value).toBe('50%');
  });

  it('returns null for agent type when agent not found', () => {
    const result = buildPreviewData({ type: 'agent', label: 'X', agentId: 'nonexistent' }, agents);
    expect(result).toBeNull();
  });

  it('returns null for agent type without agentId', () => {
    const result = buildPreviewData({ type: 'agent', label: 'X' }, agents);
    expect(result).toBeNull();
  });

  it('omits provider and model fields when agent lacks them', () => {
    const a = [makeAgent({ provider: undefined, model: undefined })];
    const result = buildPreviewData({ type: 'agent', label: 'Dev', agentId: 'agent-1' }, a);
    expect(result!.fields.find(f => f.label === 'Provider')).toBeUndefined();
    expect(result!.fields.find(f => f.label === 'Model')).toBeUndefined();
  });

  it('shows "None" for task when agent has no task', () => {
    const a = [makeAgent({ task: undefined })];
    const result = buildPreviewData({ type: 'agent', label: 'Dev', agentId: 'agent-1' }, a);
    const taskField = result!.fields.find(f => f.label === 'Task');
    expect(taskField!.value).toBe('None');
  });

  it('uses role name "Agent" when agent has no role name', () => {
    const a = [makeAgent({ role: { id: 'x', systemPrompt: '' } as any })];
    const result = buildPreviewData({ type: 'agent', label: 'Dev', agentId: 'agent-1' }, a);
    expect(result!.title).toBe('Agent');
  });

  it('builds task preview', () => {
    const result = buildPreviewData({ type: 'task', label: 'Build UI', description: 'Create components' }, []);
    expect(result).toEqual({
      type: 'task',
      title: 'Build UI',
      subtitle: 'Create components',
      fields: [],
    });
  });

  it('builds navigation preview with description', () => {
    const result = buildPreviewData({ type: 'navigation', label: 'Dashboard', description: 'Go to dashboard' }, []);
    expect(result).toEqual({
      type: 'navigation',
      title: 'Dashboard',
      subtitle: 'Go to dashboard',
      fields: [],
    });
  });

  it('builds navigation preview with default subtitle', () => {
    const result = buildPreviewData({ type: 'navigation', label: 'Dashboard' }, []);
    expect(result!.subtitle).toBe('Navigate to this page');
  });

  it('builds nl-command preview with description', () => {
    const result = buildPreviewData({ type: 'nl-command', label: 'Run tests', description: 'Execute test suite' }, []);
    expect(result).toEqual({
      type: 'nl-command',
      title: 'Run tests',
      subtitle: 'Execute test suite',
      fields: [],
    });
  });

  it('builds nl-command preview with default subtitle', () => {
    const result = buildPreviewData({ type: 'nl-command', label: 'Run tests' }, []);
    expect(result!.subtitle).toBe('Execute this command');
  });

  it('builds suggestion preview', () => {
    const result = buildPreviewData({ type: 'suggestion', label: 'Try this', description: 'A suggestion' }, []);
    expect(result).toEqual({
      type: 'suggestion',
      title: 'Try this',
      subtitle: 'A suggestion',
      fields: [],
    });
  });

  it('returns null for unknown type', () => {
    const result = buildPreviewData({ type: 'unknown', label: 'X' }, []);
    expect(result).toBeNull();
  });
});

describe('buildPreviewData', () => {
  // Agent with matching agent in list
  it('returns agent preview with context percentage', () => {
    const agents = [{
      id: 'a1', status: 'running', task: 'Build UI',
      contextWindowSize: 100000, contextWindowUsed: 75000,
      role: { name: 'Developer' }, provider: 'anthropic', model: 'sonnet',
    }] as any;
    const result = buildPreviewData({ type: 'agent', label: 'Dev', agentId: 'a1' }, agents);
    expect(result).not.toBeNull();
    expect(result!.type).toBe('agent');
    expect(result!.title).toBe('Developer');
    expect(result!.subtitle).toBe('Status: running');
    expect(result!.fields.find(f => f.label === 'Context')!.value).toBe('75%');
    expect(result!.fields.find(f => f.label === 'Provider')!.value).toBe('anthropic');
    expect(result!.fields.find(f => f.label === 'Model')!.value).toBe('sonnet');
  });

  // Agent with no context data
  it('returns dash for context when no context data', () => {
    const agents = [{
      id: 'a1', status: 'idle', task: null,
      role: { name: 'Tester' },
    }] as any;
    const result = buildPreviewData({ type: 'agent', label: 'Test', agentId: 'a1' }, agents);
    expect(result!.fields.find(f => f.label === 'Context')!.value).toBe('—');
    expect(result!.fields.find(f => f.label === 'Task')!.value).toBe('None');
  });

  // Agent not found
  it('returns null when agent is not found', () => {
    const result = buildPreviewData({ type: 'agent', label: 'X', agentId: 'missing' }, []);
    expect(result).toBeNull();
  });

  // Agent without agentId
  it('returns null for agent type without agentId', () => {
    const result = buildPreviewData({ type: 'agent', label: 'X' }, []);
    expect(result).toBeNull();
  });

  // Agent without provider/model
  it('omits provider/model fields when not set', () => {
    const agents = [{
      id: 'a1', status: 'running', task: 'Work',
      role: { name: 'Dev' },
    }] as any;
    const result = buildPreviewData({ type: 'agent', label: 'Dev', agentId: 'a1' }, agents);
    expect(result!.fields.find(f => f.label === 'Provider')).toBeUndefined();
    expect(result!.fields.find(f => f.label === 'Model')).toBeUndefined();
  });

  // Agent with no role name
  it('uses "Agent" when role has no name', () => {
    const agents = [{
      id: 'a1', status: 'running', task: 'Work', role: {},
    }] as any;
    const result = buildPreviewData({ type: 'agent', label: 'Ag', agentId: 'a1' }, agents);
    expect(result!.title).toBe('Agent');
  });

  // Task
  it('returns task preview', () => {
    const result = buildPreviewData({ type: 'task', label: 'Fix bug', description: 'Fix the login bug' }, []);
    expect(result).not.toBeNull();
    expect(result!.type).toBe('task');
    expect(result!.title).toBe('Fix bug');
    expect(result!.subtitle).toBe('Fix the login bug');
  });

  // Navigation
  it('returns navigation preview', () => {
    const result = buildPreviewData({ type: 'navigation', label: 'Go to Settings', description: 'Open settings page' }, []);
    expect(result!.type).toBe('navigation');
    expect(result!.title).toBe('Go to Settings');
    expect(result!.subtitle).toBe('Open settings page');
  });

  // Navigation without description
  it('returns default subtitle for navigation without description', () => {
    const result = buildPreviewData({ type: 'navigation', label: 'Home' }, []);
    expect(result!.subtitle).toBe('Navigate to this page');
  });

  // NL command
  it('returns nl-command preview', () => {
    const result = buildPreviewData({ type: 'nl-command', label: 'Run tests', description: 'Execute test suite' }, []);
    expect(result!.type).toBe('nl-command');
    expect(result!.title).toBe('Run tests');
    expect(result!.subtitle).toBe('Execute test suite');
  });

  // NL command without description
  it('returns default subtitle for nl-command without description', () => {
    const result = buildPreviewData({ type: 'nl-command', label: 'Deploy' }, []);
    expect(result!.subtitle).toBe('Execute this command');
  });

  // Suggestion
  it('returns suggestion preview', () => {
    const result = buildPreviewData({ type: 'suggestion', label: 'Add tests', description: 'Improve coverage' }, []);
    expect(result!.type).toBe('suggestion');
    expect(result!.title).toBe('Add tests');
    expect(result!.subtitle).toBe('Improve coverage');
  });

  // Unknown type
  it('returns null for unknown type', () => {
    const result = buildPreviewData({ type: 'unknown-type', label: 'X' }, []);
    expect(result).toBeNull();
  });
});
