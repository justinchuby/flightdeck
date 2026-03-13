import { describe, it, expect } from 'vitest';
import { loadConfig } from '../config/ConfigLoader.js';
import { getDefaultConfig, type FlightdeckConfig } from '../config/configSchema.js';

describe('ConfigLoader', () => {
  it('parses valid YAML config with all sections', () => {
    const yaml = `
server:
  maxConcurrentAgents: 25
heartbeat:
  idleThresholdMs: 30000
  crewUpdateIntervalMs: 120000
  staleTimerCleanupDays: 3
models:
  known:
    - claude-opus-4.6
    - gpt-5.2
  defaults:
    developer: [claude-opus-4.6]
roles:
  developer:
    model: claude-sonnet-4.6
budget:
  limit: 100
  thresholds:
    warning: 0.5
    critical: 0.8
    pause: 0.95
`;
    const result = loadConfig(yaml, null);
    expect(result.config.server.maxConcurrentAgents).toBe(25);
    expect(result.config.heartbeat.idleThresholdMs).toBe(30000);
    expect(result.config.models.known).toEqual(['claude-opus-4.6', 'gpt-5.2']);
    expect(result.config.models.defaults.developer).toEqual(['claude-opus-4.6']);
    expect(result.config.roles.developer?.model).toBe('claude-sonnet-4.6');
    expect(result.config.budget.limit).toBe(100);
    expect(result.config.budget.thresholds?.warning).toBe(0.5);
    expect(result.diffs).toEqual([]); // no previous → no diffs
  });

  it('parses minimal config (empty file → all defaults)', () => {
    const result = loadConfig('', null);
    const defaults = getDefaultConfig();
    expect(result.config.server.maxConcurrentAgents).toBe(defaults.server.maxConcurrentAgents);
    expect(result.config.heartbeat.idleThresholdMs).toBe(defaults.heartbeat.idleThresholdMs);
    expect(result.config.models.known.length).toBeGreaterThan(0);
    expect(result.config.budget.limit).toBeNull();
  });

  it('rejects invalid YAML syntax', () => {
    expect(() => loadConfig('  - bad: [unclosed', null)).toThrow(/parse error/i);
  });

  it('rejects invalid values (e.g. maxConcurrentAgents: -1)', () => {
    expect(() => loadConfig('server:\n  maxConcurrentAgents: -1', null)).toThrow(/validation failed/i);
  });

  it('fills defaults for missing sections', () => {
    const result = loadConfig('server:\n  maxConcurrentAgents: 10\n', null);
    expect(result.config.server.maxConcurrentAgents).toBe(10);
    // Other sections should have defaults
    expect(result.config.heartbeat.idleThresholdMs).toBe(60_000);
    expect(result.config.models.known.length).toBeGreaterThan(0);
  });

  it('computes diffs correctly between two configs', () => {
    const prev = getDefaultConfig();
    const yaml = 'server:\n  maxConcurrentAgents: 25\n';
    const result = loadConfig(yaml, prev);

    const serverDiffs = result.diffs.filter(d => d.section === 'server');
    expect(serverDiffs.length).toBe(1);
    expect(serverDiffs[0].field).toBe('maxConcurrentAgents');
    expect(serverDiffs[0].oldValue).toBe(50);
    expect(serverDiffs[0].newValue).toBe(25);
  });

  it('computes empty diffs when configs are identical', () => {
    const prev = getDefaultConfig();
    const result = loadConfig('', prev);
    expect(result.diffs).toEqual([]);
  });

  it('handles only server section specified', () => {
    const prev: FlightdeckConfig = {
      ...getDefaultConfig(),
      server: { maxConcurrentAgents: 10 },
    };
    const yaml = 'server:\n  maxConcurrentAgents: 10\n';
    const result = loadConfig(yaml, prev);
    // Only server is specified; other sections should still match defaults → no diffs from them
    // Actually the new config will fill defaults for heartbeat/models/etc
    // and prev also has defaults, so diffs should be empty
    expect(result.diffs.filter(d => d.section === 'server')).toHaveLength(0);
  });

  it('validates budget thresholds are numbers between 0 and 1', () => {
    expect(() => loadConfig('budget:\n  thresholds:\n    warning: 1.5\n', null))
      .toThrow(/validation failed/i);
  });

  it('accepts null budget limit', () => {
    const result = loadConfig('budget:\n  limit: null\n', null);
    expect(result.config.budget.limit).toBeNull();
  });

  it('accepts numeric budget limit', () => {
    const result = loadConfig('budget:\n  limit: 50\n', null);
    expect(result.config.budget.limit).toBe(50);
  });
});
