import { describe, it, expect } from 'vitest';
import { TAB_LABELS } from '../tabLabels';

describe('TAB_LABELS', () => {
  it('contains expected tab IDs', () => {
    expect(TAB_LABELS.overview).toBe('Overview');
    expect(TAB_LABELS.session).toBe('Session');
    expect(TAB_LABELS.tasks).toBe('Tasks');
    expect(TAB_LABELS.agents).toBe('Agents');
    expect(TAB_LABELS.knowledge).toBe('Knowledge');
    expect(TAB_LABELS.timeline).toBe('Timeline');
    expect(TAB_LABELS.canvas).toBe('Canvas');
  });

  it('handles org-chart key', () => {
    expect(TAB_LABELS['org-chart']).toBe('Org Chart');
  });

  it('has at least 10 entries', () => {
    expect(Object.keys(TAB_LABELS).length).toBeGreaterThanOrEqual(10);
  });

  it('all values are non-empty strings', () => {
    for (const [key, val] of Object.entries(TAB_LABELS)) {
      expect(typeof val).toBe('string');
      expect(val.length).toBeGreaterThan(0);
    }
  });
});
