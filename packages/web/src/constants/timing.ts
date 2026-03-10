/** Shared timing constants — avoids magic numbers scattered across hooks. */

/** Default polling interval for data-fetching hooks (focus agent, diff summary). */
export const POLL_INTERVAL_MS = 10_000;

/** Debounce before fetching replay state on seek. */
export const STATE_FETCH_DEBOUNCE_MS = 300;

/** Playback tick interval for session replay. */
export const PLAYBACK_TICK_MS = 100;

/** Minimum session duration before replay is meaningful. */
export const MIN_SESSION_DURATION_MS = 1_000;
