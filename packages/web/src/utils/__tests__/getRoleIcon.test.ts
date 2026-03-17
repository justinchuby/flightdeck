import { describe, it, expect } from 'vitest';
import { getRoleIcon } from '../getRoleIcon';

describe('getRoleIcon', () => {
  it('returns icon from Role object', () => {
    expect(getRoleIcon({ id: 'dev', name: 'Developer', systemPrompt: '', icon: '🛠' })).toBe('🛠');
  });

  it('returns default 🤖 for Role object without icon', () => {
    expect(getRoleIcon({ id: 'dev', name: 'Developer', systemPrompt: '' } as any)).toBe('🤖');
  });

  it('returns fallback icon for known role ID strings', () => {
    expect(getRoleIcon('lead')).toBe('👑');
    expect(getRoleIcon('architect')).toBe('🏗️');
    expect(getRoleIcon('developer')).toBe('💻');
    expect(getRoleIcon('code-reviewer')).toBe('📖');
    expect(getRoleIcon('critical-reviewer')).toBe('🛡️');
    expect(getRoleIcon('readability-reviewer')).toBe('👁️');
    expect(getRoleIcon('qa-tester')).toBe('🧪');
    expect(getRoleIcon('designer')).toBe('🎨');
    expect(getRoleIcon('tech-writer')).toBe('📝');
    expect(getRoleIcon('product-manager')).toBe('🎯');
    expect(getRoleIcon('secretary')).toBe('📋');
    expect(getRoleIcon('radical-thinker')).toBe('🚀');
    expect(getRoleIcon('generalist')).toBe('🔧');
    expect(getRoleIcon('agent')).toBe('⚙️');
  });

  it('returns default 🤖 for unknown role ID string', () => {
    expect(getRoleIcon('unknown-role')).toBe('🤖');
  });

  it('returns default 🤖 for null', () => {
    expect(getRoleIcon(null)).toBe('🤖');
  });

  it('returns default 🤖 for undefined', () => {
    expect(getRoleIcon(undefined)).toBe('🤖');
  });
});
