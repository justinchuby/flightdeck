/**
 * Structured logger for Flightdeck server (R5).
 *
 * Uses pino for JSON-structured output with AsyncLocalStorage for
 * automatic contextual correlation (requestId, agentId, sessionId, projectId).
 *
 * Backward-compatible API: logger.info('category', 'message', { details })
 * New API also supported: logger.info({ module: 'x', msg: 'y', ...data })
 *
 * Integrates with R12 redaction engine — all log messages and detail objects
 * are redacted before output.
 */
import pino from 'pino';
import { AsyncLocalStorage } from 'node:async_hooks';
import { redact, redactObject } from './redaction.js';

// ── Log Context (AsyncLocalStorage) ─────────────────────────────────

export interface LogContext {
  requestId?: string;
  agentId?: string;
  agentRole?: string;
  sessionId?: string;
  projectId?: string;
  leadId?: string;
  taskId?: string;
  wsClientId?: string;
  [key: string]: unknown;
}

export const logContext = new AsyncLocalStorage<LogContext>();

// ── Pino Instance ───────────────────────────────────────────────────

const isTest = process.env.NODE_ENV === 'test' || process.env.VITEST === 'true';
const isDev = !isTest && process.env.NODE_ENV !== 'production';

function createPinoLogger(): pino.Logger {
  const level = process.env.LOG_LEVEL || (isTest ? 'silent' : 'debug');

  if (isDev) {
    try {
      return pino({
        level,
        transport: {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'HH:MM:ss.l',
            ignore: 'pid,hostname',
            messageFormat: '[{module}] {msg}',
          },
        },
      });
    } catch {
      // pino-pretty not installed (e.g., production install) — fall back to JSON
      return pino({ level });
    }
  }

  // Production & test: plain JSON to stdout (test uses 'silent' level)
  return pino({ level });
}

const pinoLogger = createPinoLogger();

// ── Contextual Logger Helper ────────────────────────────────────────

function getContextualLogger(): pino.Logger {
  const ctx = logContext.getStore();
  return ctx ? pinoLogger.child(ctx) : pinoLogger;
}

// ── Backward-Compatible API ─────────────────────────────────────────
//
// Supports both call styles:
//   logger.info('category', 'message', { details })   ← existing 267 call sites
//   logger.info({ module: 'x', msg: 'y', ...data })   ← new structured API

type LogArg = string | Record<string, unknown>;

function logCompat(
  level: pino.Level,
  categoryOrObj: LogArg,
  message?: string,
  details?: Record<string, unknown>,
): void {
  const log = getContextualLogger();

  if (typeof categoryOrObj === 'object') {
    // New API: logger.info({ module: 'x', msg: 'message', ...data })
    const { msg, ...rest } = categoryOrObj as Record<string, unknown>;
    const redactedMsg = typeof msg === 'string' ? redact(msg).text : msg;
    const redactedRest = redactObject(rest).data;
    log[level]({ ...redactedRest }, redactedMsg as string);
  } else {
    // Legacy API: logger.info('category', 'message', { details })
    const redactedMsg = message ? redact(message).text : '';
    const redactedDetails = details ? redactObject(details).data : undefined;
    log[level]({ module: categoryOrObj, ...redactedDetails }, redactedMsg);
  }
}

export const logger = {
  info: (cat: LogArg, msg?: string, details?: Record<string, unknown>) =>
    logCompat('info', cat, msg, details),
  warn: (cat: LogArg, msg?: string, details?: Record<string, unknown>) =>
    logCompat('warn', cat, msg, details),
  error: (cat: LogArg, msg?: string, details?: Record<string, unknown>) =>
    logCompat('error', cat, msg, details),
  debug: (cat: LogArg, msg?: string, details?: Record<string, unknown>) =>
    logCompat('debug', cat, msg, details),
  trace: (cat: LogArg, msg?: string, details?: Record<string, unknown>) =>
    logCompat('trace', cat, msg, details),
  fatal: (cat: LogArg, msg?: string, details?: Record<string, unknown>) =>
    logCompat('fatal', cat, msg, details),
  /** Create a pino child logger with bound fields (for specialized use). */
  child: (bindings: Record<string, unknown>) => pinoLogger.child(bindings),
  /** Access the raw pino instance (for middleware integration). */
  pino: pinoLogger,
};
