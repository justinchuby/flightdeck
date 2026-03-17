/** Flightdeck agent info as displayed in the sidebar tree view. */
export interface AgentInfo {
  id: string;
  name: string;
  role: string;
  status: 'running' | 'idle' | 'completed' | 'failed' | 'terminated' | 'creating';
  model: string;
  parentId?: string;
  task?: string;
  tokens: { input: number; output: number };
  contextUsage: number;
}

/** Task info for the task DAG tree view. */
export interface TaskInfo {
  id: string;
  title: string;
  status: 'pending' | 'in_progress' | 'done' | 'blocked' | 'failed';
  assignedTo?: string;
  dependencies: string[];
}

/** File lock info for the locks tree view. */
export interface FileLockInfo {
  path: string;
  holder: string;
  acquiredAt: string;
  ttl: number;
}

/** WebSocket message types from the Flightdeck server. */
export type ServerMessage =
  | { type: 'agent:spawned'; agent: AgentInfo }
  | { type: 'agent:status'; agentId: string; status: AgentInfo['status'] }
  | { type: 'agent:terminated'; agentId: string }
  | { type: 'agent:text'; agentId: string; text: string }
  | { type: 'agent:tool_call'; agentId: string; toolCallId: string; name: string; status: string }
  | { type: 'dag:updated'; tasks: TaskInfo[] }
  | { type: 'lock:acquired'; filePath: string; agentId: string }
  | { type: 'lock:released'; filePath: string }
  | { type: 'decision:pending'; id: string; title: string; agentId: string }
  | { type: 'crew:update'; agents: AgentInfo[] }
  | { type: 'error'; message: string };
