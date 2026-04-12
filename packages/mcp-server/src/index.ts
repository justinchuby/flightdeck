/**
 * Flightdeck MCP Server
 *
 * Exposes Flightdeck's multi-agent orchestration capabilities as MCP tools.
 * Connects to a running Flightdeck instance via its HTTP API.
 */

export { createServer } from './server.js';
export type { FlightdeckMcpOptions } from './server.js';
