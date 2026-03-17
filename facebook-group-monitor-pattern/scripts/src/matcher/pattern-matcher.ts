import type { MatchMode } from '../config/types.js';

export interface MatchResult {
    matched: boolean;
    matchedPatterns: string[];
}

export function matchPatterns(
    text: string,
    patterns: string[],
    mode: MatchMode
): MatchResult {
    const matchedPatterns: string[] = [];

    for (const pattern of patterns) {
        if (isMatch(text, pattern, mode)) {
            matchedPatterns.push(pattern);
        }
    }

    return {
        matched: matchedPatterns.length > 0,
        matchedPatterns,
    };
}

function isMatch(text: string, pattern: string, mode: MatchMode): boolean {
    switch (mode) {
        case 'word':
            return wordMatch(text, pattern);
        case 'contains':
            return containsMatch(text, pattern);
        case 'regex':
            return regexMatch(text, pattern);
        default:
            return false;
    }
}

/**
 * Exact word boundary match: \bPATTERN\b (case-insensitive)
 * Best for: stock tickers like FPT, VNM, VCB
 */
function wordMatch(text: string, pattern: string): boolean {
    const escaped = escapeRegex(pattern);
    const regex = new RegExp(`\\b${escaped}\\b`, 'i');
    return regex.test(text);
}

/**
 * Word-split contains: split pattern into words, check ALL exist in text
 * Case-insensitive, order-independent.
 * "DevOPS remote" matches "Remote: Axon need a Senior DevOPS Engineer"
 */
function containsMatch(text: string, pattern: string): boolean {
    const words = pattern.toLowerCase().split(/\s+/).filter(Boolean);
    if (words.length === 0) return false;

    const lowerText = text.toLowerCase();
    return words.every((word) => lowerText.includes(word));
}

/**
 * User-provided regex evaluated directly (case-insensitive)
 */
function regexMatch(text: string, pattern: string): boolean {
    try {
        const regex = new RegExp(pattern, 'i');
        return regex.test(text);
    } catch {
        return false;
    }
}

function escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
