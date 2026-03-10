// packages/server/src/config/index.ts
// Barrel export for the hot-reloadable config module.

export { ConfigWatcher } from './ConfigWatcher.js';
export { loadConfig } from './ConfigLoader.js';
export type { ConfigDiff, LoadResult } from './ConfigLoader.js';
export { ConfigStore } from './ConfigStore.js';
export type { ConfigReloadedEvent, ConfigSectionChangedEvent } from './ConfigStore.js';
export { flightdeckConfigSchema, getDefaultConfig } from './configSchema.js';
export type { FlightdeckConfig } from './configSchema.js';
