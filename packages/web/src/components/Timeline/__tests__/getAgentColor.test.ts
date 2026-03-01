import { describe, it, expect } from 'vitest';
import { getAgentColor, AGENT_COLORS } from '../getAgentColor';

describe('getAgentColor', () => {
  it('returns a color from the WCAG AA palette', () => {
    const color = getAgentColor('agent-abc-123');
    expect(AGENT_COLORS).toContain(color);
  });

  it('is deterministic — same ID always returns same color', () => {
    const id = 'agent-xyz-789';
    const color1 = getAgentColor(id);
    const color2 = getAgentColor(id);
    expect(color1).toBe(color2);
  });

  it('distributes different IDs across multiple colors', () => {
    const ids = Array.from({ length: 20 }, (_, i) => `agent-${i}`);
    const colors = new Set(ids.map(getAgentColor));
    // With 20 distinct IDs and 8 colors, we should get at least 3 distinct colors
    expect(colors.size).toBeGreaterThanOrEqual(3);
  });

  it('handles empty string without throwing', () => {
    expect(() => getAgentColor('')).not.toThrow();
    expect(AGENT_COLORS).toContain(getAgentColor(''));
  });

  it('palette has exactly 8 colors', () => {
    expect(AGENT_COLORS).toHaveLength(8);
  });
});
