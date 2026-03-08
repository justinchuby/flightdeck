/**
 * Shared tab label mapping for project tabs.
 *
 * Single source of truth — used by ProjectLayout, Breadcrumb,
 * and any component that needs tab ID → display label conversion.
 */
export const TAB_LABELS: Record<string, string> = {
  overview:    'Overview',
  session:     'Session',
  tasks:       'Tasks',
  agents:      'Agents',
  knowledge:   'Knowledge',
  design:      'Design',
  timeline:    'Timeline',
  groups:      'Groups',
  'org-chart': 'Org Chart',
  analytics:   'Analytics',
  canvas:      'Canvas',
};
