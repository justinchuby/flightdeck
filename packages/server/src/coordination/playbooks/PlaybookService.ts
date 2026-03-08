import type { Database } from '../../db/database.js';
import { randomUUID } from 'crypto';

// ── Types ─────────────────────────────────────────────────────────

export interface PlaybookRole {
  role: string;
  model?: string;
  instructions?: string;
}

export interface PlaybookTaskTemplate {
  title: string;
  description?: string;
  assignRole?: string;
  dependsOn?: string[];
}

export interface Playbook {
  id: string;
  name: string;
  description: string;
  roles: PlaybookRole[];
  taskTemplates: PlaybookTaskTemplate[];
  settings: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export type PlaybookInput = Omit<Playbook, 'id' | 'createdAt' | 'updatedAt'>;

// ── PlaybookService ───────────────────────────────────────────────

const SETTINGS_KEY = 'playbooks';

export class PlaybookService {
  constructor(private db: Database) {}

  /** Get all playbooks */
  list(): Playbook[] {
    const raw = this.db.getSetting(SETTINGS_KEY);
    if (!raw) return [];
    try {
      return JSON.parse(raw);
    } catch {
      return [];
    }
  }

  /** Get a playbook by ID */
  get(id: string): Playbook | undefined {
    return this.list().find(p => p.id === id);
  }

  /** Create a new playbook */
  create(input: PlaybookInput): Playbook {
    const playbooks = this.list();

    if (playbooks.some(p => p.name === input.name)) {
      throw new Error(`Playbook with name "${input.name}" already exists`);
    }

    const now = new Date().toISOString();
    const playbook: Playbook = {
      id: randomUUID(),
      ...input,
      createdAt: now,
      updatedAt: now,
    };

    playbooks.push(playbook);
    this.save(playbooks);
    return playbook;
  }

  /** Update an existing playbook */
  update(id: string, updates: Partial<PlaybookInput>): Playbook {
    const playbooks = this.list();
    const idx = playbooks.findIndex(p => p.id === id);
    if (idx === -1) throw new Error(`Playbook "${id}" not found`);

    if (updates.name && updates.name !== playbooks[idx].name) {
      if (playbooks.some(p => p.name === updates.name && p.id !== id)) {
        throw new Error(`Playbook with name "${updates.name}" already exists`);
      }
    }

    playbooks[idx] = {
      ...playbooks[idx],
      ...updates,
      id, // Preserve id
      createdAt: playbooks[idx].createdAt, // Preserve createdAt
      updatedAt: new Date().toISOString(),
    };

    this.save(playbooks);
    return playbooks[idx];
  }

  /** Delete a playbook */
  delete(id: string): boolean {
    const playbooks = this.list();
    const idx = playbooks.findIndex(p => p.id === id);
    if (idx === -1) return false;
    playbooks.splice(idx, 1);
    this.save(playbooks);
    return true;
  }

  /**
   * Generate a crew configuration from a playbook.
   * Returns the data needed to spin up agents with the playbook's roles + tasks.
   */
  apply(id: string): { roles: PlaybookRole[]; taskTemplates: PlaybookTaskTemplate[]; settings: Record<string, unknown> } {
    const playbook = this.get(id);
    if (!playbook) throw new Error(`Playbook "${id}" not found`);
    return {
      roles: playbook.roles,
      taskTemplates: playbook.taskTemplates,
      settings: playbook.settings,
    };
  }

  private save(playbooks: Playbook[]): void {
    this.db.setSetting(SETTINGS_KEY, JSON.stringify(playbooks));
  }
}
