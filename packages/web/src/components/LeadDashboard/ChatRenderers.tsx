import { useState } from 'react';
import { ChevronDown, ChevronRight, Lightbulb, FolderOpen } from 'lucide-react';
import { useAppStore } from '../../stores/appStore';
import { InlineMarkdownWithMentions } from '../../utils/markdown';
import { splitCommandBlocks } from '../../utils/commandParser';
import type { AcpTextChunk } from '../../types';

export function InlineMarkdown({ text }: { text: string }) {
  const agents = useAppStore((s) => s.agents);
  return <InlineMarkdownWithMentions text={text} mentionAgents={agents} onMentionClick={(id) => useAppStore.getState().setSelectedAgent(id)} />;
}

/** Renders agent text, separating ⟦⟦ command ⟧⟧ blocks from normal markdown */
export function RichContentBlock({ msg }: { msg: AcpTextChunk }) {
  if (msg.contentType === 'image' && msg.data) {
    return (
      <div className="py-1">
        <img
          src={`data:${msg.mimeType || 'image/png'};base64,${msg.data}`}
          alt="Agent image"
          className="max-w-full max-h-96 rounded-lg border border-th-border"
        />
        {msg.uri && <p className="text-[10px] text-th-text-muted mt-1 font-mono">{msg.uri}</p>}
      </div>
    );
  }
  if (msg.contentType === 'audio' && msg.data) {
    return (
      <div className="py-1">
        <audio controls className="max-w-full">
          <source src={`data:${msg.mimeType || 'audio/wav'};base64,${msg.data}`} type={msg.mimeType || 'audio/wav'} />
        </audio>
      </div>
    );
  }
  if (msg.contentType === 'resource') {
    return (
      <div className="py-1">
        {msg.uri && (
          <div className="flex items-center gap-1.5 text-xs text-blue-400 mb-1">
            <FolderOpen className="w-3 h-3" />
            <span className="font-mono">{msg.uri}</span>
          </div>
        )}
        {msg.text && (
          <pre className="text-xs font-mono text-th-text-alt bg-th-bg-alt border border-th-border rounded p-2 overflow-x-auto max-h-60 overflow-y-auto whitespace-pre-wrap">
            {msg.text}
          </pre>
        )}
      </div>
    );
  }
  return null;
}

/** Collapsed-by-default reasoning block for lead thinking — click to expand */
export function CollapsibleReasoningBlock({ text, timestamp }: { text: string; timestamp: string }) {
  if (!text?.trim()) return null;
  const [expanded, setExpanded] = useState(false);
  const preview = text.replace(/[\n\r]+/g, ' ').slice(0, 80);
  return (
    <div className="py-0.5">
      <div
        className="flex items-start gap-2 cursor-pointer group"
        onClick={() => setExpanded((e) => !e)}
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1 text-xs text-th-text-muted">
            {expanded ? <ChevronDown className="w-3 h-3 shrink-0" /> : <ChevronRight className="w-3 h-3 shrink-0" />}
            <Lightbulb className="w-3 h-3 shrink-0" />
            <span className="italic">Reasoning</span>
            {!expanded && preview && <span className="text-th-text-muted/60 truncate ml-1">— {preview}{text.length > 80 ? '…' : ''}</span>}
          </div>
          {expanded && (
            <div className="mt-1 ml-5 font-mono text-xs text-th-text-muted italic whitespace-pre-wrap max-h-60 overflow-y-auto">
              {text}
            </div>
          )}
        </div>
        <span className="text-[10px] text-th-text-muted mt-0.5 shrink-0">{timestamp}</span>
      </div>
    </div>
  );
}

/** Collapsed-by-default ⟦⟦ command ⟧⟧ block with click to expand */
export function CollapsibleCommandBlock({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const nameMatch = text.match(/⟦⟦\s*(\w+)/);
  const label = nameMatch ? nameMatch[1] : 'command';
  // Extract a preview from the JSON payload
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  let preview = '';
  if (jsonMatch) {
    try {
      const obj = JSON.parse(jsonMatch[0]);
      // Show only the first string field as a short one-line preview
      for (const [k, v] of Object.entries(obj)) {
        if (typeof v === 'string') {
          const flat = v.replace(/[\n\r]+/g, ' ');
          preview = `${k}: ${flat.length > 80 ? flat.slice(0, 77) + '...' : flat}`;
          break;
        }
      }
    } catch {
      preview = jsonMatch[0].replace(/[\n\r]+/g, ' ').slice(0, 80);
    }
  }
  return (
    <div
      className="my-1 px-2 py-1 bg-th-bg-alt/80 border border-th-border rounded text-[11px] text-th-text-alt cursor-pointer hover:border-th-border-hover transition-colors"
      onClick={() => setExpanded((e) => !e)}
    >
      <div className="flex items-center gap-1 min-w-0 overflow-hidden">
        {expanded ? <ChevronDown className="w-3 h-3 shrink-0" /> : <ChevronRight className="w-3 h-3 shrink-0" />}
        <span className="font-mono text-th-text-alt shrink-0">{label}</span>
        {!expanded && preview && <span className="font-mono text-th-text-muted ml-1 truncate">— {preview}</span>}
      </div>
      {expanded && <pre className="mt-1 whitespace-pre-wrap break-words text-th-text-muted">{text}</pre>}
    </div>
  );
}

/** Check if a ⟦⟦ ... ⟧⟧ block looks like a real command (ALL_CAPS name after ⟦⟦) */
export function isRealCommandBlock(text: string): boolean {
  return /^⟦⟦\s*[A-Z][A-Z_]{2,}/.test(text);
}

export function AgentTextBlock({ text }: { text: string }) {
  // Depth-aware split handles nested ⟦⟦ ⟧⟧ inside command JSON payloads
  const segments = splitCommandBlocks(text);
  return (
    <>
      {segments.map((seg, i) => {
        // Complete ⟦⟦ ⟧⟧ block — only collapse if it looks like a real command
        if (seg.startsWith('⟦⟦') && seg.endsWith('⟧⟧')) {
          if (isRealCommandBlock(seg)) {
            return <CollapsibleCommandBlock key={i} text={seg} />;
          }
          return <MarkdownWithTables key={i} text={seg} />;
        }
        // Unclosed ⟦⟦ block (still streaming or split across messages)
        if (seg.startsWith('⟦⟦')) {
          if (isRealCommandBlock(seg)) {
            return <CollapsibleCommandBlock key={i} text={seg} />;
          }
          return <MarkdownWithTables key={i} text={seg} />;
        }
        // Dangling ⟧⟧ from a block that started in a previous message
        if (seg.includes('⟧⟧') && !seg.includes('⟦⟦')) {
          const idx = seg.indexOf('⟧⟧') + 2;
          const cmdBlock = seg.slice(0, idx);
          const after = seg.slice(idx);
          return (
            <span key={i}>
              <CollapsibleCommandBlock text={cmdBlock} />
              {after.trim() ? <MarkdownWithTables text={after} /> : null}
            </span>
          );
        }
        if (!seg.trim()) return null;
        return <MarkdownWithTables key={i} text={seg} />;
      })}
    </>
  );
}

/** Detect markdown tables and code fences, render them; pass other text to InlineMarkdown */
export function MarkdownWithTables({ text }: { text: string }) {
  // Match contiguous lines that look like table rows (start with |)
  const TABLE_RE = /((?:^|\n)\|[^\n]+\|[ \t]*(?:\n\|[^\n]+\|[ \t]*)+)/g;
  const parts = text.split(TABLE_RE);

  return (
    <>
      {parts.map((part, i) => {
        const trimmed = part.trim();
        if (trimmed.startsWith('|') && trimmed.includes('\n')) {
          return <MarkdownTable key={i} raw={trimmed} />;
        }
        if (!trimmed) return null;
        return <BlockMarkdown key={i} text={part} />;
      })}
    </>
  );
}

/** Block-level markdown: splits on fenced code blocks, delegates non-code to InlineMarkdown */
export function BlockMarkdown({ text }: { text: string }) {
  const CODE_BLOCK_RE = /(```[\s\S]*?```)/g;
  const segments = text.split(CODE_BLOCK_RE);
  if (segments.length === 1) return <InlineMarkdown text={text} />;
  return (
    <>
      {segments.map((seg, i) => {
        if (seg.startsWith('```') && seg.endsWith('```')) {
          const inner = seg.slice(3, -3);
          const newlineIdx = inner.indexOf('\n');
          const content = newlineIdx >= 0 ? inner.slice(newlineIdx + 1) : inner;
          return (
            <pre key={i} className="bg-th-bg-alt border border-th-border rounded-md px-3 py-2 my-1.5 overflow-x-auto text-xs font-mono text-th-text-alt whitespace-pre">
              <code>{content}</code>
            </pre>
          );
        }
        if (!seg.trim()) return null;
        return <InlineMarkdown key={i} text={seg} />;
      })}
    </>
  );
}

/** Render a markdown table as an HTML table */
export function MarkdownTable({ raw }: { raw: string }) {
  const lines = raw.split('\n').filter((l) => l.trim());
  if (lines.length < 2) return <InlineMarkdown text={raw} />;

  const parseRow = (line: string) =>
    line.split('|').slice(1, -1).map((cell) => cell.trim());

  const headerCells = parseRow(lines[0]);
  // Check if line[1] is a separator (e.g., |---|---|)
  const isSeparator = /^\|[\s:?-]+(\|[\s:?-]+)*\|?\s*$/.test(lines[1]);
  const dataStart = isSeparator ? 2 : 1;
  const bodyRows = lines.slice(dataStart).map(parseRow);

  return (
    <div className="my-2 overflow-x-auto">
      <table className="text-xs font-mono border-collapse border border-th-border w-full">
        <thead>
          <tr className="bg-th-bg-alt">
            {headerCells.map((cell, j) => (
              <th key={j} className="border border-th-border px-2 py-1 text-left text-th-text-alt font-semibold">
                <InlineMarkdown text={cell} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {bodyRows.map((row, ri) => (
            <tr key={ri} className={ri % 2 === 0 ? 'bg-th-bg/30' : 'bg-th-bg-alt/30'}>
              {row.map((cell, ci) => (
                <td key={ci} className="border border-th-border px-2 py-1 text-th-text-alt">
                  <InlineMarkdown text={cell} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
