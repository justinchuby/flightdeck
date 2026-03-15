// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { useAppStore } from '../../../stores/appStore';
import { useLeadStore } from '../../../stores/leadStore';
import type { AcpTextChunk, AcpPlanEntry } from '../../../types';
import type { ActivityEvent } from '../../../stores/leadStore';

/* ------------------------------------------------------------------ */
/*  Mocks                                                              */
/* ------------------------------------------------------------------ */

const mockApiFetch = vi.fn().mockResolvedValue({ messages: [] });
vi.mock('../../../hooks/useApi', () => ({
  apiFetch: (...args: any[]) => mockApiFetch(...args),
}));

vi.mock('react-virtuoso', () => ({
  Virtuoso: ({ data, itemContent, context, components }: any) => {
    const Header = components?.Header;
    const Footer = components?.Footer;
    return (
      <div data-testid="virtuoso">
        {Header && <Header context={context} />}
        {(data ?? []).map((item: any, index: number) => (
          <div key={index}>{itemContent(index, item, context)}</div>
        ))}
        {Footer && <Footer context={context} />}
      </div>
    );
  },
}));

vi.mock('../../PromptNav', () => ({
  PromptNav: () => <div data-testid="prompt-nav" />,
  hasUserMention: () => false,
}));

vi.mock('../../../utils/markdown', () => ({
  InlineMarkdownWithMentions: ({ text }: { text: string }) => <span>{text}</span>,
  MentionText: ({ text }: { text: string }) => <span>{text}</span>,
}));

vi.mock('../../../utils/commandParser', () => ({
  splitCommandBlocks: (text: string) => [text],
}));

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const AGENT_ID = 'aaaa1111-2222-3333-4444-555566667777';
const PROJECT_ID = 'proj-0001';

function makeMsg(
  text: string,
  sender: AcpTextChunk['sender'] = 'agent',
  ts = Date.now(),
  extra?: Partial<AcpTextChunk>,
): AcpTextChunk {
  return { type: 'text', text, sender, timestamp: ts, ...extra };
}

function makePlan(
  content: string,
  status: AcpPlanEntry['status'] = 'pending',
  priority: AcpPlanEntry['priority'] = 'medium',
): AcpPlanEntry {
  return { content, status, priority };
}

function makeActivity(
  summary: string,
  type: ActivityEvent['type'] = 'progress_update',
  ts = Date.now(),
): ActivityEvent {
  return {
    id: `evt-${Math.random().toString(36).slice(2, 8)}`,
    agentId: AGENT_ID,
    agentRole: 'developer',
    type,
    summary,
    timestamp: ts,
  };
}

function seedAgent(messages: AcpTextChunk[] = [], plan: AcpPlanEntry[] = []) {
  useAppStore.getState().setAgents([
    {
      id: AGENT_ID,
      role: { id: 'developer', name: 'Developer', systemPrompt: '' },
      status: 'idle',
      model: 'test-model',
      messages,
      plan,
      childIds: [],
      inputTokens: 0,
      outputTokens: 0,
      contextWindowSize: 0,
      contextWindowUsed: 0,
    } as any,
  ]);
}

function seedActivity(events: ActivityEvent[]) {
  useLeadStore.getState().addProject(PROJECT_ID);
  for (const evt of events) {
    useLeadStore.getState().addActivity(PROJECT_ID, evt);
  }
}

async function renderAcpOutput() {
  // Lazy-import so mocks are resolved first
  const { AcpOutput } = await import('../AcpOutput');
  return render(<AcpOutput agentId={AGENT_ID} />);
}

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

describe('AcpOutput', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAppStore.getState().setAgents([]);
    // Reset leadStore projects
    const projects = useLeadStore.getState().projects;
    for (const id of Object.keys(projects)) {
      useLeadStore.getState().removeProject(id);
    }
  });

  /* ---------- Render tests ---------- */

  it('renders empty state with virtuoso container', async () => {
    seedAgent();
    await renderAcpOutput();
    expect(screen.getByTestId('virtuoso')).toBeInTheDocument();
  });

  it('renders agent text messages', async () => {
    seedAgent([
      makeMsg('Hello from the agent', 'agent', 1000),
      makeMsg('User interjects', 'user', 2000),
      makeMsg('Second message', 'agent', 3000),
    ]);
    await renderAcpOutput();
    expect(screen.getByText('Hello from the agent')).toBeInTheDocument();
    expect(screen.getByText('Second message')).toBeInTheDocument();
  });

  it('renders user messages with blue styling', async () => {
    seedAgent([makeMsg('User says hi', 'user', 1000)]);
    await renderAcpOutput();
    const el = screen.getByText('User says hi');
    // The bubble should have bg-blue-600
    const bubble = el.closest('.bg-blue-600');
    expect(bubble).not.toBeNull();
  });

  it('renders system messages centered', async () => {
    seedAgent([makeMsg('System notice', 'system', 1000)]);
    await renderAcpOutput();
    const el = screen.getByText('System notice');
    // System messages are wrapped in justify-center
    const wrapper = el.closest('.justify-center');
    expect(wrapper).not.toBeNull();
  });

  it('renders thinking messages in italic', async () => {
    seedAgent([makeMsg('Thinking deeply...', 'thinking', 1000)]);
    await renderAcpOutput();
    const el = screen.getByText('Thinking deeply...');
    const italicWrapper = el.closest('.italic');
    expect(italicWrapper).not.toBeNull();
  });

  it('renders tool messages with wrench icon', async () => {
    seedAgent([
      makeMsg('Running build', 'tool', 1000, {
        toolStatus: 'in_progress',
        toolKind: 'bash',
      }),
    ]);
    await renderAcpOutput();
    expect(screen.getByText('Running build')).toBeInTheDocument();
    // Tool kind badge
    expect(screen.getByText('bash')).toBeInTheDocument();
  });

  it('renders messages with mixed senders', async () => {
    seedAgent([
      makeMsg('Agent starts', 'agent', 1000),
      makeMsg('User asks question', 'user', 2000),
      makeMsg('System alert', 'system', 3000),
      makeMsg('Agent responds', 'agent', 4000),
    ]);
    await renderAcpOutput();
    expect(screen.getByText('Agent starts')).toBeInTheDocument();
    expect(screen.getByText('User asks question')).toBeInTheDocument();
    expect(screen.getByText('System alert')).toBeInTheDocument();
    expect(screen.getByText('Agent responds')).toBeInTheDocument();
  });

  /* ---------- Plan tests ---------- */

  it('renders plan section when plan exists with correct count', async () => {
    seedAgent([], [
      makePlan('Design the API', 'completed', 'high'),
      makePlan('Write tests', 'in_progress', 'medium'),
      makePlan('Deploy', 'pending', 'low'),
    ]);
    await renderAcpOutput();
    // Plan header shows (completed/total)
    expect(screen.getByText(/Plan \(1\/3\)/)).toBeInTheDocument();
  });

  it('plan section is collapsible — starts open, click to close', async () => {
    seedAgent([], [
      makePlan('Design the API', 'completed', 'high'),
      makePlan('Write tests', 'pending', 'medium'),
    ]);
    await renderAcpOutput();
    // Plan entries visible initially (planOpen defaults to true)
    expect(screen.getByText('Design the API')).toBeInTheDocument();
    expect(screen.getByText('Write tests')).toBeInTheDocument();

    // Click the plan toggle button to collapse
    const toggleBtn = screen.getByText(/Plan \(1\/2\)/);
    fireEvent.click(toggleBtn);

    // Entries should now be hidden
    expect(screen.queryByText('Design the API')).not.toBeInTheDocument();
    expect(screen.queryByText('Write tests')).not.toBeInTheDocument();

    // Header should still be visible
    expect(screen.getByText(/Plan \(1\/2\)/)).toBeInTheDocument();
  });

  it('does NOT render plan section when plan is empty', async () => {
    seedAgent([makeMsg('Hello', 'agent', 1000)], []);
    await renderAcpOutput();
    expect(screen.queryByText(/Plan \(/)).not.toBeInTheDocument();
  });

  /* ---------- Queued messages ---------- */

  it('renders queued messages footer when queued messages exist', async () => {
    // Last non-queued must be from 'user' so the promote-queued effect doesn't fire
    seedAgent([
      makeMsg('User asked something', 'user', 1000),
      makeMsg('Queued msg 1', 'user', 2000, { queued: true }),
      makeMsg('Queued msg 2', 'user', 3000, { queued: true }),
    ]);
    await renderAcpOutput();
    expect(screen.getByText(/Queued \(2\)/)).toBeInTheDocument();
    expect(screen.getByText('Queued msg 1')).toBeInTheDocument();
    expect(screen.getByText('Queued msg 2')).toBeInTheDocument();
  });

  it('does NOT render queued footer when no queued messages', async () => {
    seedAgent([makeMsg('Normal message', 'agent', 1000)]);
    await renderAcpOutput();
    expect(screen.queryByText(/Queued/)).not.toBeInTheDocument();
  });

  /* ---------- Message grouping ---------- */

  it('groups consecutive agent messages into an agent-group', async () => {
    seedAgent([
      makeMsg('Line 1', 'agent', 1000),
      makeMsg('Line 2', 'agent', 2000),
      makeMsg('Line 3', 'agent', 3000),
    ]);
    await renderAcpOutput();
    // All three texts should appear (merged into one agent-group)
    expect(screen.getByText(/Line 1/)).toBeInTheDocument();
    expect(screen.getByText(/Line 2/)).toBeInTheDocument();
    expect(screen.getByText(/Line 3/)).toBeInTheDocument();
  });

  it('renders activity events in timeline', async () => {
    // Activity event placed before any agent message so it renders standalone
    seedAgent([makeMsg('Agent text', 'agent', 5000)]);
    seedActivity([
      makeActivity('Deployed to staging', 'progress_update', 1000),
    ]);
    await renderAcpOutput();
    expect(screen.getByText(/Deployed to staging/)).toBeInTheDocument();
  });

  /* ---------- API / history fetch ---------- */

  it('calls apiFetch to load message history when no messages', async () => {
    seedAgent([]); // no messages
    await renderAcpOutput();
    expect(mockApiFetch).toHaveBeenCalledWith(
      `/agents/${AGENT_ID}/messages?limit=200`,
    );
  });

  it('does NOT call apiFetch when messages already exist', async () => {
    seedAgent([makeMsg('Already here', 'agent', 1000)]);
    await renderAcpOutput();
    expect(mockApiFetch).not.toHaveBeenCalled();
  });

  /* ---------- System message filtering ---------- */

  it('does not render system messages starting with 📤', async () => {
    seedAgent([
      makeMsg('📤 Sent DM to @dev', 'system', 1000),
      makeMsg('Visible system msg', 'system', 2000),
    ]);
    await renderAcpOutput();
    expect(screen.queryByText(/📤 Sent DM/)).not.toBeInTheDocument();
    expect(screen.getByText('Visible system msg')).toBeInTheDocument();
  });

  it('renders --- system message as horizontal rule', async () => {
    seedAgent([
      makeMsg('Before separator', 'agent', 1000),
      makeMsg('---', 'system', 2000),
      makeMsg('After separator', 'agent', 3000),
    ]);
    await renderAcpOutput();
    const virtuoso = screen.getByTestId('virtuoso');
    const hr = virtuoso.querySelector('hr');
    expect(hr).not.toBeNull();
  });

  /* ---------- Content types ---------- */

  it('renders image content type', async () => {
    seedAgent([
      makeMsg('', 'agent', 1000, {
        contentType: 'image',
        mimeType: 'image/png',
        data: 'iVBORw0KGgo=',
      }),
    ]);
    await renderAcpOutput();
    const img = screen.getByAltText('Agent image');
    expect(img).toBeInTheDocument();
    expect(img.getAttribute('src')).toContain('data:image/png;base64,');
  });

  it('renders resource content type with URI and text', async () => {
    seedAgent([
      makeMsg('Resource content here', 'agent', 1000, {
        contentType: 'resource',
        uri: 'file:///src/index.ts',
      }),
    ]);
    await renderAcpOutput();
    expect(screen.getByText('file:///src/index.ts')).toBeInTheDocument();
    expect(screen.getByText('Resource content here')).toBeInTheDocument();
  });

  /* ---------- PromptNav ---------- */

  it('renders PromptNav component', async () => {
    seedAgent([makeMsg('Hello', 'agent', 1000)]);
    await renderAcpOutput();
    expect(screen.getByTestId('prompt-nav')).toBeInTheDocument();
  });

  /* ---------- Plan priority badges ---------- */

  it('renders plan priority badges', async () => {
    seedAgent([], [
      makePlan('Critical task', 'pending', 'high'),
      makePlan('Normal task', 'pending', 'medium'),
      makePlan('Optional task', 'pending', 'low'),
    ]);
    await renderAcpOutput();
    expect(screen.getByText('high')).toBeInTheDocument();
    expect(screen.getByText('medium')).toBeInTheDocument();
    expect(screen.getByText('low')).toBeInTheDocument();
  });

  /* ---------- Plan status icons ---------- */

  it('renders plan status icons', async () => {
    seedAgent([], [
      makePlan('Pending task', 'pending', 'medium'),
      makePlan('In progress task', 'in_progress', 'medium'),
      makePlan('Completed task', 'completed', 'medium'),
    ]);
    await renderAcpOutput();
    expect(screen.getByText('⏳')).toBeInTheDocument();
    expect(screen.getByText('🔄')).toBeInTheDocument();
    expect(screen.getByText('✅')).toBeInTheDocument();
  });

  /* ---------- Tool call status colors ---------- */

  it('renders completed tool calls with correct status', async () => {
    seedAgent([
      makeMsg('npm test', 'tool', 1000, {
        toolStatus: 'completed',
        toolKind: 'shell',
      }),
    ]);
    await renderAcpOutput();
    expect(screen.getByText('npm test')).toBeInTheDocument();
    expect(screen.getByText('shell')).toBeInTheDocument();
  });

  /* ---------- User attachments ---------- */

  it('renders user message with attachment indicator', async () => {
    seedAgent([
      makeMsg('Check this image', 'user', 1000, {
        attachments: [{ name: 'photo.png', mimeType: 'image/png' }],
      }),
    ]);
    await renderAcpOutput();
    expect(screen.getByText('Check this image')).toBeInTheDocument();
    expect(screen.getByText(/1 image attached/)).toBeInTheDocument();
  });
});
