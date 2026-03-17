/**
 * Rich Markdown renderer built on react-markdown.
 *
 * Supports GFM (tables, task lists, strikethrough), syntax-highlighted
 * code blocks, and Flightdeck's @mention system. Use this for block-level
 * content like reports, artifacts, and agent messages.
 *
 * For short inline text (single line, no blocks), continue using
 * InlineMarkdown / InlineMarkdownWithMentions from utils/markdown.tsx.
 */
import React, { useMemo } from 'react';
import ReactMarkdown, { type Components, type ExtraProps } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import 'highlight.js/styles/github-dark-dimmed.min.css';
import { MentionText, type MentionAgent } from '../../utils/markdown';

// ── Types ────────────────────────────────────────────────────

interface MarkdownProps {
  /** Markdown text to render */
  text: string;
  /** Agents for @mention resolution (optional) */
  mentionAgents?: MentionAgent[];
  /** Callback when an @mention is clicked */
  onMentionClick?: (agentId: string) => void;
  /** Additional CSS class for the wrapper */
  className?: string;
  /** Use monospace font (JetBrains Mono) for all text — intended for chat contexts */
  monospace?: boolean;
}

// ── Mention-aware text wrapper ───────────────────────────────

/** Walks React children and replaces plain strings containing @mentions */
function MentionAwareChildren({
  children,
  agents,
  onMentionClick,
}: {
  children: React.ReactNode;
  agents: MentionAgent[];
  onMentionClick?: (agentId: string) => void;
}) {
  return (
    <>
      {React.Children.map(children, (child) => {
        if (typeof child === 'string' && /@(?:[a-f0-9]{4,8}|[a-zA-Z][\w-]*)\b/.test(child)) {
          return <MentionText text={child} agents={agents} onClickAgent={onMentionClick} />;
        }
        return child;
      })}
    </>
  );
}

// ── Component ────────────────────────────────────────────────

export function Markdown({ text, mentionAgents, onMentionClick, className, monospace }: MarkdownProps) {
  const hasMentions = mentionAgents && mentionAgents.length > 0;

  const components = useMemo(() => {
    type HtmlProps<T extends keyof React.JSX.IntrinsicElements> = React.JSX.IntrinsicElements[T] & ExtraProps;

    const base: Components = {
      // Code blocks: use highlight.js classes, add copy-friendly styling
      pre: ({ children, ...props }: HtmlProps<'pre'>) => (
        <pre
          className="bg-th-bg border border-th-border rounded-md px-3 py-2 my-2 overflow-x-auto text-xs font-mono text-th-text-alt"
          {...props}
        >
          {children}
        </pre>
      ),
      // Inline code
      code: ({ className: codeClass, children, ...props }: HtmlProps<'code'>) => {
        // If it has a language class, it's inside a <pre> — let highlight.js handle it
        if (codeClass) {
          return <code className={codeClass} {...props}>{children}</code>;
        }
        return (
          <code className="bg-th-bg-muted px-1 rounded text-yellow-600 dark:text-yellow-300 text-[0.9em]" {...props}>
            {children}
          </code>
        );
      },
      // Tables: match existing Flightdeck table styling
      table: ({ children }: HtmlProps<'table'>) => (
        <div className="my-2 overflow-x-auto">
          <table className="text-xs font-mono border-collapse border border-th-border w-full">
            {children}
          </table>
        </div>
      ),
      thead: ({ children }: HtmlProps<'thead'>) => <thead>{children}</thead>,
      th: ({ children }: HtmlProps<'th'>) => (
        <th className="border border-th-border px-2 py-1 text-left text-th-text-alt font-semibold bg-th-bg-alt">
          {children}
        </th>
      ),
      td: ({ children }: HtmlProps<'td'>) => (
        <td className="border border-th-border px-2 py-1 text-th-text-alt">{children}</td>
      ),
      // Headings: compact sizing for dashboard context
      h1: ({ children }: HtmlProps<'h1'>) => <h1 className="text-base font-bold text-th-text-alt mt-3 mb-1">{children}</h1>,
      h2: ({ children }: HtmlProps<'h2'>) => <h2 className="text-sm font-bold text-th-text-alt mt-3 mb-1">{children}</h2>,
      h3: ({ children }: HtmlProps<'h3'>) => <h3 className="text-xs font-bold text-th-text-alt mt-2 mb-0.5 uppercase tracking-wider">{children}</h3>,
      // Lists
      ul: ({ children }: HtmlProps<'ul'>) => <ul className="list-disc list-inside ml-2 my-1 space-y-0.5">{children}</ul>,
      ol: ({ children }: HtmlProps<'ol'>) => <ol className="list-decimal list-inside ml-2 my-1 space-y-0.5">{children}</ol>,
      li: ({ children }: HtmlProps<'li'>) => <li className="text-th-text-alt text-xs">{children}</li>,
      // Blockquotes
      blockquote: ({ children }: HtmlProps<'blockquote'>) => (
        <blockquote className="border-l-2 border-th-border pl-3 my-2 text-th-text-muted italic">
          {children}
        </blockquote>
      ),
      // Horizontal rule
      hr: () => <hr className="border-th-border my-3" />,
      // Links
      a: ({ href, children }: HtmlProps<'a'>) => (
        <a href={href} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300 underline">
          {children}
        </a>
      ),
      // Task list checkboxes
      input: ({ type, checked, ...props }: HtmlProps<'input'>) => {
        if (type === 'checkbox') {
          return (
            <input
              type="checkbox"
              checked={checked}
              readOnly
              className="mr-1 accent-yellow-500"
              {...props}
            />
          );
        }
        return <input type={type} {...props} />;
      },
    };

    // Inject @mention rendering into paragraph and list item text
    if (hasMentions) {
      base.p = ({ children }: HtmlProps<'p'>) => (
        <p className="my-1">
          <MentionAwareChildren agents={mentionAgents!} onMentionClick={onMentionClick}>
            {children}
          </MentionAwareChildren>
        </p>
      );
      base.li = ({ children }: HtmlProps<'li'>) => (
        <li className="text-th-text-alt text-xs">
          <MentionAwareChildren agents={mentionAgents!} onMentionClick={onMentionClick}>
            {children}
          </MentionAwareChildren>
        </li>
      );
    }

    return base;
  }, [hasMentions, mentionAgents, onMentionClick]);

  return (
    <div className={`markdown-content text-xs text-th-text-alt leading-relaxed ${monospace ? 'font-mono' : ''} ${className ?? ''}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={components}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
