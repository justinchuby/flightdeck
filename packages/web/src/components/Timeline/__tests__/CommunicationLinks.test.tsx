import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import type { Communication, CommunicationLinksProps } from '../CommunicationLinks';

// ── Mocks ─────────────────────────────────────────────────────────────────

vi.mock('@visx/tooltip', () => ({
  useTooltip: () => ({
    tooltipOpen: false,
    tooltipData: null,
    tooltipLeft: 0,
    tooltipTop: 0,
    showTooltip: vi.fn(),
    hideTooltip: vi.fn(),
  }),
  TooltipWithBounds: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  defaultStyles: {},
}));

vi.mock('../formatTimestamp', () => ({
  formatTimestamp: (d: Date) => d.toISOString(),
}));

vi.mock('../../../utils/agentLabel', () => ({
  shortAgentId: (id: string) => id.slice(0, 4),
}));

import { CommunicationLinks } from '../CommunicationLinks';

// ── Helpers ──────────────────────────────────────────────────────────────

function makeXScale(): CommunicationLinksProps['xScale'] {
  const fn = ((d: Date) => {
    void d;
    return 100;
  }) as unknown as CommunicationLinksProps['xScale'];
  return fn;
}

function makePositions(...ids: string[]): Map<string, number> {
  const map = new Map<string, number>();
  ids.forEach((id, i) => map.set(id, i * 40));
  return map;
}

function makeComm(overrides: Partial<Communication> = {}): Communication {
  return {
    type: 'delegation',
    fromAgentId: 'agent-1',
    toAgentId: 'agent-2',
    summary: 'Test message',
    timestamp: '2024-01-01T00:01:00Z',
    ...overrides,
  };
}

function renderLinks(overrides: Partial<CommunicationLinksProps> = {}) {
  const props: CommunicationLinksProps = {
    communications: [makeComm()],
    agentPositions: makePositions('agent-1', 'agent-2'),
    xScale: makeXScale(),
    laneHeight: 28,
    ...overrides,
  };
  return render(
    <svg>
      <CommunicationLinks {...props} />
    </svg>,
  );
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('CommunicationLinks', () => {
  it('renders an SVG group with role="list"', () => {
    const { container } = renderLinks();
    const g = container.querySelector('g.communication-links');
    expect(g).not.toBeNull();
    expect(g?.getAttribute('role')).toBe('list');
  });

  it('renders marker definitions', () => {
    const { container } = renderLinks();
    expect(container.querySelector('#marker-arrow')).not.toBeNull();
    expect(container.querySelector('#marker-circle')).not.toBeNull();
    expect(container.querySelector('#marker-diamond')).not.toBeNull();
    expect(container.querySelector('#marker-star')).not.toBeNull();
  });

  it('renders a link as a list item with correct aria-label', () => {
    const { container } = renderLinks();
    const items = container.querySelectorAll('g[role="listitem"]');
    expect(items.length).toBe(1);
    expect(items[0].getAttribute('aria-label')).toContain('Delegation');
    expect(items[0].getAttribute('aria-label')).toContain('agen');
  });

  it('renders a path element for the link', () => {
    const { container } = renderLinks();
    const paths = container.querySelectorAll('g[role="listitem"] path');
    // 2 paths: hit area + visible link
    expect(paths.length).toBe(2);
  });

  it('renders nothing when communications are empty', () => {
    const { container } = renderLinks({ communications: [] });
    const items = container.querySelectorAll('g[role="listitem"]');
    expect(items.length).toBe(0);
  });

  it('skips links for unknown fromAgentId', () => {
    const comms = [makeComm({ fromAgentId: 'unknown-agent' })];
    const { container } = renderLinks({ communications: comms });
    const items = container.querySelectorAll('g[role="listitem"]');
    expect(items.length).toBe(0);
  });

  it('renders stub for missing toAgentId', () => {
    const comms = [makeComm({ toAgentId: undefined, groupName: 'dev-chat' })];
    const { container } = renderLinks({ communications: comms });
    const items = container.querySelectorAll('g[role="listitem"]');
    expect(items.length).toBe(1);
    // Should render a text label for group name
    const text = container.querySelector('g[role="listitem"] text');
    expect(text).not.toBeNull();
    expect(text?.textContent).toContain('dev-chat');
  });

  it('renders ? label for missing toAgentId without groupName', () => {
    const comms = [makeComm({ toAgentId: undefined, groupName: undefined })];
    const { container } = renderLinks({ communications: comms });
    const text = container.querySelector('g[role="listitem"] text');
    expect(text?.textContent).toBe('?');
  });

  it('renders broadcast links to all agents except sender', () => {
    const comms = [makeComm({ type: 'broadcast', fromAgentId: 'agent-1', toAgentId: undefined })];
    const positions = makePositions('agent-1', 'agent-2', 'agent-3');
    const { container } = renderLinks({ communications: comms, agentPositions: positions });
    const items = container.querySelectorAll('g[role="listitem"]');
    // Broadcast fans out to agent-2 and agent-3
    expect(items.length).toBe(2);
  });

  it('culls links outside visible time range', () => {
    const comms = [makeComm({ timestamp: '2024-01-01T00:01:00Z' })];
    const visibleTimeRange: [Date, Date] = [
      new Date('2024-01-01T00:05:00Z'),
      new Date('2024-01-01T00:10:00Z'),
    ];
    const { container } = renderLinks({ communications: comms, visibleTimeRange });
    const items = container.querySelectorAll('g[role="listitem"]');
    expect(items.length).toBe(0);
  });

  it('renders multiple different link types', () => {
    const comms = [
      makeComm({ type: 'delegation' }),
      makeComm({ type: 'agent_message', timestamp: '2024-01-01T00:02:00Z' }),
      makeComm({ type: 'group_message', timestamp: '2024-01-01T00:03:00Z' }),
    ];
    const { container } = renderLinks({ communications: comms });
    const items = container.querySelectorAll('g[role="listitem"]');
    expect(items.length).toBe(3);
  });

  it('uses marker-end for links with valid toAgentId', () => {
    const { container } = renderLinks();
    const paths = container.querySelectorAll('g[role="listitem"] path');
    // The visible path (second one) should have marker-end
    const visiblePath = paths[1];
    expect(visiblePath?.getAttribute('marker-end')).toContain('marker-arrow');
  });

  it('does not use marker-end for stub links', () => {
    const comms = [makeComm({ toAgentId: undefined })];
    const { container } = renderLinks({ communications: comms });
    const paths = container.querySelectorAll('g[role="listitem"] path');
    const visiblePath = paths[1];
    expect(visiblePath?.getAttribute('marker-end')).toBeNull();
  });
});
