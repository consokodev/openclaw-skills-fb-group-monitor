/**
 * Parse Facebook relative timestamps into Date objects.
 * Supports Vietnamese and English locales.
 */

const RELATIVE_PATTERNS: Array<{ regex: RegExp; unit: 'minutes' | 'hours' | 'days' | 'weeks' }> = [
    // Vietnamese
    { regex: /(\d+)\s*phút/i, unit: 'minutes' },
    { regex: /(\d+)\s*giờ/i, unit: 'hours' },
    { regex: /(\d+)\s*ngày/i, unit: 'days' },
    { regex: /(\d+)\s*tuần/i, unit: 'weeks' },
    // English
    { regex: /(\d+)\s*m(?:in(?:ute)?s?)?(?:\s|$)/i, unit: 'minutes' },
    { regex: /(\d+)\s*h(?:(?:ou)?rs?)?(?:\s|$)/i, unit: 'hours' },
    { regex: /(\d+)\s*d(?:ays?)?(?:\s|$)/i, unit: 'days' },
    { regex: /(\d+)\s*w(?:(?:ee)?ks?)?(?:\s|$)/i, unit: 'weeks' },
];

const YESTERDAY_KEYWORDS = [
    'hôm qua',
    'yesterday',
];

const TODAY_KEYWORDS = [
    'hôm nay',
    'today',
    'vừa xong',
    'just now',
];

const UNIT_TO_MS: Record<string, number> = {
    minutes: 60 * 1_000,
    hours: 60 * 60 * 1_000,
    days: 24 * 60 * 60 * 1_000,
    weeks: 7 * 24 * 60 * 60 * 1_000,
};

/**
 * Parse relative time text into an estimated Date.
 * Returns null if the text can't be parsed.
 */
export function parseRelativeTime(text: string, now?: Date): Date | null {
    const reference = now ?? new Date();
    const lower = text.toLowerCase().trim();

    // "Just now" / "Vừa xong"
    if (TODAY_KEYWORDS.some((kw) => lower.includes(kw))) {
        return reference;
    }

    // "Yesterday" / "Hôm qua"
    if (YESTERDAY_KEYWORDS.some((kw) => lower.includes(kw))) {
        const d = new Date(reference);
        d.setDate(d.getDate() - 1);
        return d;
    }

    // Relative patterns: "2 giờ", "3h", "1 ngày", etc.
    for (const { regex, unit } of RELATIVE_PATTERNS) {
        const match = lower.match(regex);
        if (match) {
            const value = parseInt(match[1], 10);
            return new Date(reference.getTime() - value * UNIT_TO_MS[unit]);
        }
    }

    // Vietnamese full date: "17 tháng 3, 2026" or "17 tháng 3"
    const vnDateMatch = text.match(/(\d{1,2})\s*tháng\s*(\d{1,2})(?:\s*,?\s*(\d{4}))?/i);
    if (vnDateMatch) {
        const day = parseInt(vnDateMatch[1], 10);
        const month = parseInt(vnDateMatch[2], 10) - 1;
        const year = vnDateMatch[3] ? parseInt(vnDateMatch[3], 10) : reference.getFullYear();
        return new Date(year, month, day);
    }

    // English full date: "March 17, 2026" or "Mar 17"
    const MONTHS: Record<string, number> = {
        jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
        jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
        january: 0, february: 1, march: 2, april: 3, june: 5,
        july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
    };
    const enDateMatch = lower.match(/([a-z]+)\s+(\d{1,2})(?:\s*,?\s*(\d{4}))?/);
    if (enDateMatch && MONTHS[enDateMatch[1]] !== undefined) {
        const month = MONTHS[enDateMatch[1]];
        const day = parseInt(enDateMatch[2], 10);
        const year = enDateMatch[3] ? parseInt(enDateMatch[3], 10) : reference.getFullYear();
        return new Date(year, month, day);
    }

    return null;
}

/**
 * Check if a relative time text refers to "yesterday" relative to now.
 * A post is "yesterday" if its estimated date falls on the calendar day before today.
 */
export function isYesterday(text: string, now?: Date): boolean {
    const reference = now ?? new Date();
    const parsed = parseRelativeTime(text, reference);
    if (!parsed) return false;

    const yesterday = new Date(reference);
    yesterday.setDate(yesterday.getDate() - 1);

    return (
        parsed.getFullYear() === yesterday.getFullYear() &&
        parsed.getMonth() === yesterday.getMonth() &&
        parsed.getDate() === yesterday.getDate()
    );
}

/**
 * Check if a relative time text refers to today or is very recent.
 */
export function isToday(text: string, now?: Date): boolean {
    const reference = now ?? new Date();
    const parsed = parseRelativeTime(text, reference);
    if (!parsed) return false;

    return (
        parsed.getFullYear() === reference.getFullYear() &&
        parsed.getMonth() === reference.getMonth() &&
        parsed.getDate() === reference.getDate()
    );
}

/**
 * Check if a post's relative time is older than yesterday
 * (i.e., 2+ days ago). Used to stop scrolling.
 */
export function isOlderThanYesterday(text: string, now?: Date): boolean {
    const reference = now ?? new Date();
    const parsed = parseRelativeTime(text, reference);
    if (!parsed) return false;

    const yesterday = new Date(reference);
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(0, 0, 0, 0);

    return parsed.getTime() < yesterday.getTime();
}

/**
 * Get a YYYY-MM-DD date string from relative time text.
 */
export function getPostDateString(text: string, now?: Date): string {
    const parsed = parseRelativeTime(text, now);
    if (!parsed) return 'unknown';

    const y = parsed.getFullYear();
    const m = String(parsed.getMonth() + 1).padStart(2, '0');
    const d = String(parsed.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}
