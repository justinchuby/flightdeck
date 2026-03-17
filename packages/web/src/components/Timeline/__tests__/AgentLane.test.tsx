// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { scaleTime } from '@visx/scale';
import { AgentLane, LABEL_WIDTH, DEFAULT_HEIGHT, type AgentLaneProps } from '../AgentLane';
import type { TimelineAgent } from '../useTimelineData';

vi.mock('../../../utils/getRoleIcon', () => ({
  getRoleIcon: (role: string) => (role === 'developer' ? '👨‍💻' : '🤖'),
}));

const now = new Date('2024-06-01T12:00:00Z');
const oneHourAgo = new Date('2024-06-01T11:00:00Z');

const xScale = scaleTime<number>({
  domain: [oneHourAgo, now],
  range: [LABEL_WIDTH, 800],
});

function makeAgent(overrides: Partial<TimelineAgent> = {}): TimelineAgent {
  return {
    id: 'aaaa-bbbb-cccc-dddd',
    shortId: 'aaaa',
    role: 'developer',
    createdAt: oneHourAgo.toISOString(),
    segments: [
      { status: 'running', startAt: oneHourAgo.toISOString(), endAt: now.toISOString() },
    ],
    ...overrides,
  };
}

function makeProps(overrides: Partial<AgentLaneProps> = {}): AgentLaneProps {
  return {
    agent: makeAgent(),
    xScale,
    y: 0,
    width: 800,
    ...overrides,
  };
}

function renderInSvg(props: AgentLaneProps) {
  return render(
    <svg>
      <AgentLane {...props} />
    </svg>,
  );
}

describe('AgentLane', () => {
  it('renders a group with the agent id data attribute', () => {
    const { container } = renderInSvg(makeProps());
    const g = container.querySelector('[data-agent-id="aaaa-bbbb-cccc-dddd"]');
    expect(g).toBeTruthy();
  });

  it('renders segment rects for each status segment', () => {
    const agent = makeAgent({
      segments: [
        { status: 'running', startAt: oneHourAgo.toISOString(), endAt: new Date('2024-06-01T11:30:00Z').toISOString() },
        { status: 'idle', startAt: new Date('2024-06-01T11:30:00Z').toISOString(), endAt: now.toISOString() },
      ],
    });
    const { container } = renderInSvg(makeProps({ agent }));
    // Each segment has a filled rect; idle segments also have a hatch overlay rect
    const rects = container.querySelectorAll('rect');
    // background rect + 2 segment rects + 1 hatch rect = 4
    expect(rects.length).toBeGreaterThanOrEqual(4);
  });

  it('renders role label and short ID in the foreignObject', () => {
    renderInSvg(makeProps());
    expect(screen.getByText('developer')).toBeInTheDocument();
    expect(screen.getByText('aaaa')).toBeInTheDocument();
  });

  it('renders provider and model badges when present', () => {
    const agent = makeAgent({ provider: 'anthropic', model: 'claude-3' });
    renderInSvg(makeProps({ agent }));
    expect(screen.getByText('anthropic')).toBeInTheDocument();
    expect(screen.getByText('claude-3')).toBeInTheDocument();
  });

  it('calls onExpand with agent id when label is clicked', () => {
    const onExpand = vi.fn();
    renderInSvg(makeProps({ onExpand }));
    // The click target is the div inside foreignObject
    const label = screen.getByText('developer').closest('div');
    fireEvent.click(label!);
    expect(onExpand).toHaveBeenCalledWith('aaaa-bbbb-cccc-dddd');
  });

  it('uses the default height when none is provided', () => {
    const { container } = renderInSvg(makeProps());
    const bgRect = container.querySelector(`rect[height="${DEFAULT_HEIGHT}"]`);
    expect(bgRect).toBeTruthy();
  });

  it('exports LABEL_WIDTH and DEFAULT_HEIGHT constants', () => {
    expect(LABEL_WIDTH).toBe(180);
    expect(DEFAULT_HEIGHT).toBe(48);
  });
});
