#!/usr/bin/env tsx

import { readFileSync } from 'fs';
import { resolve } from 'path';
import { loadConfig, findMonitor } from './config/loader.js';
import { createBrowserContext, checkLoginStatus } from './crawler/browser.js';
import { scrapeGroupPosts } from './crawler/scraper.js';
import { matchPatterns } from './matcher/pattern-matcher.js';
import { isYesterday, getPostDateString, isOlderThanYesterday } from './crawler/date-parser.js';
import { groupCooldown } from './crawler/rate-limiter.js';
import { connectDB, disconnectDB, getMatchedPostModel } from './storage/connection.js';
import { cleanOldEntries, isChecked, markChecked, cleanAll } from './storage/dedup.js';
import { resultJson, log, logError } from './utils/logger.js';
import type { MatchedPost, ScrapeResult } from './config/types.js';

const COMMANDS = ['scrape', 'scrape-all', 'list', 'status', 'clean-dedup', 'login', 'login-cookies', 'help'] as const;
type Command = (typeof COMMANDS)[number];

async function main() {
    const args = process.argv.slice(2);
    const command = (args[0] || 'help') as Command;
    const rest = args.slice(1);

    switch (command) {
        case 'scrape':
            await cmdScrape(rest);
            break;
        case 'scrape-all':
            await cmdScrapeAll();
            break;
        case 'list':
            cmdList();
            break;
        case 'status':
            await cmdStatus();
            break;
        case 'clean-dedup':
            await cmdCleanDedup();
            break;
        case 'login':
            await cmdLogin();
            break;
        case 'login-cookies':
            await cmdLoginCookies(rest);
            break;
        case 'help':
        default:
            printHelp();
            break;
    }
}

function printHelp() {
    console.log(`
Facebook Group Monitor Pattern — Config-driven group post monitor

Usage:
  fb-monitor-pattern.sh <command> [options]

Commands:
  scrape <monitor_name>        Run a specific monitor by name
  scrape-all                   Run all monitors sequentially with cooldowns
  list                         List all configured monitors
  status                       Check browser session + MongoDB connection
  clean-dedup                  Clear all dedup tracking entries
  login                        Interactive Facebook login (requires display)
  login-cookies <cookie_file>  Import cookies from JSON file (Docker/headless)
  help                         Show this help

Examples:
  fb-monitor-pattern.sh scrape "VN30 Stock Tracker"
  fb-monitor-pattern.sh scrape-all
  fb-monitor-pattern.sh list
  fb-monitor-pattern.sh status
`);
}

function cmdList() {
    const config = loadConfig();
    console.log(JSON.stringify({
        success: true,
        action: 'list',
        monitors: config.monitors.map((m) => ({
            name: m.name,
            groups: m.groups.length,
            patterns: m.patterns.length,
            match_mode: m.match_mode,
            collection: m.collection,
        })),
    }, null, 2));
}

async function cmdStatus() {
    const config = loadConfig();

    // Check MongoDB
    let mongoOk = false;
    try {
        await connectDB();
        mongoOk = true;
    } catch { /* handled */ }

    // Check browser session
    let browserOk = false;
    try {
        const { context, page } = await createBrowserContext(config.settings, config.settings.headless);
        browserOk = await checkLoginStatus(page);
        await context.close();
    } catch { /* handled */ }

    if (mongoOk) await disconnectDB();

    resultJson({
        success: mongoOk && browserOk,
        action: 'status',
        message: [
            `MongoDB: ${mongoOk ? '✅ connected' : '❌ not connected'}`,
            `Facebook: ${browserOk ? '✅ logged in' : '❌ not logged in'}`,
            `Monitors: ${config.monitors.length} configured`,
        ].join(' | '),
    });
}

async function cmdLogin() {
    const config = loadConfig();

    log('Opening browser for Facebook login...');
    log('After logging in, press Enter in this terminal.');

    const { context, page } = await createBrowserContext(config.settings, false);
    await page.goto('https://www.facebook.com/', { waitUntil: 'domcontentloaded' });

    // Wait for user input
    await new Promise<void>((resolve) => {
        process.stdout.write('\n✅ Login complete? Press Enter to save session...');
        process.stdin.once('data', () => resolve());
    });

    await context.close();
    resultJson({
        success: true,
        action: 'login',
        message: 'Facebook session saved.',
    });
}

interface CookieEditorEntry {
    name?: string;
    value?: string;
    domain?: string;
    path?: string;
    expirationDate?: number;
    expiry?: number;
    secure?: boolean;
    httpOnly?: boolean;
    sameSite?: string;
}

async function cmdLoginCookies(args: string[]) {
    const cookiePath = args[0];
    if (!cookiePath) {
        resultJson({
            success: false,
            action: 'login-cookies',
            error: 'Usage: login-cookies <path-to-cookies.json>',
        });
        return;
    }

    const resolvedPath = resolve(cookiePath);
    let rawText: string;
    try {
        rawText = readFileSync(resolvedPath, 'utf-8');
    } catch {
        resultJson({
            success: false,
            action: 'login-cookies',
            error: `Cookie file not found: ${resolvedPath}`,
        });
        return;
    }

    let rawCookies: CookieEditorEntry[];
    try {
        rawCookies = JSON.parse(rawText);
    } catch (e) {
        resultJson({
            success: false,
            action: 'login-cookies',
            error: `Invalid JSON in cookie file: ${e instanceof Error ? e.message : e}`,
        });
        return;
    }

    if (!Array.isArray(rawCookies)) {
        resultJson({
            success: false,
            action: 'login-cookies',
            error: 'Cookie file must contain a JSON array of cookie objects.',
        });
        return;
    }

    // Normalize to Playwright cookie format
    const pwCookies: Array<Record<string, unknown>> = [];
    for (const c of rawCookies) {
        if (!c || typeof c !== 'object') continue;
        const name = c.name || '';
        const value = c.value || '';
        const domain = c.domain || '';
        if (!name || !value || !domain) continue;

        const cookie: Record<string, unknown> = {
            name,
            value,
            domain,
            path: c.path || '/',
        };

        // Handle expiry (Cookie-Editor uses expirationDate)
        const expiry = c.expirationDate ?? c.expiry;
        if (expiry && typeof expiry === 'number' && expiry > 0) {
            cookie.expires = expiry;
        }

        if (c.secure) cookie.secure = true;
        if (c.httpOnly) cookie.httpOnly = true;
        if (c.sameSite) {
            const ss = String(c.sameSite).charAt(0).toUpperCase() + String(c.sameSite).slice(1).toLowerCase();
            if (['Strict', 'Lax', 'None'].includes(ss)) {
                cookie.sameSite = ss;
            }
        }

        pwCookies.push(cookie);
    }

    if (pwCookies.length === 0) {
        resultJson({
            success: false,
            action: 'login-cookies',
            error: 'No valid cookies found in file. Expected Cookie-Editor JSON format.',
        });
        return;
    }

    // Import cookies into persistent browser context
    const config = loadConfig();
    const { context, page } = await createBrowserContext(config.settings, config.settings.headless);

    await context.addCookies(pwCookies as unknown as Parameters<typeof context.addCookies>[0]);

    // Verify login
    await page.goto('https://www.facebook.com/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);

    const loggedIn = await checkLoginStatus(page);
    await context.close();

    if (loggedIn) {
        resultJson({
            success: true,
            action: 'login-cookies',
            message: `Imported ${pwCookies.length} cookies. Session active — logged into Facebook.`,
        });
    } else {
        resultJson({
            success: false,
            action: 'login-cookies',
            error: `Imported ${pwCookies.length} cookies but login verification failed. Cookies may be expired or incomplete. Try re-exporting from browser.`,
        });
    }
}

async function cmdCleanDedup() {
    await connectDB();
    const count = await cleanAll();
    await disconnectDB();

    resultJson({
        success: true,
        action: 'clean-dedup',
        message: `Cleaned ${count} dedup entries.`,
    });
}

async function cmdScrape(args: string[]) {
    const monitorName = args[0];
    if (!monitorName) {
        resultJson({
            success: false,
            action: 'scrape',
            error: 'Usage: scrape <monitor_name>. Use "list" to see available monitors.',
        });
    }

    const config = loadConfig();
    const monitor = findMonitor(config, monitorName);
    if (!monitor) {
        resultJson({
            success: false,
            action: 'scrape',
            error: `Monitor "${monitorName}" not found. Available: ${config.monitors.map((m) => m.name).join(', ')}`,
        });
    }

    await connectDB();
    await cleanOldEntries();

    const { context, page } = await createBrowserContext(config.settings, config.settings.headless);

    try {
        const allMatched: MatchedPost[] = [];

        for (let i = 0; i < monitor!.groups.length; i++) {
            const group = monitor!.groups[i];

            if (i > 0) {
                await groupCooldown(config.settings);
            }

            try {
                const { posts, groupName } = await scrapeGroupPosts(page, group.url, config.settings);

                log(`📊 Scraped ${posts.length} posts from group`);
                let skippedYesterday = 0;
                let skippedDedup = 0;
                let skippedNoMatch = 0;

                for (const post of posts) {
                    // Filter: yesterday only (if enabled)
                    if (config.settings.yesterday_only && post.relative_time) {
                        if (!isYesterday(post.relative_time)) {
                            skippedYesterday++;
                            continue;
                        }
                    }

                    // Dedup check
                    if (post.url && await isChecked(post.url)) {
                        skippedDedup++;
                        continue;
                    }

                    // Pattern matching
                    const result = matchPatterns(post.text, monitor!.patterns, monitor!.match_mode);
                    if (!result.matched) {
                        skippedNoMatch++;
                        log(`  ❌ No match — preview: "${post.text.substring(0, 120)}..."`);
                        continue;
                    }
                    log(`  ✅ Matched [${result.matchedPatterns.join(', ')}] — preview: "${post.text.substring(0, 120)}..."`);

                    const matched: MatchedPost = {
                        monitor_name: monitor!.name,
                        group_url: group.url,
                        group_name: groupName,
                        post_url: post.url,
                        author: post.author,
                        text: post.text,
                        matched_patterns: result.matchedPatterns,
                        total_comment: post.total_comment,
                        total_liked: post.total_liked,
                        total_shared: post.total_shared,
                        post_date: getPostDateString(post.relative_time),
                        scraped_at: new Date(),
                        images: post.images,
                    };

                    // Save to MongoDB
                    try {
                        const Model = getMatchedPostModel(monitor!.collection);
                        // When post_url is empty, generate a unique key from text content
                        const postKey = matched.post_url || `text:${matched.text.substring(0, 200)}:${matched.author}`;
                        await Model.updateOne(
                            { post_url: postKey, monitor_name: matched.monitor_name },
                            { $set: { ...matched, post_url: postKey } },
                            { upsert: true }
                        );
                        allMatched.push(matched);
                    } catch (saveErr) {
                        logError('Failed to save post', saveErr);
                    }

                    // Mark as checked
                    if (post.url) {
                        await markChecked(post.url, monitor!.name);
                    }
                }

                log(`📋 Summary: ${posts.length} scraped → ${skippedYesterday} skipped(date) / ${skippedDedup} skipped(dedup) / ${skippedNoMatch} skipped(no-match) / ${allMatched.length} matched`);
            } catch (groupErr) {
                logError(`Failed to scrape group ${group.url}`, groupErr);
            }
        }

        await context.close();
        await disconnectDB();

        resultJson({
            success: true,
            action: 'scrape',
            group_url: monitor!.groups.map((g) => g.url).join(', '),
            matched_count: allMatched.length,
            posts: allMatched,
            message: `Found ${allMatched.length} matched posts across ${monitor!.groups.length} groups.`,
        });
    } catch (error) {
        try { await context.close(); } catch { /* ignore */ }
        await disconnectDB();
        resultJson({
            success: false,
            action: 'scrape',
            error: error instanceof Error ? error.message : String(error),
        });
    }
}

async function cmdScrapeAll() {
    const config = loadConfig();

    await connectDB();
    await cleanOldEntries();

    const { context, page } = await createBrowserContext(config.settings, config.settings.headless);

    const results: Array<{ monitor: string; matched: number; error?: string }> = [];

    try {
        let groupIndex = 0;

        for (const monitor of config.monitors) {
            log(`\n═══ Running monitor: ${monitor.name} ═══`);

            for (let i = 0; i < monitor.groups.length; i++) {
                const group = monitor.groups[i];

                if (groupIndex > 0) {
                    await groupCooldown(config.settings);
                }
                groupIndex++;

                try {
                    const { posts, groupName } = await scrapeGroupPosts(page, group.url, config.settings);
                    let matched = 0;

                    for (const post of posts) {
                        if (config.settings.yesterday_only && post.relative_time) {
                            if (!isYesterday(post.relative_time)) continue;
                        }

                        if (post.url && await isChecked(post.url)) continue;

                        const result = matchPatterns(post.text, monitor.patterns, monitor.match_mode);
                        if (!result.matched) continue;

                        const matchedPost: MatchedPost = {
                            monitor_name: monitor.name,
                            group_url: group.url,
                            group_name: groupName,
                            post_url: post.url,
                            author: post.author,
                            text: post.text,
                            matched_patterns: result.matchedPatterns,
                            total_comment: post.total_comment,
                            total_liked: post.total_liked,
                            total_shared: post.total_shared,
                            post_date: getPostDateString(post.relative_time),
                            scraped_at: new Date(),
                            images: post.images,
                        };

                        try {
                            const Model = getMatchedPostModel(monitor.collection);
                            const postKey = matchedPost.post_url || `text:${matchedPost.text.substring(0, 200)}:${matchedPost.author}`;
                            await Model.updateOne(
                                { post_url: postKey, monitor_name: matchedPost.monitor_name },
                                { $set: { ...matchedPost, post_url: postKey } },
                                { upsert: true }
                            );
                            matched++;
                        } catch (saveErr) {
                            logError('Failed to save post', saveErr);
                        }

                        if (post.url) {
                            await markChecked(post.url, monitor.name);
                        }
                    }

                    results.push({ monitor: monitor.name, matched });
                } catch (groupErr) {
                    logError(`Failed to scrape group ${group.url}`, groupErr);
                    results.push({
                        monitor: monitor.name,
                        matched: 0,
                        error: groupErr instanceof Error ? groupErr.message : String(groupErr),
                    });
                }
            }
        }

        await context.close();
        await disconnectDB();

        const totalMatched = results.reduce((sum, r) => sum + r.matched, 0);

        resultJson({
            success: true,
            action: 'scrape-all',
            matched_count: totalMatched,
            message: `Completed ${config.monitors.length} monitors. Total matched: ${totalMatched}.`,
        });
    } catch (error) {
        try { await context.close(); } catch { /* ignore */ }
        await disconnectDB();
        resultJson({
            success: false,
            action: 'scrape-all',
            error: error instanceof Error ? error.message : String(error),
        });
    }
}

main().catch((error) => {
    logError('Unhandled error', error);
    process.exit(1);
});
