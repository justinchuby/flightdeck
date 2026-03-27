/**
 * Cross-platform utilities for binary detection.
 *
 * Unix uses `which`, Windows uses `where` to check if a binary is on PATH.
 * All binary detection should go through these helpers — no inline platform checks.
 */

import { execFileSync, execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFileCb);

/** Platform-appropriate command for locating binaries on PATH. */
export const WHICH_COMMAND = process.platform === 'win32' ? 'where' : 'which';

const BINARY_CHECK_TIMEOUT = 3_000;

/** Check if a binary is available on PATH (async). */
export async function isBinaryAvailable(binary: string): Promise<boolean> {
  try {
    await execFileAsync(WHICH_COMMAND, [binary], { timeout: BINARY_CHECK_TIMEOUT });
    return true;
  } catch {
    return false;
  }
}

/** Check if a binary is available on PATH (sync). */
export function isBinaryAvailableSync(binary: string): boolean {
  try {
    execFileSync(WHICH_COMMAND, [binary], { timeout: BINARY_CHECK_TIMEOUT, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}
