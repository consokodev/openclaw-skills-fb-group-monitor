import mongoose from 'mongoose';
import { config } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { log, logError } from '../utils/logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPTS_DIR = resolve(__dirname, '../..');

let isConnected = false;

export async function connectDB(): Promise<void> {
    if (isConnected) return;

    // Load .env from scripts dir
    config({ path: resolve(SCRIPTS_DIR, '.env') });

    const uri = process.env.MONGODB_URI;
    if (!uri) {
        throw new Error('MONGODB_URI not set. Copy .env.example to .env and configure it.');
    }

    log('Connecting to MongoDB...');

    try {
        await mongoose.connect(uri, {
            serverSelectionTimeoutMS: 10_000,
            connectTimeoutMS: 10_000,
        });
        isConnected = true;
        log('MongoDB connected.');
    } catch (error) {
        logError('Failed to connect to MongoDB', error);
        throw error;
    }
}

export async function disconnectDB(): Promise<void> {
    if (!isConnected) return;
    await mongoose.disconnect();
    isConnected = false;
    log('MongoDB disconnected.');
}

/**
 * Get or create a Mongoose model for a dynamic collection name.
 * Different monitors save to different collections.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getMatchedPostModel(collectionName: string): mongoose.Model<any> {
    // Return existing model if already registered
    if (mongoose.models[collectionName]) {
        return mongoose.models[collectionName]!;
    }

    const schema = new mongoose.Schema(
        {
            monitor_name: { type: String, required: true, index: true },
            group_url: { type: String, required: true },
            group_name: { type: String, required: true },
            post_url: { type: String, required: true },
            author: { type: String, default: 'Unknown' },
            text: { type: String, required: true },
            matched_patterns: { type: [String], default: [] },
            total_comment: { type: Number, default: null },
            total_liked: { type: Number, default: null },
            total_shared: { type: Number, default: null },
            post_date: { type: String, required: true },
            scraped_at: { type: Date, default: Date.now },
            images: { type: Number, default: 0 },
        },
        {
            timestamps: true,
            collection: collectionName,
        }
    );

    // Unique index on post_url within a monitor to prevent duplicates
    schema.index({ post_url: 1, monitor_name: 1 }, { unique: true });

    return mongoose.model(collectionName, schema);
}
