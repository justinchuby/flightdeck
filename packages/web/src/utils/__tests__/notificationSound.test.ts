import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { playAttentionSound, playCompletionSound } from '../notificationSound';

// notificationSound uses Web Audio API which doesn't exist in jsdom.
// The functions swallow errors internally via try/catch.

describe('notificationSound', () => {
  it('playAttentionSound resolves without error in test environment', async () => {
    await expect(playAttentionSound()).resolves.toBeUndefined();
  });

  it('playCompletionSound resolves without error in test environment', async () => {
    await expect(playCompletionSound()).resolves.toBeUndefined();
  });

  it('calling both in sequence does not throw', async () => {
    await playAttentionSound();
    await playCompletionSound();
    await playAttentionSound();
  });
});

// ── Web Audio API Mock ────────────────────────────────────────────────

function createMockGainNode() {
  return {
    gain: {
      value: 0,
      setValueAtTime: vi.fn(),
      exponentialRampToValueAtTime: vi.fn(),
      linearRampToValueAtTime: vi.fn(),
    },
    connect: vi.fn(),
  };
}

function createMockOscillator() {
  return {
    type: 'sine' as string,
    frequency: { value: 0 },
    connect: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
  };
}

type MockOsc = ReturnType<typeof createMockOscillator>;
type MockGain = ReturnType<typeof createMockGainNode>;

let constructorCallCount = 0;
let capturedOscillators: MockOsc[] = [];
let capturedGains: MockGain[] = [];
let mockState = 'running';
let mockResume: ReturnType<typeof vi.fn>;

class MockAudioContext {
  state = mockState;
  currentTime = 100;
  destination = {};
  resume = mockResume;

  createOscillator = vi.fn(() => {
    const osc = createMockOscillator();
    capturedOscillators.push(osc);
    return osc;
  });

  createGain = vi.fn(() => {
    const gain = createMockGainNode();
    capturedGains.push(gain);
    return gain;
  });

  constructor() {
    constructorCallCount++;
  }
}

describe('notificationSound — with mocked Web Audio', () => {
  beforeEach(() => {
    vi.resetModules();
    constructorCallCount = 0;
    capturedOscillators = [];
    capturedGains = [];
    mockState = 'running';
    mockResume = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('AudioContext', MockAudioContext);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('playAttentionSound', () => {
    it('creates two oscillators for two-note chime', async () => {
      const { playAttentionSound: play } = await import('../notificationSound');
      await play();
      expect(capturedOscillators).toHaveLength(2);
      expect(capturedGains).toHaveLength(2);
    });

    it('uses correct frequencies (A5=880, D6=1175)', async () => {
      const { playAttentionSound: play } = await import('../notificationSound');
      await play();
      expect(capturedOscillators[0].frequency.value).toBe(880);
      expect(capturedOscillators[1].frequency.value).toBe(1175);
    });

    it('connects oscillators through gain nodes to destination', async () => {
      const { playAttentionSound: play } = await import('../notificationSound');
      await play();
      expect(capturedGains[0].connect).toHaveBeenCalled();
      expect(capturedGains[1].connect).toHaveBeenCalled();
    });

    it('starts oscillators with correct timing offsets', async () => {
      const { playAttentionSound: play } = await import('../notificationSound');
      await play();
      expect(capturedOscillators[0].start).toHaveBeenCalledWith(100);
      expect(capturedOscillators[0].stop).toHaveBeenCalledWith(100 + 0.3);
      expect(capturedOscillators[1].start).toHaveBeenCalledWith(100 + 0.15);
      expect(capturedOscillators[1].stop).toHaveBeenCalledWith(100 + 0.5);
    });

    it('resumes suspended AudioContext', async () => {
      mockState = 'suspended';
      const { playAttentionSound: play } = await import('../notificationSound');
      await play();
      expect(mockResume).toHaveBeenCalled();
    });

    it('does not resume running AudioContext', async () => {
      mockState = 'running';
      const { playAttentionSound: play } = await import('../notificationSound');
      await play();
      expect(mockResume).not.toHaveBeenCalled();
    });
  });

  describe('playCompletionSound', () => {
    it('creates one oscillator for single-note chime', async () => {
      const { playCompletionSound: play } = await import('../notificationSound');
      await play();
      expect(capturedOscillators).toHaveLength(1);
      expect(capturedGains).toHaveLength(1);
    });

    it('uses correct frequency (C6=1047)', async () => {
      const { playCompletionSound: play } = await import('../notificationSound');
      await play();
      expect(capturedOscillators[0].frequency.value).toBe(1047);
    });

    it('sets correct gain envelope', async () => {
      const { playCompletionSound: play } = await import('../notificationSound');
      await play();
      expect(capturedGains[0].gain.setValueAtTime).toHaveBeenCalledWith(0.15, 100);
      expect(capturedGains[0].gain.exponentialRampToValueAtTime).toHaveBeenCalledWith(0.001, 100 + 0.4);
    });

    it('resumes suspended AudioContext', async () => {
      mockState = 'suspended';
      const { playCompletionSound: play } = await import('../notificationSound');
      await play();
      expect(mockResume).toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    it('swallows errors silently when AudioContext throws', async () => {
      vi.stubGlobal('AudioContext', class { constructor() { throw new Error('Audio not supported'); } });
      const { playAttentionSound: play } = await import('../notificationSound');
      await expect(play()).resolves.toBeUndefined();
    });

    it('swallows errors when oscillator fails', async () => {
      vi.stubGlobal('AudioContext', class extends MockAudioContext {
        createOscillator = vi.fn(() => { throw new Error('Oscillator failed'); });
      });
      const { playCompletionSound: play } = await import('../notificationSound');
      await expect(play()).resolves.toBeUndefined();
    });
  });

  describe('AudioContext singleton', () => {
    it('reuses the same AudioContext across calls', async () => {
      const { playAttentionSound: playAttn, playCompletionSound: playComp } = await import('../notificationSound');
      await playAttn();
      await playComp();
      expect(constructorCallCount).toBe(1);
    });
  });
});
