import { describe, it, expect } from 'vitest';
import {
  formatCrewUpdate,
  formatQueryCrew,
  shortenModel,
} from '../coordination/agents/CrewFormatter.js';
import type { CrewMember } from '../coordination/agents/CrewFormatter.js';

function makeMember(overrides: Partial<CrewMember> = {}): CrewMember {
  return {
    id: 'aaaaaaaa-0000-0000-0000-000000000001',
    role: 'developer',
    roleName: 'Developer',
    status: 'running',
    task: 'Implement feature X',
    model: 'claude-sonnet-4.6',
    lockedFiles: [],
    pendingMessages: 0,
    createdAt: new Date(Date.now() - 5 * 60_000).toISOString(),
    contextWindowSize: 200000,
    contextWindowUsed: 90000,
    ...overrides,
  };
}

describe('CrewFormatter', () => {
  describe('shortenModel', () => {
    it('shortens known model names', () => {
      expect(shortenModel('claude-opus-4.6')).toBe('opus');
      expect(shortenModel('claude-sonnet-4.6')).toBe('sonnet');
      expect(shortenModel('claude-haiku-4.5')).toBe('haiku');
      expect(shortenModel('gemini-3-pro-preview')).toBe('gemini');
      expect(shortenModel('gpt-5.2-codex')).toBe('codex');
      expect(shortenModel('gpt-4.1')).toBe('gpt4.1');
    });

    it('returns default for undefined', () => {
      expect(shortenModel(undefined)).toBe('default');
    });

    it('passes through unknown model names with prefix stripped', () => {
      expect(shortenModel('claude-future-9')).toBe('future-9');
      expect(shortenModel('unknown-model')).toBe('unknown-model');
    });
  });

  describe('formatCrewUpdate', () => {
    it('includes CREW, FILE LOCKS, and BUDGET sections', () => {
      const members = [
        makeMember({ id: 'aaaaaaaa-0001', roleName: 'Developer', status: 'running' }),
        makeMember({ id: 'bbbbbbbb-0002', roleName: 'QA Tester', status: 'idle', model: 'claude-haiku-4.5' }),
      ];

      const result = formatCrewUpdate(members, {
        viewerId: 'viewer-id',
        viewerRole: 'lead',
        healthHeader: '== PROJECT HEALTH ==\n✅ 50% complete · 1 active, 1 idle',
        budget: { running: 2, max: 10 },
      });

      expect(result).toContain('== CREW ==');
      expect(result).toContain('== FILE LOCKS ==');
      expect(result).toContain('== BUDGET ==');
      expect(result).toContain('PROJECT HEALTH');
      expect(result).toContain('2 / 10 slots');
    });

    it('excludes the viewer from the crew table', () => {
      const members = [
        makeMember({ id: 'viewer-id-1234', roleName: 'Lead' }),
        makeMember({ id: 'other-id-5678', roleName: 'Developer' }),
      ];

      const result = formatCrewUpdate(members, {
        viewerId: 'viewer-id-1234',
        viewerRole: 'lead',
      });

      expect(result).not.toContain('viewer-i');
      expect(result).toContain('other-id');
    });

    it('shows file locks from members', () => {
      const members = [
        makeMember({
          id: 'dev-aaaa-1234',
          roleName: 'Developer',
          lockedFiles: ['src/index.ts', 'src/utils.ts'],
        }),
      ];

      const result = formatCrewUpdate(members, {
        viewerId: 'other',
        viewerRole: 'lead',
      });

      expect(result).toContain('src/index.ts');
      expect(result).toContain('src/utils.ts');
      expect(result).toContain('dev-aaaa');
    });

    it('shows None when no files are locked', () => {
      const result = formatCrewUpdate([makeMember()], {
        viewerId: 'other',
        viewerRole: 'lead',
      });

      expect(result).toContain('None');
    });

    it('includes alerts when provided', () => {
      const result = formatCrewUpdate([makeMember()], {
        viewerId: 'other',
        viewerRole: 'lead',
        alerts: ['dev-aaaa near context limit (85%)', 'dev-bbbb running >10m'],
      });

      expect(result).toContain('== ALERTS ==');
      expect(result).toContain('near context limit (85%)');
      expect(result).toContain('running >10m');
    });

    it('omits ALERTS section when empty', () => {
      const result = formatCrewUpdate([makeMember()], {
        viewerId: 'other',
        viewerRole: 'lead',
        alerts: [],
      });

      expect(result).not.toContain('== ALERTS ==');
    });

    it('shows shortened model names in table', () => {
      const members = [
        makeMember({ id: 'aaa-1234-5678', model: 'claude-opus-4.6' }),
      ];

      const result = formatCrewUpdate(members, {
        viewerId: 'other',
        viewerRole: 'lead',
      });

      expect(result).toContain('opus');
      expect(result).not.toContain('claude-opus-4.6');
    });

    it('shows context usage percentage', () => {
      const members = [
        makeMember({
          id: 'aaa-1234-5678',
          contextWindowSize: 200000,
          contextWindowUsed: 140000,
        }),
      ];

      const result = formatCrewUpdate(members, {
        viewerId: 'other',
        viewerRole: 'lead',
      });

      expect(result).toContain('70%');
    });

    it('shows queued message count', () => {
      const members = [
        makeMember({ id: 'aaa-1234-5678', pendingMessages: 3 }),
      ];

      const result = formatCrewUpdate(members, {
        viewerId: 'other',
        viewerRole: 'lead',
      });

      expect(result).toContain('3');
    });

    it('shows AT CAPACITY warning when budget full', () => {
      const result = formatCrewUpdate([makeMember()], {
        viewerId: 'other',
        viewerRole: 'lead',
        budget: { running: 10, max: 10 },
      });

      expect(result).toContain('AT CAPACITY');
    });
  });

  describe('formatQueryCrew', () => {
    it('includes YOUR CREW header and DELEGATE instructions', () => {
      const members = [makeMember()];

      const result = formatQueryCrew(members, {
        viewerId: 'viewer-id',
        viewerRole: 'lead',
      });

      expect(result).toContain('YOUR CREW');
      expect(result).toContain('DELEGATE');
      expect(result).toContain('CREATE_AGENT');
      expect(result).toContain('TERMINATE_AGENT');
    });

    it('includes memory section when provided', () => {
      const result = formatQueryCrew([makeMember()], {
        viewerId: 'viewer-id',
        viewerRole: 'lead',
        memorySection: '== AGENT MEMORY ==\nRecorded facts:\n  - dev-aaaa: skill: python',
      });

      expect(result).toContain('AGENT MEMORY');
      expect(result).toContain('skill: python');
    });

    it('includes sibling section for sub-leads', () => {
      const result = formatQueryCrew([makeMember()], {
        viewerId: 'viewer-id',
        viewerRole: 'lead',
        siblingSection: '== SIBLING LEADS ==\n- lead-bb (Project Lead) — running',
      });

      expect(result).toContain('SIBLING LEADS');
    });

    it('includes human message alert when present', () => {
      const result = formatQueryCrew([makeMember()], {
        viewerId: 'viewer-id',
        viewerRole: 'lead',
        humanMessageAlert: '⚠️ UNREAD HUMAN MESSAGE (2m ago): "Please fix the build"',
      });

      expect(result).toContain('UNREAD HUMAN MESSAGE');
      expect(result).toContain('fix the build');
    });

    it('shows budget only for leads', () => {
      const leaderResult = formatQueryCrew([makeMember()], {
        viewerId: 'viewer-id',
        viewerRole: 'lead',
        budget: { running: 5, max: 20 },
      });
      expect(leaderResult).toContain('== BUDGET ==');

      const devResult = formatQueryCrew([makeMember()], {
        viewerId: 'viewer-id',
        viewerRole: 'developer',
        budget: { running: 5, max: 20 },
      });
      expect(devResult).not.toContain('== BUDGET ==');
    });
  });
});
