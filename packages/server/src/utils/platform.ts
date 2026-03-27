/**
 * Cross-platform utility for binary detection.
 *
 * Unix uses `which`, Windows uses `where` to check if a binary is on PATH.
 */
export const WHICH_COMMAND = process.platform === 'win32' ? 'where' : 'which';
