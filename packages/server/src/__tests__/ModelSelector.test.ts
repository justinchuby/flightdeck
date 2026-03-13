import { describe, it, expect, beforeEach } from 'vitest';
import {
  ModelSelector,
  AVAILABLE_MODELS,
  type ModelConfig,
  type TaskProfile,
} from '../agents/ModelSelector.js';

describe('ModelSelector', () => {
  let selector: ModelSelector;

  beforeEach(() => {
    selector = new ModelSelector();
  });

  // ── 1. Complexity-based selection ────────────────────────────────────

  it('selects a fast-tier model for low complexity', () => {
    const task: TaskProfile = {
      role: 'developer',
      description: 'fix a typo in the readme',
      estimatedComplexity: 'low',
    };
    const model = selector.selectModel(task);
    expect(model.tier).toBe('fast');
  });

  it('selects a standard-tier model for medium (default) complexity', () => {
    const task: TaskProfile = {
      role: 'developer',
      description: 'implement a new endpoint',
    };
    const model = selector.selectModel(task);
    expect(model.tier).toBe('standard');
  });

  it('selects a standard-tier model for high complexity', () => {
    const task: TaskProfile = {
      role: 'developer',
      description: 'debug a tricky race condition',
      estimatedComplexity: 'high',
    };
    const model = selector.selectModel(task);
    expect(model.tier).toBe('standard');
  });

  it('selects a premium-tier model for critical complexity', () => {
    const task: TaskProfile = {
      role: 'architect',
      description: 'design the overall system architecture',
      estimatedComplexity: 'critical',
    };
    const model = selector.selectModel(task);
    expect(model.tier).toBe('premium');
  });

  // ── 2. Budget constraint overrides complexity ────────────────────────

  it('honours budgetConstraint: fast even for critical complexity', () => {
    const task: TaskProfile = {
      role: 'developer',
      description: 'critical architecture review',
      estimatedComplexity: 'critical',
      budgetConstraint: 'fast',
    };
    const model = selector.selectModel(task);
    expect(model.tier).toBe('fast');
  });

  it('honours budgetConstraint: premium even for low complexity', () => {
    const task: TaskProfile = {
      role: 'developer',
      description: 'simple formatting fix',
      estimatedComplexity: 'low',
      budgetConstraint: 'premium',
    };
    const model = selector.selectModel(task);
    expect(model.tier).toBe('premium');
  });

  // ── 3. Role overrides take highest priority ──────────────────────────

  it('returns the pinned model when a role override is set', () => {
    selector.setRoleOverride('architect', 'claude-opus-4-6');
    const task: TaskProfile = {
      role: 'architect',
      description: 'design the database schema',
      estimatedComplexity: 'low', // would normally pick fast tier
    };
    const model = selector.selectModel(task);
    expect(model.id).toBe('claude-opus-4-6');
  });

  it('ignores override for other roles', () => {
    selector.setRoleOverride('architect', 'claude-opus-4-6');
    const task: TaskProfile = {
      role: 'developer',
      description: 'write tests',
      estimatedComplexity: 'low',
    };
    const model = selector.selectModel(task);
    expect(model.tier).toBe('fast'); // no override for developer
  });

  it('falls back to complexity selection after removeRoleOverride', () => {
    selector.setRoleOverride('architect', 'claude-opus-4-6');
    selector.removeRoleOverride('architect');

    const task: TaskProfile = {
      role: 'architect',
      description: 'simple docs update',
      estimatedComplexity: 'low',
    };
    const model = selector.selectModel(task);
    expect(model.tier).toBe('fast');
  });

  // ── 4. Large-context preference ──────────────────────────────────────

  it('prefers large-context model when requiresLargeContext is set', () => {
    const task: TaskProfile = {
      role: 'developer',
      description: 'analyse multi-file codebase',
      estimatedComplexity: 'high',
      requiresLargeContext: true,
    };
    const model = selector.selectModel(task);
    expect(model.contextWindow).toBeGreaterThanOrEqual(500_000);
  });

  it('does NOT force large-context model when flag is absent', () => {
    const task: TaskProfile = {
      role: 'developer',
      description: 'analyse multi-file codebase',
      estimatedComplexity: 'high',
    };
    const model = selector.selectModel(task);
    // At least one standard model has contextWindow < 500k, so result is not forced
    // Just ensure we still get a valid standard model
    expect(model.tier).toBe('standard');
  });

  // ── 5. Keyword scoring selects the best-fit model ───────────────────

  it('scores keyword matches to pick the best model in tier', () => {
    // "code-generation" maps to gpt-5.3-codex bestFor tags
    const task: TaskProfile = {
      role: 'developer',
      description: 'code generation for new module',
      estimatedComplexity: 'high',
    };
    const model = selector.selectModel(task);
    // gpt-5.3-codex has bestFor: ['code-generation', 'implementation', 'testing']
    expect(model.id).toBe('gpt-5.3-codex');
  });

  it('falls back to first candidate when no keywords match', () => {
    const task: TaskProfile = {
      role: 'developer',
      description: 'xyzzy nonsense task',
      estimatedComplexity: 'low',
    };
    const model = selector.selectModel(task);
    expect(model.tier).toBe('fast');
    // Should still return a valid model
    expect(AVAILABLE_MODELS.map((m) => m.id)).toContain(model.id);
  });

  // ── 6. getRoleOverrides / getModels ─────────────────────────────────

  it('getRoleOverrides returns all set overrides', () => {
    selector.setRoleOverride('lead', 'claude-opus-4-6');
    selector.setRoleOverride('tester', 'claude-3-5-haiku');
    const overrides = selector.getRoleOverrides();
    expect(overrides).toEqual({
      lead: 'claude-opus-4-6',
      tester: 'claude-3-5-haiku',
    });
  });

  it('getModels returns a copy of all available models', () => {
    const models = selector.getModels();
    expect(models).toHaveLength(AVAILABLE_MODELS.length);
    // Mutating the returned array does not affect the selector
    models.pop();
    expect(selector.getModels()).toHaveLength(AVAILABLE_MODELS.length);
  });

  // ── 7. Invalid override model id is ignored gracefully ───────────────

  it('ignores a role override pointing to a non-existent model id', () => {
    selector.setRoleOverride('developer', 'no-such-model-xyz');
    const task: TaskProfile = {
      role: 'developer',
      description: 'write some tests',
      estimatedComplexity: 'high',
    };
    const model = selector.selectModel(task);
    // Falls through to complexity-based selection
    expect(model.tier).toBe('standard');
  });
});
