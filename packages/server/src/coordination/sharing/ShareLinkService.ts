import type { Database } from '../../db/database.js';
import { randomUUID } from 'crypto';

// ── Types ─────────────────────────────────────────────────────────

interface ShareLink {
  token: string;
  leadId: string;
  createdAt: string;
  expiresAt: string;
  label?: string;
  accessCount: number;
}

interface ShareLinkInput {
  leadId: string;
  expiresInHours?: number;  // default 72h
  label?: string;
}

// ── ShareLinkService ──────────────────────────────────────────────

const SETTINGS_KEY = 'share_links';
const DEFAULT_EXPIRY_HOURS = 72;

export class ShareLinkService {
  constructor(private db: Database) {}

  private loadLinks(): ShareLink[] {
    try {
      const raw = this.db.getSetting(SETTINGS_KEY);
      if (raw) return JSON.parse(raw);
    } catch { /* use empty */ }
    return [];
  }

  private saveLinks(links: ShareLink[]): void {
    this.db.setSetting(SETTINGS_KEY, JSON.stringify(links));
  }

  /** Create a new share link with token + expiry */
  create(input: ShareLinkInput): ShareLink {
    const links = this.loadLinks();
    const now = new Date();
    const expiresInHours = input.expiresInHours ?? DEFAULT_EXPIRY_HOURS;

    const link: ShareLink = {
      token: randomUUID().replace(/-/g, '').slice(0, 16),
      leadId: input.leadId,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + expiresInHours * 3600_000).toISOString(),
      label: input.label,
      accessCount: 0,
    };

    links.push(link);
    this.saveLinks(links);
    return link;
  }

  /** Validate a share token and return the link if valid */
  validate(token: string): ShareLink | null {
    const links = this.loadLinks();
    const link = links.find(l => l.token === token);
    if (!link) return null;
    if (new Date(link.expiresAt) < new Date()) return null;

    // Increment access count
    link.accessCount++;
    this.saveLinks(links);
    return link;
  }

  /** List all share links for a lead */
  listForLead(leadId: string): ShareLink[] {
    return this.loadLinks().filter(l => l.leadId === leadId);
  }

  /** Revoke a share link */
  revoke(token: string): boolean {
    const links = this.loadLinks();
    const idx = links.findIndex(l => l.token === token);
    if (idx === -1) return false;
    links.splice(idx, 1);
    this.saveLinks(links);
    return true;
  }

  /** Clean up expired links */
  cleanup(): number {
    const links = this.loadLinks();
    const now = new Date();
    const before = links.length;
    const active = links.filter(l => new Date(l.expiresAt) >= now);
    this.saveLinks(active);
    return before - active.length;
  }
}
