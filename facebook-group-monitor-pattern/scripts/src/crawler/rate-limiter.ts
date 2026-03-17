import type { Settings } from '../config/types.js';

/**
 * Get a random integer between min and max (inclusive).
 */
function randomBetween(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Sleep for a random duration within the configured range.
 */
export async function actionDelay(settings: Settings): Promise<void> {
    const [min, max] = settings.delay_between_actions_ms;
    const ms = randomBetween(min, max);
    await sleep(ms);
}

/**
 * Sleep for a random cooldown duration between groups.
 */
export async function groupCooldown(settings: Settings): Promise<void> {
    const [min, max] = settings.cooldown_between_groups_ms;
    const ms = randomBetween(min, max);
    const secs = Math.round(ms / 1000);
    process.stderr.write(`⏳ Cooldown: waiting ${secs}s before next group...\n`);
    await sleep(ms);
}

/**
 * Get a randomized scroll delay (slightly varied to look human).
 */
export function getScrollDelay(): number {
    return randomBetween(1500, 3500);
}

/**
 * Get random scroll distance (varies between scrolls).
 */
export function getScrollDistance(): number {
    return randomBetween(600, 1200);
}

export function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
