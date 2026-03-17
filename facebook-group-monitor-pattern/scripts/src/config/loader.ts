import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';
import type { AppConfig, Settings, MonitorConfig } from './types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPTS_DIR = resolve(__dirname, '../..');

const DEFAULT_SETTINGS: Settings = {
    browser_data_dir: '.browser-data',
    cooldown_between_groups_ms: [120_000, 300_000],
    delay_between_actions_ms: [3_000, 8_000],
    max_scroll_rounds: 8,
    post_limit_per_group: 30,
    yesterday_only: true,
};

export function loadConfig(configPath?: string): AppConfig {
    const resolvedPath = configPath
        ? resolve(configPath)
        : resolve(SCRIPTS_DIR, 'config.yaml');

    let raw: string;
    try {
        raw = readFileSync(resolvedPath, 'utf-8');
    } catch {
        throw new Error(`Config file not found: ${resolvedPath}`);
    }

    const parsed = yaml.load(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object') {
        throw new Error('Invalid config: expected a YAML object');
    }

    const monitors = validateMonitors(parsed.monitors);
    const settings = mergeSettings(parsed.settings as Partial<Settings> | undefined);

    // Resolve browser_data_dir relative to scripts dir
    settings.browser_data_dir = resolve(SCRIPTS_DIR, settings.browser_data_dir);

    return { monitors, settings };
}

function validateMonitors(raw: unknown): MonitorConfig[] {
    if (!Array.isArray(raw) || raw.length === 0) {
        throw new Error('Config must have at least one monitor in "monitors" array');
    }

    return raw.map((m, i) => {
        if (!m.name) throw new Error(`Monitor #${i + 1} missing "name"`);
        if (!Array.isArray(m.groups) || m.groups.length === 0) {
            throw new Error(`Monitor "${m.name}" must have at least one group`);
        }
        if (!Array.isArray(m.patterns) || m.patterns.length === 0) {
            throw new Error(`Monitor "${m.name}" must have at least one pattern`);
        }

        const validModes = ['word', 'contains', 'regex'];
        const mode = m.match_mode || 'contains';
        if (!validModes.includes(mode)) {
            throw new Error(`Monitor "${m.name}" has invalid match_mode "${mode}". Use: ${validModes.join(', ')}`);
        }

        for (const g of m.groups) {
            if (!g.url) throw new Error(`Monitor "${m.name}" has a group without "url"`);
            if (!g.schedule) throw new Error(`Monitor "${m.name}" group "${g.url}" missing "schedule"`);
        }

        return {
            name: m.name,
            groups: m.groups,
            patterns: m.patterns,
            match_mode: mode,
            collection: m.collection || 'fb_matched_posts',
        } as MonitorConfig;
    });
}

function mergeSettings(raw: Partial<Settings> | undefined): Settings {
    if (!raw) return { ...DEFAULT_SETTINGS };

    return {
        browser_data_dir: raw.browser_data_dir ?? DEFAULT_SETTINGS.browser_data_dir,
        cooldown_between_groups_ms: raw.cooldown_between_groups_ms ?? DEFAULT_SETTINGS.cooldown_between_groups_ms,
        delay_between_actions_ms: raw.delay_between_actions_ms ?? DEFAULT_SETTINGS.delay_between_actions_ms,
        max_scroll_rounds: raw.max_scroll_rounds ?? DEFAULT_SETTINGS.max_scroll_rounds,
        post_limit_per_group: raw.post_limit_per_group ?? DEFAULT_SETTINGS.post_limit_per_group,
        yesterday_only: raw.yesterday_only ?? DEFAULT_SETTINGS.yesterday_only,
    };
}

export function findMonitor(config: AppConfig, name: string): MonitorConfig | undefined {
    return config.monitors.find(
        (m) => m.name.toLowerCase() === name.toLowerCase()
    );
}
