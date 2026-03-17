export type MatchMode = 'word' | 'contains' | 'regex';

export interface GroupConfig {
    url: string;
    schedule: string;
}

export interface MonitorConfig {
    name: string;
    groups: GroupConfig[];
    patterns: string[];
    match_mode: MatchMode;
    collection: string;
}

export interface Settings {
    browser_data_dir: string;
    cooldown_between_groups_ms: [number, number];
    delay_between_actions_ms: [number, number];
    max_scroll_rounds: number;
    post_limit_per_group: number;
    yesterday_only: boolean;
}

export interface AppConfig {
    monitors: MonitorConfig[];
    settings: Settings;
}

export interface ScrapedPost {
    author: string;
    text: string;
    url: string;
    images: number;
    total_comment: number | null;
    total_liked: number | null;
    total_shared: number | null;
    relative_time: string;
}

export interface MatchedPost {
    monitor_name: string;
    group_url: string;
    group_name: string;
    post_url: string;
    author: string;
    text: string;
    matched_patterns: string[];
    total_comment: number | null;
    total_liked: number | null;
    total_shared: number | null;
    post_date: string;
    scraped_at: Date;
    images: number;
}

export interface ScrapeResult {
    success: boolean;
    action: string;
    group_name?: string;
    group_url?: string;
    total_scraped?: number;
    new_count?: number;
    matched_count?: number;
    posts?: MatchedPost[];
    message?: string;
    error?: string;
}
