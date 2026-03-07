/**
 * Simple structured logger for Flightdeck server.
 * Outputs timestamped, categorized messages to stdout/stderr.
 */
import { redact, redactObject } from './redaction.js';

type LogLevel = 'info' | 'warn' | 'error' | 'debug';

const LEVEL_ICONS: Record<LogLevel, string> = {
  info: 'ℹ️ ',
  warn: '⚠️ ',
  error: '❌',
  debug: '🔍',
};

const CATEGORY_COLORS: Record<string, string> = {
  agent: '\x1b[36m',    // cyan
  lead: '\x1b[35m',     // magenta
  api: '\x1b[33m',      // yellow
  ws: '\x1b[34m',       // blue
  server: '\x1b[32m',   // green
  delegation: '\x1b[35m',
  message: '\x1b[34m',
};

const RESET = '\x1b[0m';
const DIM = '\x1b[2m';

function formatTime(): string {
  return new Date().toISOString().slice(11, 23); // HH:MM:SS.mmm
}

function log(level: LogLevel, category: string, message: string, details?: Record<string, unknown>): void {
  const icon = LEVEL_ICONS[level];
  const color = CATEGORY_COLORS[category] ?? '';
  const time = `${DIM}${formatTime()}${RESET}`;
  const cat = `${color}[${category}]${RESET}`;
  const detailStr = details ? ` ${DIM}${JSON.stringify(redactObject(details).data)}${RESET}` : '';

  const line = `${time} ${icon} ${cat} ${redact(message).text}${detailStr}`;

  if (level === 'error') {
    process.stderr.write(line + '\n');
  } else {
    process.stdout.write(line + '\n');
  }
}

export const logger = {
  info: (category: string, message: string, details?: Record<string, unknown>) =>
    log('info', category, message, details),
  warn: (category: string, message: string, details?: Record<string, unknown>) =>
    log('warn', category, message, details),
  error: (category: string, message: string, details?: Record<string, unknown>) =>
    log('error', category, message, details),
  debug: (category: string, message: string, details?: Record<string, unknown>) =>
    log('debug', category, message, details),
};
