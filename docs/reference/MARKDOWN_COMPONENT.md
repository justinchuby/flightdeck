# Markdown Component

Reusable React component for rendering markdown content with GFM support, syntax highlighting, and @mention integration.

**Location:** `packages/web/src/components/ui/Markdown.tsx`

## Props

```typescript
interface MarkdownProps {
  /** Markdown text to render */
  text: string;
  /** Agents for @mention resolution (optional) */
  mentionAgents?: MentionAgent[];
  /** Callback when an @mention is clicked */
  onMentionClick?: (agentId: string) => void;
  /** Additional CSS class for the wrapper */
  className?: string;
}
```

## Usage

```tsx
import { Markdown } from '../ui/Markdown';

// Basic — no mentions
<Markdown text={content} />

// With @mention support
<Markdown
  text={msg.content}
  mentionAgents={agents}
  onMentionClick={(id) => selectAgent(id)}
/>
```

## Features

| Feature | Support |
|---------|---------|
| **GFM tables** | ✅ via remark-gfm |
| **Task list checkboxes** | ✅ readonly, accent-styled |
| **Syntax highlighting** | ✅ via rehype-highlight (github-dark-dimmed theme) |
| **Headings (h1–h3)** | ✅ compact sizing |
| **Lists (ul/ol)** | ✅ styled with proper spacing |
| **Blockquotes** | ✅ left-border accent, italic |
| **Links** | ✅ blue-400, open in new tab |
| **Strikethrough** | ✅ via remark-gfm |
| **@mentions** | ✅ preserves existing MentionText system |
| **Fenced code blocks** | ✅ with language-aware highlighting |

## @Mention Integration

When `mentionAgents` is provided, the component wraps paragraph and list-item children in `MentionAwareChildren`, which walks React children and replaces strings matching `/@(?:[a-f0-9]{4,8}|[a-zA-Z][\w-]*)\b/` with `<MentionText>` components from the existing mention system.

This preserves backward compatibility with all existing @mention rendering (tooltips, colored badges, click handlers).

## Dependencies

- `react-markdown` — Core markdown-to-React renderer
- `remark-gfm` — GitHub Flavored Markdown (tables, task lists, strikethrough)
- `rehype-highlight` — Syntax highlighting via highlight.js
- `highlight.js` — Language grammars and theme CSS

## Migration from MarkdownContent

Replace the old hand-rolled `MarkdownContent` component with the new `Markdown` component:

```diff
- import { MarkdownContent } from '../../utils/markdown';
+ import { Markdown } from '../ui/Markdown';

- <MarkdownContent text={content} />
+ <Markdown text={content} />

// With mentions — same prop names
- <MarkdownContent text={msg.text} mentionAgents={agents} onMentionClick={handler} />
+ <Markdown text={msg.text} mentionAgents={agents} onMentionClick={handler} />
```

The old `MarkdownContent` in `utils/markdown.tsx` is still available for unmigrated components. Other exports from `utils/markdown.tsx` (`MentionText`, `AgentIdBadge`, `idColor`, `InlineMarkdown`) remain unchanged and are still used directly by many components.

### Migrated Components

| Component | File |
|-----------|------|
| ArtifactsPanel | `components/ArtifactsPanel/ArtifactsPanel.tsx` |
| DesignPanel | `components/DesignPanel/DesignPanel.tsx` |
| GroupChat | `components/GroupChat/GroupChat.tsx` |
| ChatMessages | `components/LeadDashboard/ChatMessages.tsx` |
| AgentChatPanel | `components/AgentChatPanel/AgentChatPanel.tsx` |
