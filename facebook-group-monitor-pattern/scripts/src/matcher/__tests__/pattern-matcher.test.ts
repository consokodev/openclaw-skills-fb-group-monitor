import { describe, it, expect } from 'vitest';
import { matchPatterns } from '../pattern-matcher.js';

describe('Pattern Matcher', () => {
    describe('word mode', () => {
        const mode = 'word' as const;

        it('matches exact word boundary', () => {
            const result = matchPatterns('FPT tăng 5% hôm nay', ['FPT'], mode);
            expect(result.matched).toBe(true);
            expect(result.matchedPatterns).toEqual(['FPT']);
        });

        it('does not match partial word', () => {
            const result = matchPatterns('FPTX Corp is growing', ['FPT'], mode);
            expect(result.matched).toBe(false);
        });

        it('case insensitive', () => {
            const result = matchPatterns('fpt đang tăng mạnh', ['FPT'], mode);
            expect(result.matched).toBe(true);
        });

        it('matches multiple patterns', () => {
            const result = matchPatterns('FPT tăng, VCB giảm, HPG ổn định', ['FPT', 'VCB', 'HPG', 'VNM'], mode);
            expect(result.matched).toBe(true);
            expect(result.matchedPatterns).toEqual(['FPT', 'VCB', 'HPG']);
        });

        it('no match returns empty', () => {
            const result = matchPatterns('Hôm nay trời đẹp quá', ['FPT', 'VNM'], mode);
            expect(result.matched).toBe(false);
            expect(result.matchedPatterns).toEqual([]);
        });

        it('handles special regex chars in pattern', () => {
            const result = matchPatterns('Mã C.T.G đang tăng mạnh', ['C.T.G'], mode);
            expect(result.matched).toBe(true);
        });
    });

    describe('contains mode', () => {
        const mode = 'contains' as const;

        it('matches all words present (order-independent)', () => {
            const result = matchPatterns(
                'Remote: Axon need a Senior DevOPS Engineer',
                ['DevOPS remote'],
                mode
            );
            expect(result.matched).toBe(true);
            expect(result.matchedPatterns).toEqual(['DevOPS remote']);
        });

        it('does not match when a word is missing', () => {
            const result = matchPatterns(
                'DevOPS Engineer (onsite only)',
                ['DevOPS remote'],
                mode
            );
            expect(result.matched).toBe(false);
        });

        it('case insensitive', () => {
            const result = matchPatterns(
                'REMOTE DEVOPS POSITION AVAILABLE',
                ['devops remote'],
                mode
            );
            expect(result.matched).toBe(true);
        });

        it('single word pattern works like substring', () => {
            const result = matchPatterns('Looking for frontend developer', ['frontend'], mode);
            expect(result.matched).toBe(true);
        });

        it('matches multi-word in Vietnamese', () => {
            const result = matchPatterns(
                'Tuyển dụng frontend developer, làm việc remote',
                ['tuyển frontend'],
                mode
            );
            expect(result.matched).toBe(true);
        });

        it('multiple patterns, partial match', () => {
            const result = matchPatterns(
                'Remote DevOPS position in HCM',
                ['DevOPS remote', 'frontend developer'],
                mode
            );
            expect(result.matched).toBe(true);
            expect(result.matchedPatterns).toEqual(['DevOPS remote']);
        });
    });

    describe('regex mode', () => {
        const mode = 'regex' as const;

        it('matches regex pattern', () => {
            const result = matchPatterns('FPT gained 5.2%', ['\\d+\\.\\d+%'], mode);
            expect(result.matched).toBe(true);
        });

        it('handles invalid regex gracefully', () => {
            const result = matchPatterns('some text', ['[invalid'], mode);
            expect(result.matched).toBe(false);
        });

        it('case insensitive by default', () => {
            const result = matchPatterns('iPhone 16 Pro Max', ['iphone\\s+\\d+'], mode);
            expect(result.matched).toBe(true);
        });
    });
});
