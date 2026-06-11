import { describe, it, expect } from 'vitest';
import {
  DEFAULT_MODEL_CONFIG,
  DEFAULT_MODEL,
  KNOWN_MODEL_IDS,
} from '../projects/ModelConfigDefaults.js';
import { AVAILABLE_MODELS } from '../agents/ModelSelector.js';
import { RoleRegistry } from '../agents/RoleRegistry.js';
import { DEFAULT_KNOWN_MODELS } from '../config/configSchema.js';

/**
 * Cross-check that the several hardcoded model-ID sources in the server package
 * stay consistent with each other. This prevents the kind of silent drift where
 * a role's `model:` in RoleRegistry disagrees with DEFAULT_MODEL_CONFIG, or where
 * a default/metadata entry references a model ID that isn't in the allow-list.
 */
describe('Model config consistency', () => {
  const knownSet = new Set<string>(KNOWN_MODEL_IDS);
  // No-DB registry exposes only the built-in roles via get()/getAll().
  const registry = new RoleRegistry();

  it('every DEFAULT_MODEL_CONFIG model ID is in KNOWN_MODEL_IDS', () => {
    for (const [role, models] of Object.entries(DEFAULT_MODEL_CONFIG)) {
      for (const id of models) {
        expect(knownSet.has(id), `DEFAULT_MODEL_CONFIG["${role}"] references unknown model "${id}"`).toBe(true);
      }
    }
  });

  it('every ModelSelector.AVAILABLE_MODELS id is in KNOWN_MODEL_IDS', () => {
    for (const model of AVAILABLE_MODELS) {
      expect(knownSet.has(model.id), `AVAILABLE_MODELS entry "${model.id}" is not in KNOWN_MODEL_IDS`).toBe(true);
    }
  });

  it("each role's RoleRegistry model matches DEFAULT_MODEL_CONFIG[role][0]", () => {
    for (const [role, models] of Object.entries(DEFAULT_MODEL_CONFIG)) {
      const def = registry.get(role);
      // Every role with a default config must exist as a built-in role.
      expect(def, `RoleRegistry has no built-in role for "${role}"`).toBeDefined();

      const expected = models[0];
      if (def!.model === undefined) {
        // A built-in role without an explicit model falls back to DEFAULT_MODEL.
        // In that case the default config's first entry must equal DEFAULT_MODEL.
        expect(expected, `Role "${role}" has no model in RoleRegistry, so its default should be DEFAULT_MODEL`).toBe(
          DEFAULT_MODEL,
        );
      } else {
        expect(def!.model, `RoleRegistry model for "${role}" must equal DEFAULT_MODEL_CONFIG["${role}"][0]`).toBe(
          expected,
        );
      }
    }
  });

  it('every built-in role with a model uses a known model ID', () => {
    for (const role of registry.getAll()) {
      if (role.model) {
        expect(knownSet.has(role.model), `Built-in role "${role.id}" uses unknown model "${role.model}"`).toBe(true);
      }
    }
  });

  it('configSchema DEFAULT_KNOWN_MODELS matches KNOWN_MODEL_IDS exactly', () => {
    expect([...DEFAULT_KNOWN_MODELS]).toEqual([...KNOWN_MODEL_IDS]);
    // Must be a distinct copy so mutating the config default can't corrupt the canonical list.
    expect(DEFAULT_KNOWN_MODELS as unknown).not.toBe(KNOWN_MODEL_IDS as unknown);
  });
});
