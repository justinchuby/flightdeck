/**
 * HTTP client for the Flightdeck API.
 */

export interface FlightdeckClientOptions {
  baseUrl: string;
}

export class FlightdeckClient {
  private baseUrl: string;

  constructor(opts: FlightdeckClientOptions) {
    // Ensure base URL ends with /api (Flightdeck mounts routes under /api)
    const raw = opts.baseUrl.replace(/\/+$/, '');
    this.baseUrl = raw.endsWith('/api') ? raw : `${raw}/api`;
  }

  private async request<T = unknown>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    const resp = await fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new Error(`Flightdeck API ${method} ${path} returned ${resp.status}: ${text}`);
    }

    const contentType = resp.headers.get('content-type') ?? '';
    if (contentType.includes('application/json')) {
      return (await resp.json()) as T;
    }
    return (await resp.text()) as unknown as T;
  }

  // ── System ──────────────────────────────────────────────────────

  async getSystemStatus(): Promise<unknown> {
    return this.request('GET', '/system/status');
  }

  async getConfig(): Promise<unknown> {
    return this.request('GET', '/config');
  }

  async pauseSystem(): Promise<unknown> {
    return this.request('POST', '/system/pause');
  }

  async resumeSystem(): Promise<unknown> {
    return this.request('POST', '/system/resume');
  }

  // ── Lead Sessions ───────────────────────────────────────────────

  async listLeads(): Promise<unknown> {
    return this.request('GET', '/lead');
  }

  async getLead(id: string): Promise<unknown> {
    return this.request('GET', `/lead/${encodeURIComponent(id)}`);
  }

  async startLead(body: {
    message: string;
    provider?: string;
    model?: string;
    cwd?: string;
  }): Promise<unknown> {
    return this.request('POST', '/lead/start', body);
  }

  async sendLeadMessage(id: string, message: string): Promise<unknown> {
    return this.request('POST', `/lead/${encodeURIComponent(id)}/message`, { message });
  }

  async getLeadDecisions(id: string): Promise<unknown> {
    return this.request('GET', `/lead/${encodeURIComponent(id)}/decisions`);
  }

  async getLeadDag(id: string): Promise<unknown> {
    return this.request('GET', `/lead/${encodeURIComponent(id)}/dag`);
  }

  // ── Agents ──────────────────────────────────────────────────────

  async listAgents(): Promise<unknown> {
    return this.request('GET', '/agents');
  }

  async spawnAgent(body: {
    role: string;
    task: string;
    provider?: string;
    model?: string;
    cwd?: string;
    leadId?: string;
  }): Promise<unknown> {
    return this.request('POST', '/agents', body);
  }

  async sendAgentMessage(id: string, message: string): Promise<unknown> {
    return this.request('POST', `/agents/${encodeURIComponent(id)}/message`, { message });
  }

  async getAgentMessages(
    id: string,
    opts?: { limit?: number; offset?: number },
  ): Promise<unknown> {
    const params = new URLSearchParams();
    if (opts?.limit) params.set('limit', String(opts.limit));
    if (opts?.offset) params.set('offset', String(opts.offset));
    const qs = params.toString();
    return this.request('GET', `/agents/${encodeURIComponent(id)}/messages${qs ? `?${qs}` : ''}`);
  }

  async terminateAgent(id: string): Promise<unknown> {
    return this.request('POST', `/agents/${encodeURIComponent(id)}/terminate`);
  }

  async interruptAgent(id: string): Promise<unknown> {
    return this.request('POST', `/agents/${encodeURIComponent(id)}/interrupt`);
  }

  async getAgentPlan(id: string): Promise<unknown> {
    return this.request('GET', `/agents/${encodeURIComponent(id)}/plan`);
  }

  async getAgentTasks(id: string): Promise<unknown> {
    return this.request('GET', `/agents/${encodeURIComponent(id)}/tasks`);
  }

  async getAgentFocus(id: string): Promise<unknown> {
    return this.request('GET', `/agents/${encodeURIComponent(id)}/focus`);
  }

  async deleteAgent(id: string): Promise<unknown> {
    return this.request('DELETE', `/agents/${encodeURIComponent(id)}`);
  }

  // ── Crews ───────────────────────────────────────────────────────

  async listCrews(): Promise<unknown> {
    return this.request('GET', '/crews');
  }

  async getCrew(crewId: string): Promise<unknown> {
    return this.request('GET', `/crews/${encodeURIComponent(crewId)}`);
  }

  async getCrewSummary(): Promise<unknown> {
    return this.request('GET', '/crews/summary');
  }

  async getCrewAgents(crewId: string): Promise<unknown> {
    return this.request('GET', `/crews/${encodeURIComponent(crewId)}/agents`);
  }

  async getCrewHealth(crewId: string): Promise<unknown> {
    return this.request('GET', `/crews/${encodeURIComponent(crewId)}/health`);
  }

  async deleteCrew(leadId: string): Promise<unknown> {
    return this.request('DELETE', `/crews/${encodeURIComponent(leadId)}`);
  }

  // ── Tasks ───────────────────────────────────────────────────────

  async listTasks(opts?: { leadId?: string; status?: string }): Promise<unknown> {
    const params = new URLSearchParams();
    if (opts?.leadId) params.set('leadId', opts.leadId);
    if (opts?.status) params.set('status', opts.status);
    const qs = params.toString();
    return this.request('GET', `/tasks${qs ? `?${qs}` : ''}`);
  }

  async getAttentionItems(): Promise<unknown> {
    return this.request('GET', '/attention');
  }

  // ── Coordination ────────────────────────────────────────────────

  async getCoordinationStatus(): Promise<unknown> {
    return this.request('GET', '/coordination/status');
  }

  async getCoordinationLocks(): Promise<unknown> {
    return this.request('GET', '/coordination/locks');
  }

  async getCoordinationActivity(): Promise<unknown> {
    return this.request('GET', '/coordination/activity');
  }

  async getCoordinationSummary(): Promise<unknown> {
    return this.request('GET', '/coordination/summary');
  }

  // ── Costs ───────────────────────────────────────────────────────

  async getCostsByAgent(): Promise<unknown> {
    return this.request('GET', '/costs/by-agent');
  }

  async getCostsByTask(): Promise<unknown> {
    return this.request('GET', '/costs/by-task');
  }

  async getCostsBySession(projectId?: string): Promise<unknown> {
    const params = new URLSearchParams();
    if (projectId) params.set('projectId', projectId);
    const qs = params.toString();
    return this.request('GET', `/costs/by-session${qs ? `?${qs}` : ''}`);
  }

  // ── Search ──────────────────────────────────────────────────────

  async search(query: string): Promise<unknown> {
    const params = new URLSearchParams({ q: query });
    return this.request('GET', `/search?${params.toString()}`);
  }

  // ── Decisions ───────────────────────────────────────────────────

  async listDecisions(opts?: { leadId?: string; limit?: number }): Promise<unknown> {
    const params = new URLSearchParams();
    if (opts?.leadId) params.set('leadId', opts.leadId);
    if (opts?.limit) params.set('limit', String(opts.limit));
    const qs = params.toString();
    return this.request('GET', `/decisions${qs ? `?${qs}` : ''}`);
  }

  // ── Analytics ───────────────────────────────────────────────────

  async getAnalytics(): Promise<unknown> {
    return this.request('GET', '/analytics');
  }

  // ── Notifications ───────────────────────────────────────────────

  async listNotifications(): Promise<unknown> {
    return this.request('GET', '/notifications');
  }

  // ── Projects ────────────────────────────────────────────────────

  async listProjects(): Promise<unknown> {
    return this.request('GET', '/projects');
  }

  // ── Natural Language ────────────────────────────────────────────

  async nlPreview(text: string, leadId: string): Promise<unknown> {
    return this.request('POST', '/nl/preview', { command: text, leadId });
  }

  async nlExecute(text: string, leadId: string): Promise<unknown> {
    return this.request('POST', '/nl/execute', { command: text, leadId });
  }
}
