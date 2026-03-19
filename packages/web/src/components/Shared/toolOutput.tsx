import { ChevronRight } from 'lucide-react';

// ── Tool output parsing for "Info:" lines ──────────────────────────────

export type TextPart = { type: 'text'; text: string } | { type: 'tool-output'; lines: string[] };

/** Split agent text into alternating plain-text and consecutive "Info:" line groups */
export function splitToolOutput(text: string): TextPart[] {
  const lines = text.split('\n');
  const parts: TextPart[] = [];
  let textLines: string[] = [];
  let infoLines: string[] = [];

  const INFO_RE = /^Info:\s+.+$/;
  const PATH_RE = /^\/\S+$/;

  const flushText = () => {
    if (textLines.length > 0) {
      parts.push({ type: 'text', text: textLines.join('\n') });
      textLines = [];
    }
  };
  const flushInfo = () => {
    if (infoLines.length > 0) {
      parts.push({ type: 'tool-output', lines: infoLines });
      infoLines = [];
    }
  };

  for (const line of lines) {
    if (INFO_RE.test(line) || PATH_RE.test(line)) {
      flushText();
      infoLines.push(line);
    } else {
      flushInfo();
      textLines.push(line);
    }
  }

  flushText();
  flushInfo();

  return parts;
}

/** Find the longest common directory prefix across an array of paths */
export function findCommonPrefix(paths: string[]): string {
  if (paths.length <= 1) return '';
  const splits = paths.map((p) => p.split('/'));
  const minLen = Math.min(...splits.map((s) => s.length));
  let depth = 0;
  for (let i = 0; i < minLen; i++) {
    if (splits.every((s) => s[i] === splits[0][i])) {
      depth = i + 1;
    } else {
      break;
    }
  }
  if (depth <= 1) return '';
  return splits[0].slice(0, depth).join('/') + '/';
}

/** Collapsed-by-default block for consecutive Info:/path lines */
export function CollapsibleToolOutput({ lines }: { lines: string[] }) {
  const paths = lines.map((l) => l.replace(/^Info:\s+/, ''));
  const prefix = findCommonPrefix(paths);
  const shortPaths = paths.map((p) => (prefix ? p.slice(prefix.length) : p));

  const summary =
    lines.length === 1 ? `📁 ${shortPaths[0]}` : `📁 ${lines.length} files`;

  return (
    <details className="group my-0.5 text-[11px]">
      <summary className="cursor-pointer text-th-text-muted hover:text-th-text-alt select-none list-none flex items-center gap-1">
        <ChevronRight className="w-3 h-3 shrink-0 group-open:rotate-90 transition-transform" />
        <span>{summary}</span>
      </summary>
      <div className="ml-4 mt-0.5 text-th-text-muted font-mono">
        {shortPaths.map((p, i) => (
          <div key={i} className="truncate">
            {p}
          </div>
        ))}
      </div>
    </details>
  );
}
