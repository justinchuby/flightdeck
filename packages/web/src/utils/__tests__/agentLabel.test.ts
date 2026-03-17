import { describe, it, expect } from 'vitest';
import { shortAgentId, formatRoleLabel, buildAgentLabel, SHORT_ID_LENGTH } from '../agentLabel';

describe('shortAgentId', () => {
  it('shortens an ID to 8 chars by default', () => {
    expect(shortAgentId('a1b2c3d4e5f6')).toBe('a1b2c3d4');
    expect(shortAgentId('a1b2c3d4e5f6').length).toBe(SHORT_ID_LENGTH);
  });

  it('accepts custom length', () => {
    expect(shortAgentId('abcdef123456', 4)).toBe('abcd');
  });

  it('handles short IDs gracefully', () => {
    expect(shortAgentId('abc')).toBe('abc');
  });

  it('handles empty string', () => {
    expect(shortAgentId('')).toBe('');
  });
});

describe('formatRoleLabel', () => {
  it('converts snake_case to Title Case', () => {
    expect(formatRoleLabel('code_reviewer')).toBe('Code Reviewer');
  });

  it('converts kebab-case to Title Case', () => {
    expect(formatRoleLabel('project-lead')).toBe('Project Lead');
  });

  it('returns Agent for undefined', () => {
    expect(formatRoleLabel()).toBe('Agent');
  });

  it('returns Agent for empty string', () => {
    expect(formatRoleLabel('')).toBe('Agent');
  });

  it('handles single word', () => {
    expect(formatRoleLabel('developer')).toBe('Developer');
  });
});

describe('buildAgentLabel', () => {
  it('builds label from role object', () => {
    const label = buildAgentLabel({ id: 'a1b2c3d4e5', role: { name: 'developer' } });
    expect(label).toBe('Developer a1b2c3d4');
  });

  it('builds label from string role', () => {
    const label = buildAgentLabel({ id: '12345678abcd', role: 'qa_tester' });
    expect(label).toBe('Qa Tester 12345678');
  });

  it('defaults to Agent when role is missing', () => {
    const label = buildAgentLabel({ id: 'abcdef00' });
    expect(label).toBe('Agent abcdef00');
  });
});
