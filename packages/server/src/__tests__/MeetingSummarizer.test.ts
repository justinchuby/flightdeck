import { describe, it, expect, beforeEach } from 'vitest';
import { MeetingSummarizer } from '../coordination/MeetingSummarizer.js';
import type { MeetingMessage } from '../coordination/MeetingSummarizer.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

const BASE_TS = 1_700_000_000_000;

function msg(from: string, content: string, offsetMs = 0): MeetingMessage {
  return { from, content, timestamp: BASE_TS + offsetMs };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('MeetingSummarizer', () => {
  let summarizer: MeetingSummarizer;

  beforeEach(() => {
    summarizer = new MeetingSummarizer();
  });

  describe('summarize() — validation', () => {
    it('throws when messages array is empty', () => {
      expect(() => summarizer.summarize('my-group', [])).toThrow('No messages to summarize');
    });
  });

  describe('summarize() — basic fields', () => {
    const messages = [
      msg('alice', 'Hello everyone', 0),
      msg('bob', 'Hi Alice', 1000),
      msg('alice', 'Shall we start?', 2000),
    ];

    it('sets groupName', () => {
      const result = summarizer.summarize('design-review', messages);
      expect(result.groupName).toBe('design-review');
    });

    it('sets messageCount', () => {
      const result = summarizer.summarize('g', messages);
      expect(result.messageCount).toBe(3);
    });

    it('sets startTime from first message', () => {
      const result = summarizer.summarize('g', messages);
      expect(result.startTime).toBe(BASE_TS);
    });

    it('sets endTime from last message', () => {
      const result = summarizer.summarize('g', messages);
      expect(result.endTime).toBe(BASE_TS + 2000);
    });

    it('deduplicates participants', () => {
      const result = summarizer.summarize('g', messages);
      expect(result.participants).toEqual(expect.arrayContaining(['alice', 'bob']));
      expect(result.participants).toHaveLength(2);
    });

    it('generates an id with meeting- prefix', () => {
      const result = summarizer.summarize('g', messages);
      expect(result.id).toMatch(/^meeting-/);
    });
  });

  describe('extractDecisions()', () => {
    it('detects "decided to" pattern', () => {
      const result = summarizer.summarize('g', [
        msg('alice', 'We decided to use TypeScript for all new code'),
      ]);
      expect(result.decisions.some(d => d.toLowerCase().includes('typescript'))).toBe(true);
    });

    it('detects "agreed on" pattern', () => {
      const result = summarizer.summarize('g', [
        msg('bob', 'Everyone agreed on using Vitest as the test runner'),
      ]);
      expect(result.decisions.some(d => d.toLowerCase().includes('vitest'))).toBe(true);
    });

    it('detects "conclusion:" pattern', () => {
      const result = summarizer.summarize('g', [
        msg('charlie', 'Conclusion: ship the feature by Friday'),
      ]);
      expect(result.decisions.some(d => d.toLowerCase().includes('friday'))).toBe(true);
    });

    it('detects "will go with" pattern', () => {
      const result = summarizer.summarize('g', [
        msg('alice', 'We will go with the monorepo approach'),
      ]);
      expect(result.decisions.some(d => d.toLowerCase().includes('monorepo'))).toBe(true);
    });

    it('deduplicates identical decisions', () => {
      const result = summarizer.summarize('g', [
        msg('alice', 'We decided to use React'),
        msg('bob', 'We decided to use React'),
      ]);
      const reactDecisions = result.decisions.filter(d => d.toLowerCase().includes('react'));
      expect(reactDecisions).toHaveLength(1);
    });

    it('returns empty array when no decisions found', () => {
      const result = summarizer.summarize('g', [
        msg('alice', 'Just chatting here'),
        msg('bob', 'Nothing important'),
      ]);
      expect(result.decisions).toEqual([]);
    });
  });

  describe('extractActionItems()', () => {
    it('detects "TODO:" pattern', () => {
      const result = summarizer.summarize('g', [
        msg('alice', 'TODO: write the API documentation'),
      ]);
      expect(result.actionItems.some(a => a.toLowerCase().includes('api documentation'))).toBe(true);
    });

    it("detects \"I'll\" pattern", () => {
      const result = summarizer.summarize('g', [
        msg('bob', "I'll set up the CI pipeline tomorrow"),
      ]);
      expect(result.actionItems.some(a => a.toLowerCase().includes('pipeline'))).toBe(true);
    });

    it('detects "need to:" pattern', () => {
      const result = summarizer.summarize('g', [
        msg('alice', 'need to: update the README with new instructions'),
      ]);
      expect(result.actionItems.some(a => a.toLowerCase().includes('readme'))).toBe(true);
    });

    it('returns empty array when no action items found', () => {
      const result = summarizer.summarize('g', [
        msg('alice', 'Everything is done already!'),
      ]);
      expect(result.actionItems).toEqual([]);
    });

    it('caps action items at 20', () => {
      const many = Array.from({ length: 30 }, (_, i) =>
        msg('alice', `I'll do task number ${i + 1}`, i * 100),
      );
      const result = summarizer.summarize('g', many);
      expect(result.actionItems.length).toBeLessThanOrEqual(20);
    });
  });

  describe('extractTopics()', () => {
    it('returns top keywords from messages', () => {
      const result = summarizer.summarize('g', [
        msg('alice', 'We should discuss the architecture of our microservices'),
        msg('bob', 'The microservices architecture needs careful planning'),
        msg('charlie', 'microservices are important for scalability'),
      ]);
      expect(result.topics).toContain('microservices');
      expect(result.topics).toContain('architecture');
    });

    it('filters stop words', () => {
      const result = summarizer.summarize('g', [
        msg('alice', 'The the the and and or or or is is'),
      ]);
      // Stop words should not appear in topics
      const stopWords = ['the', 'and', 'or', 'is'];
      for (const w of stopWords) {
        expect(result.topics).not.toContain(w);
      }
    });

    it('returns at most 10 topics', () => {
      const result = summarizer.summarize('g', [
        msg('alice', 'apple banana cherry dragonfruit elderberry fig grape honeydew kiwi lemon mango'),
      ]);
      expect(result.topics.length).toBeLessThanOrEqual(10);
    });
  });

  describe('generateSummary()', () => {
    it('mentions participant count and message count', () => {
      const result = summarizer.summarize('team-sync', [
        msg('alice', 'Hi', 0),
        msg('bob', 'Hello', 100),
        msg('charlie', 'Hey', 200),
      ]);
      expect(result.summary).toContain('3 participants');
      expect(result.summary).toContain('3 messages');
    });

    it('mentions decision count when decisions found', () => {
      const result = summarizer.summarize('g', [
        msg('alice', 'We decided to refactor the auth module'),
      ]);
      expect(result.summary).toContain('1 decision(s)');
    });

    it('mentions action item count when action items found', () => {
      const result = summarizer.summarize('g', [
        msg('alice', "I'll refactor the auth module this week"),
      ]);
      expect(result.summary).toContain('1 action item(s)');
    });
  });

  describe('storage and retrieval', () => {
    it('getSummaries() returns all stored summaries', () => {
      summarizer.summarize('g1', [msg('alice', 'hello')]);
      summarizer.summarize('g2', [msg('bob', 'world')]);
      expect(summarizer.getSummaries()).toHaveLength(2);
    });

    it('getSummary() returns by id', () => {
      const s = summarizer.summarize('g', [msg('alice', 'hi')]);
      expect(summarizer.getSummary(s.id)).toEqual(s);
    });

    it('getSummary() returns undefined for unknown id', () => {
      expect(summarizer.getSummary('nonexistent')).toBeUndefined();
    });

    it('getByGroup() filters by groupName', () => {
      summarizer.summarize('alpha', [msg('alice', 'hi')]);
      summarizer.summarize('beta', [msg('bob', 'ho')]);
      summarizer.summarize('alpha', [msg('charlie', 'hey')]);
      const alpha = summarizer.getByGroup('alpha');
      expect(alpha).toHaveLength(2);
      expect(alpha.every(s => s.groupName === 'alpha')).toBe(true);
    });

    it('getSummaries() returns a copy (immutable)', () => {
      summarizer.summarize('g', [msg('alice', 'hi')]);
      const list = summarizer.getSummaries();
      list.push({ id: 'fake' } as any);
      expect(summarizer.getSummaries()).toHaveLength(1);
    });
  });
});
