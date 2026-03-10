import { describe, it, expect } from 'vitest';
import {
  agentStatusDot,
  agentStatusText,
  dagStatusBar,
  dagMinimapColor,
  dagTaskText,
  decisionStatusText,
  decisionStatusCard,
  sessionStatusDot,
} from '../statusColors';

describe('agentStatusDot', () => {
  it('returns blue for running', () => {
    expect(agentStatusDot('running')).toBe('bg-blue-400');
  });

  it('returns gray for idle', () => {
    expect(agentStatusDot('idle')).toBe('bg-gray-400');
  });

  it('returns yellow for creating', () => {
    expect(agentStatusDot('creating')).toBe('bg-yellow-400');
  });

  it('returns red for failed', () => {
    expect(agentStatusDot('failed')).toBe('bg-red-400');
  });

  it('falls back to gray for unknown status', () => {
    expect(agentStatusDot('whatever')).toBe('bg-gray-400');
  });
});

describe('agentStatusText', () => {
  it('returns blue for running', () => {
    expect(agentStatusText('running')).toBe('text-blue-400');
  });

  it('returns purple for completed', () => {
    expect(agentStatusText('completed')).toBe('text-purple-400');
  });

  it('falls back to muted for unknown', () => {
    expect(agentStatusText('nope')).toBe('text-th-text-muted');
  });
});

describe('dagStatusBar', () => {
  it('returns purple for done', () => {
    expect(dagStatusBar('done')).toContain('bg-purple');
  });

  it('returns blue for running', () => {
    expect(dagStatusBar('running')).toContain('bg-blue');
  });

  it('returns amber for blocked (not red)', () => {
    const bar = dagStatusBar('blocked');
    expect(bar).toContain('bg-amber');
    expect(bar).not.toContain('bg-red');
  });

  it('falls back to gray for unknown', () => {
    expect(dagStatusBar('xyz')).toBe('bg-gray-400');
  });
});

describe('dagMinimapColor', () => {
  it('returns amber for blocked (not red)', () => {
    const color = dagMinimapColor('blocked');
    expect(color).toContain('amber');
    expect(color).not.toContain('red');
  });

  it('returns purple for done', () => {
    expect(dagMinimapColor('done')).toContain('purple');
  });

  it('returns blue for running', () => {
    expect(dagMinimapColor('running')).toContain('blue');
  });

  it('falls back to zinc for unknown', () => {
    expect(dagMinimapColor('nope')).toBe('bg-zinc-600');
  });
});

describe('dagTaskText', () => {
  it('returns blue for running', () => {
    expect(dagTaskText('running')).toContain('blue');
  });

  it('returns amber for blocked (not orange)', () => {
    const text = dagTaskText('blocked');
    expect(text).toContain('amber');
    expect(text).not.toContain('orange');
  });

  it('returns purple for done', () => {
    expect(dagTaskText('done')).toContain('purple');
  });

  it('falls back to muted for unknown', () => {
    expect(dagTaskText('nope')).toBe('text-th-text-muted');
  });
});

describe('decisionStatusText', () => {
  it('returns green for confirmed', () => {
    expect(decisionStatusText('confirmed')).toContain('green');
  });

  it('returns red for rejected', () => {
    expect(decisionStatusText('rejected')).toContain('red');
  });

  it('returns yellow for pending', () => {
    expect(decisionStatusText('pending')).toContain('yellow');
  });

  it('returns muted for other', () => {
    expect(decisionStatusText('other')).toBe('text-th-text-muted');
  });
});

describe('decisionStatusCard', () => {
  it('returns green border for confirmed', () => {
    expect(decisionStatusCard('confirmed', false)).toContain('green');
  });

  it('returns red border for rejected', () => {
    expect(decisionStatusCard('rejected', false)).toContain('red');
  });

  it('returns yellow border for pending', () => {
    expect(decisionStatusCard('other', true)).toContain('yellow');
  });

  it('returns neutral border for non-pending other', () => {
    expect(decisionStatusCard('other', false)).toContain('border-th-border');
  });
});

describe('sessionStatusDot', () => {
  it('returns purple for completed', () => {
    expect(sessionStatusDot('completed')).toContain('purple');
  });

  it('returns blue with pulse for running', () => {
    const dot = sessionStatusDot('running');
    expect(dot).toContain('blue');
    expect(dot).toContain('animate-pulse');
  });

  it('returns green for active', () => {
    expect(sessionStatusDot('active')).toContain('green');
  });

  it('returns red for failed', () => {
    expect(sessionStatusDot('failed')).toContain('red');
  });

  it('falls back to gray for unknown', () => {
    expect(sessionStatusDot('nope')).toBe('bg-gray-400');
  });
});
