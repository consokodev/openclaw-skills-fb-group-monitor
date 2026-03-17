import mongoose from 'mongoose';
import { log } from '../utils/logger.js';

const DEDUP_COLLECTION = '_checked_posts';

const checkedPostSchema = new mongoose.Schema(
    {
        post_url: { type: String, required: true, index: true, unique: true },
        monitor_name: { type: String, required: true },
        checked_date: { type: String, required: true }, // YYYY-MM-DD
        checked_at: { type: Date, default: Date.now },
    },
    {
        timestamps: false,
        collection: DEDUP_COLLECTION,
    }
);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getModel(): mongoose.Model<any> {
    if (mongoose.models[DEDUP_COLLECTION]) {
        return mongoose.models[DEDUP_COLLECTION]!;
    }
    return mongoose.model(DEDUP_COLLECTION, checkedPostSchema);
}

function getTodayString(): string {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

/**
 * Clean old dedup entries (from previous days).
 * Called at the start of each run.
 */
export async function cleanOldEntries(): Promise<number> {
    const model = getModel();
    const today = getTodayString();

    const result = await model.deleteMany({ checked_date: { $lt: today } });
    const count = result.deletedCount ?? 0;

    if (count > 0) {
        log(`🧹 Cleaned ${count} old dedup entries (before ${today})`);
    }

    return count;
}

/**
 * Check if a post URL has already been processed today.
 */
export async function isChecked(postUrl: string): Promise<boolean> {
    const model = getModel();
    const exists = await model.findOne({ post_url: postUrl }).lean();
    return exists !== null;
}

/**
 * Mark a post URL as checked for today.
 */
export async function markChecked(postUrl: string, monitorName: string): Promise<void> {
    const model = getModel();
    const today = getTodayString();

    try {
        await model.updateOne(
            { post_url: postUrl },
            {
                $set: {
                    post_url: postUrl,
                    monitor_name: monitorName,
                    checked_date: today,
                    checked_at: new Date(),
                },
            },
            { upsert: true }
        );
    } catch (error: unknown) {
        // Ignore duplicate key errors (E11000) — race condition safe
        if (error instanceof Error && 'code' in error && (error as { code: number }).code === 11000) return;
        throw error;
    }
}

/**
 * Force clean ALL dedup entries (manual cleanup command).
 */
export async function cleanAll(): Promise<number> {
    const model = getModel();
    const result = await model.deleteMany({});
    const count = result.deletedCount ?? 0;
    log(`🧹 Cleaned ALL ${count} dedup entries`);
    return count;
}
