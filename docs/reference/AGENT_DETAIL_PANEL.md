# AgentDetailPanel

Unified component for displaying agent details in both inline (side panel) and modal (overlay) contexts.

**Location:** `packages/web/src/components/AgentDetailPanel/AgentDetailPanel.tsx`

## Props

```typescript
export interface AgentDetailPanelProps {
  agentId: string;
  /** If present, fetches richer profile data from the teams API */
  teamId?: string;
  /** 'inline' renders as a side panel; 'modal' renders as a centered overlay */
  mode: 'inline' | 'modal';
  onClose: () => void;
}
```

## Usage

```tsx
import AgentDetailPanel from '../AgentDetailPanel';

// As a modal overlay
<AgentDetailPanel
  agentId={selectedAgent}
  mode="modal"
  onClose={() => setSelectedAgent(null)}
/>

// As an inline side panel with team-enriched data
<AgentDetailPanel
  agentId={agentId}
  teamId={currentTeamId}
  mode="inline"
  onClose={handleClose}
/>
```

## Modes

### `mode='modal'`
- Renders as a fixed overlay with dark backdrop
- Centered popup, max-width-2xl
- Escape key closes the modal
- Click outside closes the modal

### `mode='inline'`
- Renders as a side panel within a flex container
- No backdrop overlay
- Fits within parent layout

## Tabs

| Tab | Icon | Content |
|-----|------|---------|
| **Details** | Info | Metadata, current task, token usage, context window, output preview, errors, GitHub issue link |
| **Chat** | MessageSquare | Full message history + send input (via `AgentChatPanel`) |
| **Settings** | Settings | Editable model selector (when agent is alive), provider info, backend display |

## teamId Enrichment

When `teamId` is provided, the component fetches an extended profile from `/teams/:teamId/agents/:agentId/profile`, which includes:

```typescript
interface AgentProfile {
  agentId: string;
  role: string;
  model: string;
  status: string;
  liveStatus: string | null;
  teamId: string;
  projectId: string | null;
  lastTaskSummary: string | null;
  createdAt: string;
  updatedAt: string;
  knowledgeCount: number;
  live: {
    task: string | null;
    outputPreview: string | null;
    model: string | null;
    sessionId: string | null;
    provider: string | null;
    backend: string | null;
    exitError: string | null;
  } | null;
}
```

Without `teamId`, the component falls back to live agent data from the Zustand store, which provides basic fields (status, model, role) but not project-scoped knowledge counts or historical timestamps.

## Replaces

This component replaces both:
- **AgentDetailModal** — legacy modal-only agent detail view
- **ProfilePanel** in UnifiedCrewPage — inline profile display

It is a drop-in replacement with a superset of props.
