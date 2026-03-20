import { useState, useEffect, useCallback } from 'react';
import { X, Link2, Copy, Check, Trash2, Plus, Clock, ExternalLink } from 'lucide-react';
import { apiFetch } from '../../hooks/useApi';

// ── Types ────────────────────────────────────────────────────────────

interface ShareLink {
  token: string;
  leadId: string;
  createdAt: string;
  expiresAt: string;
  label?: string;
  accessCount: number;
}

interface ShareDialogProps {
  leadId: string;
  onClose: () => void;
}

// ── Expiry options ───────────────────────────────────────────────────

const EXPIRY_OPTIONS = [
  { label: '24 hours', hours: 24 },
  { label: '7 days', hours: 168 },
  { label: '30 days', hours: 720 },
  { label: 'Never', hours: 0 },
] as const;

// ── Helpers ──────────────────────────────────────────────────────────

function formatExpiry(expiresAt: string): string {
  const exp = new Date(expiresAt);
  if (exp.getFullYear() > 2099) return 'Never';
  const now = Date.now();
  const diffMs = exp.getTime() - now;
  if (diffMs <= 0) return 'Expired';
  const hours = Math.floor(diffMs / 3_600_000);
  if (hours < 24) return `${hours}h remaining`;
  const days = Math.floor(hours / 24);
  return `${days}d remaining`;
}

function buildShareUrl(token: string): string {
  return `${window.location.origin}/shared/${token}`;
}

// ── Component ────────────────────────────────────────────────────────

export function ShareDialog({ leadId, onClose }: ShareDialogProps) {
  const [links, setLinks] = useState<ShareLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedToken, setCopiedToken] = useState<string | null>(null);
  const [expiryHours, setExpiryHours] = useState(168); // default 7 days
  const [label, setLabel] = useState('');

  // ESC to close
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  // Fetch existing links
  const fetchLinks = useCallback(async () => {
    try {
      const data = await apiFetch<ShareLink[]>(`/replay/${leadId}/shares`);
      setLinks(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load share links');
    } finally {
      setLoading(false);
    }
  }, [leadId]);

  useEffect(() => {
    fetchLinks();
  }, [fetchLinks]);

  // Create share link
  const handleCreate = async () => {
    setCreating(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {};
      if (expiryHours > 0) body.expiresInHours = expiryHours;
      if (label.trim()) body.label = label.trim();

      const link = await apiFetch<ShareLink>(`/replay/${leadId}/share`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      setLinks((prev) => [link, ...prev]);
      setLabel('');
      // Auto-copy the new link
      await copyToClipboard(link.token);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create share link');
    } finally {
      setCreating(false);
    }
  };

  // Revoke share link
  const handleRevoke = async (token: string) => {
    try {
      await apiFetch(`/shared/${token}`, { method: 'DELETE' });
      setLinks((prev) => prev.filter((l) => l.token !== token));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to revoke link');
    }
  };

  // Copy to clipboard
  const copyToClipboard = async (token: string) => {
    try {
      await navigator.clipboard.writeText(buildShareUrl(token));
      setCopiedToken(token);
      setTimeout(() => setCopiedToken(null), 2000);
    } catch {
      // Fallback: select text for manual copy
      setError('Could not copy — please copy the URL manually');
    }
  };

  const activeLinks = links.filter((l) => new Date(l.expiresAt).getTime() > Date.now() || new Date(l.expiresAt).getFullYear() > 2099);

  return (
    <div
      className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
      data-testid="share-dialog-backdrop"
    >
      <div
        className="bg-th-bg-alt border border-th-border rounded-lg shadow-2xl w-full max-w-md flex flex-col"
        role="dialog"
        aria-label="Share session replay"
      >
        {/* Header */}
        <div className="flex items-center gap-2 px-5 py-3 border-b border-th-border">
          <Link2 className="w-4 h-4 text-accent" aria-hidden="true" />
          <h2 className="text-sm font-semibold text-th-text flex-1">Share Replay</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-th-text-muted hover:text-th-text transition-colors"
            aria-label="Close share dialog"
          >
            <X size={16} />
          </button>
        </div>

        {/* Content */}
        <div className="px-5 py-4 space-y-4 max-h-[calc(100vh-200px)] overflow-y-auto">
          {error && (
            <div className="text-xs text-red-400 bg-red-900/20 rounded px-3 py-2" data-testid="share-error">
              {error}
            </div>
          )}

          {/* Create new link */}
          <div className="space-y-3">
            <h3 className="text-xs font-medium text-th-text-muted uppercase tracking-wider">
              Create Share Link
            </h3>
            <div className="flex gap-2">
              <input
                type="text"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="Optional label..."
                className="flex-1 text-sm bg-th-bg border border-th-border rounded px-3 py-1.5 text-th-text placeholder:text-th-text-muted focus:outline-none focus:border-accent"
                data-testid="share-label-input"
              />
              <select
                value={expiryHours}
                onChange={(e) => setExpiryHours(Number(e.target.value))}
                className="text-sm bg-th-bg border border-th-border rounded px-2 py-1.5 text-th-text focus:outline-none focus:border-accent"
                data-testid="share-expiry-select"
              >
                {EXPIRY_OPTIONS.map((opt) => (
                  <option key={opt.hours} value={opt.hours}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
            <button
              onClick={handleCreate}
              disabled={creating}
              className="flex items-center gap-2 w-full justify-center px-3 py-2 text-sm rounded-lg bg-accent text-white hover:bg-accent/80 transition-colors disabled:opacity-50"
              data-testid="share-create-btn"
            >
              <Plus size={14} aria-hidden="true" />
              {creating ? 'Creating...' : 'Create Link'}
            </button>
          </div>

          {/* Active links */}
          <div className="space-y-2">
            <h3 className="text-xs font-medium text-th-text-muted uppercase tracking-wider">
              Active Links {activeLinks.length > 0 && `(${activeLinks.length})`}
            </h3>

            {loading ? (
              <div className="text-xs text-th-text-muted text-center py-4" data-testid="share-loading">
                Loading links...
              </div>
            ) : activeLinks.length === 0 ? (
              <div className="text-xs text-th-text-muted text-center py-4" data-testid="share-empty">
                No active share links
              </div>
            ) : (
              <div className="space-y-2">
                {activeLinks.map((link) => (
                  <ShareLinkRow
                    key={link.token}
                    link={link}
                    copied={copiedToken === link.token}
                    onCopy={() => copyToClipboard(link.token)}
                    onRevoke={() => handleRevoke(link.token)}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end px-5 py-3 border-t border-th-border">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-sm rounded-lg bg-th-bg-alt text-th-text-alt hover:bg-th-bg-muted hover:text-th-text transition-colors"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

// ── ShareLinkRow ─────────────────────────────────────────────────────

function ShareLinkRow({
  link,
  copied,
  onCopy,
  onRevoke,
}: {
  link: ShareLink;
  copied: boolean;
  onCopy: () => void;
  onRevoke: () => void;
}) {
  const url = buildShareUrl(link.token);

  return (
    <div
      className="flex items-center gap-2 px-3 py-2 rounded bg-th-bg/50 border border-th-border"
      data-testid="share-link-row"
    >
      <div className="flex-1 min-w-0">
        {link.label && (
          <span className="text-xs font-medium text-th-text-alt block truncate">
            {link.label}
          </span>
        )}
        <span className="text-[11px] text-th-text-muted block truncate font-mono">
          {url}
        </span>
        <div className="flex items-center gap-3 mt-0.5">
          <span className="text-[10px] text-th-text-muted flex items-center gap-1">
            <Clock size={10} aria-hidden="true" />
            {formatExpiry(link.expiresAt)}
          </span>
          {link.accessCount > 0 && (
            <span className="text-[10px] text-th-text-muted">
              {link.accessCount} view{link.accessCount !== 1 ? 's' : ''}
            </span>
          )}
        </div>
      </div>
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="p-1 text-th-text-muted hover:text-accent transition-colors"
        aria-label="Open shared replay"
      >
        <ExternalLink size={14} />
      </a>
      <button
        onClick={onCopy}
        className="p-1 text-th-text-muted hover:text-accent transition-colors"
        aria-label={copied ? 'Link copied' : 'Copy share link'}
        data-testid="share-copy-btn"
      >
        {copied ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
      </button>
      <button
        onClick={onRevoke}
        className="p-1 text-th-text-muted hover:text-red-400 transition-colors"
        aria-label="Revoke share link"
        data-testid="share-revoke-btn"
      >
        <Trash2 size={14} />
      </button>
    </div>
  );
}
