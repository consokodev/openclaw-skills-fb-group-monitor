import { describe, it, expect } from 'vitest';
import { parseRelativeTime, isYesterday, isToday, isOlderThanYesterday, getPostDateString } from '../date-parser.js';

// Fixed reference time: 2026-03-16 10:00:00
const NOW = new Date(2026, 2, 16, 10, 0, 0);

describe('Date Parser', () => {
    describe('parseRelativeTime', () => {
        it('parses "Hôm qua" (Vietnamese yesterday)', () => {
            const date = parseRelativeTime('Hôm qua lúc 14:30', NOW);
            expect(date).not.toBeNull();
            expect(date!.getDate()).toBe(15);
        });

        it('parses "Yesterday" (English)', () => {
            const date = parseRelativeTime('Yesterday at 2:30 PM', NOW);
            expect(date).not.toBeNull();
            expect(date!.getDate()).toBe(15);
        });

        it('parses "2 giờ" (2 hours ago)', () => {
            const date = parseRelativeTime('2 giờ', NOW);
            expect(date).not.toBeNull();
            expect(date!.getHours()).toBe(8);
        });

        it('parses "2h" (2 hours ago)', () => {
            const date = parseRelativeTime('2h', NOW);
            expect(date).not.toBeNull();
            expect(date!.getHours()).toBe(8);
        });

        it('parses "30 phút" (30 minutes ago)', () => {
            const date = parseRelativeTime('30 phút', NOW);
            expect(date).not.toBeNull();
            expect(date!.getMinutes()).toBe(30);
        });

        it('parses "1 ngày" (1 day ago)', () => {
            const date = parseRelativeTime('1 ngày', NOW);
            expect(date).not.toBeNull();
            expect(date!.getDate()).toBe(15);
        });

        it('parses "1d" (1 day ago)', () => {
            const date = parseRelativeTime('1d', NOW);
            expect(date).not.toBeNull();
            expect(date!.getDate()).toBe(15);
        });

        it('parses "3 days" (3 days ago)', () => {
            const date = parseRelativeTime('3 days', NOW);
            expect(date).not.toBeNull();
            expect(date!.getDate()).toBe(13);
        });

        it('returns null for unparseable text', () => {
            expect(parseRelativeTime('some random text', NOW)).toBeNull();
        });

        it('parses "just now"', () => {
            const date = parseRelativeTime('just now', NOW);
            expect(date).not.toBeNull();
            expect(date!.getDate()).toBe(16);
        });
    });

    describe('isYesterday', () => {
        it('"Hôm qua" is yesterday', () => {
            expect(isYesterday('Hôm qua lúc 14:30', NOW)).toBe(true);
        });

        it('"1d" is yesterday', () => {
            expect(isYesterday('1d', NOW)).toBe(true);
        });

        it('"1 ngày" is yesterday', () => {
            expect(isYesterday('1 ngày', NOW)).toBe(true);
        });

        it('"2h" is NOT yesterday (it is today)', () => {
            expect(isYesterday('2h', NOW)).toBe(false);
        });

        it('"3 days" is NOT yesterday', () => {
            expect(isYesterday('3 days', NOW)).toBe(false);
        });
    });

    describe('isToday', () => {
        it('"2h" is today', () => {
            expect(isToday('2h', NOW)).toBe(true);
        });

        it('"30 phút" is today', () => {
            expect(isToday('30 phút', NOW)).toBe(true);
        });

        it('"just now" is today', () => {
            expect(isToday('just now', NOW)).toBe(true);
        });

        it('"1d" is NOT today', () => {
            expect(isToday('1d', NOW)).toBe(false);
        });
    });

    describe('isOlderThanYesterday', () => {
        it('"3 days" is older than yesterday', () => {
            expect(isOlderThanYesterday('3 days', NOW)).toBe(true);
        });

        it('"1 tuần" is older than yesterday', () => {
            expect(isOlderThanYesterday('1 tuần', NOW)).toBe(true);
        });

        it('"2h" is NOT older than yesterday', () => {
            expect(isOlderThanYesterday('2h', NOW)).toBe(false);
        });

        it('"1d" is NOT older than yesterday', () => {
            expect(isOlderThanYesterday('1d', NOW)).toBe(false);
        });
    });

    describe('getPostDateString', () => {
        it('returns YYYY-MM-DD for "Hôm qua"', () => {
            expect(getPostDateString('Hôm qua', NOW)).toBe('2026-03-15');
        });

        it('returns "unknown" for unparseable', () => {
            expect(getPostDateString('random', NOW)).toBe('unknown');
        });
    });
});
