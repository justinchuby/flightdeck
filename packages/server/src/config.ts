export interface ServerConfig {
  port: number;
  host: string;
  cliCommand: string;
  cliArgs: string[];
  maxConcurrentAgents: number;
  dbPath: string;
}

const defaults: ServerConfig = {
  port: 3001,
  host: '0.0.0.0',
  cliCommand: process.env.COPILOT_CLI_PATH || 'copilot',
  cliArgs: [],
  maxConcurrentAgents: parseInt(process.env.MAX_AGENTS || '10', 10),
  dbPath: process.env.DB_PATH || './ai-crew.db',
};

let config: ServerConfig = { ...defaults };

export function getConfig(): ServerConfig {
  return config;
}

export function updateConfig(patch: Partial<ServerConfig>): ServerConfig {
  config = { ...config, ...patch };
  return config;
}
