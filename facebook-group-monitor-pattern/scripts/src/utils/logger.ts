import type { CLIResult } from '../config/types.js';

/**
 * Print JSON result to stdout (for agent consumption) and exit.
 */
export function resultJson(data: CLIResult): never {
    console.log(JSON.stringify(data, null, 2));
    process.exit(data.success ? 0 : 1);
}

/**
 * Log a message to stderr (doesn't pollute stdout JSON).
 */
export function log(message: string): void {
    process.stderr.write(`[fb-monitor] ${message}\n`);
}

/**
 * Log an error to stderr.
 */
export function logError(message: string, error?: unknown): void {
    const errStr = error instanceof Error ? error.message : String(error ?? '');
    process.stderr.write(`[fb-monitor] ❌ ${message}${errStr ? ': ' + errStr : ''}\n`);
}
