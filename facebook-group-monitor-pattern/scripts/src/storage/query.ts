import mongoose from 'mongoose';
import { getMatchedPostModel } from './connection.js';
import type { MatchedPost } from '../config/types.js';

export interface QueryOptions {
    pattern?: string;
    search?: string;
    days?: number;
    from?: string;
    to?: string;
    limit?: number;
    monitor?: string;
    collection?: string;
}

function buildFilter(options: QueryOptions): Record<string, unknown> {
    const filter: Record<string, unknown> = {};

    if (options.pattern) {
        filter.matched_patterns = { $in: [options.pattern] };
    }

    if (options.search) {
        filter.text = { $regex: options.search, $options: 'i' };
    }

    if (options.monitor) {
        filter.monitor_name = { $regex: `^${escapeRegex(options.monitor)}$`, $options: 'i' };
    }

    // Time range filters
    const dateFilter: Record<string, unknown> = {};

    if (options.days) {
        const start = new Date();
        start.setDate(start.getDate() - options.days);
        start.setHours(0, 0, 0, 0);
        dateFilter.$gte = start;
    }

    if (options.from) {
        dateFilter.$gte = new Date(options.from);
    }

    if (options.to) {
        const end = new Date(options.to);
        end.setHours(23, 59, 59, 999);
        dateFilter.$lte = end;
    }

    if (Object.keys(dateFilter).length > 0) {
        filter.scraped_at = dateFilter;
    }

    return filter;
}

function escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export async function queryPosts(
    collectionNames: string[],
    options: QueryOptions
): Promise<MatchedPost[]> {
    const limit = options.limit ?? 10;
    const filter = buildFilter(options);
    const allPosts: MatchedPost[] = [];

    for (const collName of collectionNames) {
        const Model = getMatchedPostModel(collName);
        const docs = await Model.find(filter)
            .sort({ scraped_at: -1 })
            .limit(limit - allPosts.length)
            .lean()
            .exec();

        for (const doc of docs) {
            allPosts.push({
                monitor_name: doc.monitor_name,
                group_url: doc.group_url,
                group_name: doc.group_name,
                post_url: doc.post_url,
                author: doc.author,
                text: doc.text,
                matched_patterns: doc.matched_patterns,
                total_comment: doc.total_comment ?? null,
                total_liked: doc.total_liked ?? null,
                total_shared: doc.total_shared ?? null,
                post_date: doc.post_date,
                scraped_at: doc.scraped_at,
                images: doc.images ?? 0,
            });

            if (allPosts.length >= limit) break;
        }

        if (allPosts.length >= limit) break;
    }

    // Sort combined results by scraped_at descending
    allPosts.sort((a, b) => new Date(b.scraped_at).getTime() - new Date(a.scraped_at).getTime());

    return allPosts.slice(0, limit);
}
