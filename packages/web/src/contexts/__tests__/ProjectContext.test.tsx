// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useProjectId } from '../ProjectContext';

describe('useProjectId — outside provider (line 17)', () => {
  it('throws when used outside a ProjectContext provider', () => {
    expect(() => {
      renderHook(() => useProjectId());
    }).toThrow('useProjectId must be used within a project route');
  });
});
