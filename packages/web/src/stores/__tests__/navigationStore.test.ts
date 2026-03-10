import { describe, it, expect, beforeEach } from 'vitest';
import { useNavigationStore, type NavEntry } from '../navigationStore';

describe('navigationStore', () => {
  beforeEach(() => {
    useNavigationStore.setState({
      currentProjectId: null,
      currentProjectName: null,
      activeTab: null,
      history: [],
      forward: [],
      badges: {},
    });
  });

  // ── Project context ───────────────────────────────────────

  it('sets current project with name', () => {
    useNavigationStore.getState().setProject('proj-1', 'My Project');
    const s = useNavigationStore.getState();
    expect(s.currentProjectId).toBe('proj-1');
    expect(s.currentProjectName).toBe('My Project');
  });

  it('clears project context', () => {
    useNavigationStore.getState().setProject('proj-1', 'My Project');
    useNavigationStore.getState().setProject(null);
    const s = useNavigationStore.getState();
    expect(s.currentProjectId).toBeNull();
    expect(s.currentProjectName).toBeNull();
  });

  // ── Active tab ────────────────────────────────────────────

  it('tracks active tab', () => {
    useNavigationStore.getState().setActiveTab('session');
    expect(useNavigationStore.getState().activeTab).toBe('session');
  });

  it('clears active tab', () => {
    useNavigationStore.getState().setActiveTab('tasks');
    useNavigationStore.getState().setActiveTab(null);
    expect(useNavigationStore.getState().activeTab).toBeNull();
  });

  // ── History stack ─────────────────────────────────────────

  it('pushes navigation entries', () => {
    const { pushEntry } = useNavigationStore.getState();
    pushEntry({ path: '/projects', label: 'Projects' });
    pushEntry({ path: '/projects/abc/overview', projectId: 'abc', tab: 'overview' });
    expect(useNavigationStore.getState().history).toHaveLength(2);
  });

  it('deduplicates consecutive same-path pushes', () => {
    const { pushEntry } = useNavigationStore.getState();
    pushEntry({ path: '/projects/abc/session' });
    pushEntry({ path: '/projects/abc/session' });
    expect(useNavigationStore.getState().history).toHaveLength(1);
  });

  it('clears forward stack on new push', () => {
    const store = useNavigationStore.getState();
    store.pushEntry({ path: '/a' });
    store.pushEntry({ path: '/b' });
    store.pushEntry({ path: '/c' });
    store.goBack();
    expect(useNavigationStore.getState().forward).toHaveLength(1);
    useNavigationStore.getState().pushEntry({ path: '/d' });
    expect(useNavigationStore.getState().forward).toHaveLength(0);
  });

  it('caps history at 50 entries', () => {
    const { pushEntry } = useNavigationStore.getState();
    for (let i = 0; i < 60; i++) {
      pushEntry({ path: `/page-${i}` });
    }
    expect(useNavigationStore.getState().history).toHaveLength(50);
    expect(useNavigationStore.getState().history[49]!.path).toBe('/page-59');
  });

  // ── Back / Forward ────────────────────────────────────────

  it('goBack returns previous entry and updates state', () => {
    const store = useNavigationStore.getState();
    store.pushEntry({ path: '/a', projectId: 'p1', tab: 'overview' });
    store.pushEntry({ path: '/b', projectId: 'p2', tab: 'tasks' });

    const prev = useNavigationStore.getState().goBack();
    expect(prev?.path).toBe('/a');

    const s = useNavigationStore.getState();
    expect(s.history).toHaveLength(1);
    expect(s.forward).toHaveLength(1);
    expect(s.currentProjectId).toBe('p1');
    expect(s.activeTab).toBe('overview');
  });

  it('goBack returns null when history is too short', () => {
    useNavigationStore.getState().pushEntry({ path: '/only' });
    expect(useNavigationStore.getState().goBack()).toBeNull();
  });

  it('goForward restores entry from forward stack', () => {
    const store = useNavigationStore.getState();
    store.pushEntry({ path: '/a' });
    store.pushEntry({ path: '/b', projectId: 'p2', tab: 'session' });
    useNavigationStore.getState().goBack();

    const next = useNavigationStore.getState().goForward();
    expect(next?.path).toBe('/b');

    const s = useNavigationStore.getState();
    expect(s.forward).toHaveLength(0);
    expect(s.history).toHaveLength(2);
    expect(s.currentProjectId).toBe('p2');
    expect(s.activeTab).toBe('session');
  });

  it('goForward returns null when stack is empty', () => {
    expect(useNavigationStore.getState().goForward()).toBeNull();
  });

  // ── Badge counts ──────────────────────────────────────────

  it('sets and reads badge counts', () => {
    const store = useNavigationStore.getState();
    store.setBadge('unread', 5);
    store.setBadge('decisions', 2);
    const badges = useNavigationStore.getState().badges;
    expect(badges.unread).toBe(5);
    expect(badges.decisions).toBe(2);
  });

  it('clears all badges', () => {
    const store = useNavigationStore.getState();
    store.setBadge('unread', 3);
    store.clearBadges();
    expect(useNavigationStore.getState().badges).toEqual({});
  });
});
