---
name: facebook-group-monitor-pattern
description: >-
  Config-driven Facebook group monitor that scrapes posts and matches them against
  user-defined patterns (stock tickers, job titles, keywords — anything).
  Uses Playwright stealth browser, saves matched posts to MongoDB, deduplicates
  across reruns, and auto-cleans daily. Supports three match modes: exact word
  boundary, word-split contains, and regex.
  Triggers: 'monitor Facebook groups for patterns', 'scrape FB group for stocks',
  'check group posts matching keywords', 'find job posts in Facebook groups',
  'Facebook group pattern monitoring'.
metadata:
  openclaw:
    category: "social"
    shared: true
---

# Facebook Group Monitor Pattern

## Overview

Config-driven agent that monitors Facebook groups for posts matching user-defined patterns.
Unlike the base `facebook-group-monitor`, this skill:
- **Filters** posts by pattern (stocks, jobs, keywords — anything you configure)
- **Saves** matched posts to MongoDB
- **Deduplicates** across reruns within the same day
- **Auto-cleans** the dedup tracker daily
- **No screenshots** — text extraction only

Uses Playwright headless browser with stealth mode and persistent login session.

## Setup

See [references/SETUP.md](references/SETUP.md) for installation and configuration.

## File Locations

- **Shell wrapper**: `scripts/fb-monitor-pattern.sh`
- **Config**: `scripts/config.yaml`
- **Environment**: `scripts/.env` (MongoDB connection)
- **Browser session**: `scripts/.browser-data/` (persistent login — separate from base skill)

## Config File Format

```yaml
monitors:
  - name: "VN30 Stock Tracker"
    groups:
      - url: "https://www.facebook.com/groups/123456789"
        schedule: "0 8 * * *"
    patterns:
      - "FPT"
      - "VNM"
      - "VCB"
    match_mode: "word"           # exact word boundary
    collection: "fb_stock_mentions"

  - name: "Job Hunter"
    groups:
      - url: "https://www.facebook.com/groups/111222333"
        schedule: "0 9 * * *"
    patterns:
      - "DevOPS remote"
      - "frontend developer"
    match_mode: "contains"       # all words present, any order
    collection: "fb_job_posts"

settings:
  browser_data_dir: ".browser-data"
  cooldown_between_groups_ms: [120000, 300000]
  delay_between_actions_ms: [3000, 8000]
  max_scroll_rounds: 8
  post_limit_per_group: 30
  yesterday_only: true
```

### Match Modes

| Mode | Behavior | Best For |
|------|----------|----------|
| `word` | `\bPATTERN\b` exact word boundary | Stock tickers: FPT, VNM |
| `contains` | All words present (case-insensitive, order-independent) | Multi-word: "DevOPS remote" |
| `regex` | User-provided regex | Complex patterns |

## Commands

### 1. Scrape a specific monitor
```bash
scripts/fb-monitor-pattern.sh scrape "VN30 Stock Tracker"
```

### 2. Scrape all monitors (with cooldowns)
```bash
scripts/fb-monitor-pattern.sh scrape-all
```

### 3. List configured monitors
```bash
scripts/fb-monitor-pattern.sh list
```

### 4. Check status (MongoDB + Facebook session)
```bash
scripts/fb-monitor-pattern.sh status
```

### 5. Clean dedup tracking
```bash
scripts/fb-monitor-pattern.sh clean-dedup
```

### 6. Login (interactive — requires display)
```bash
scripts/fb-monitor-pattern.sh login
```

### 7. Login via cookie import (Docker/headless)
```bash
scripts/fb-monitor-pattern.sh login-cookies <path-to-cookies.json>
```

Steps:
1. Login to Facebook in your local browser
2. Install [Cookie-Editor](https://chromewebstore.google.com/detail/cookie-editor/hlkenndednhfkekhgcdicdfddnkalmdm) extension
3. Go to `facebook.com` → open Cookie-Editor → Export (JSON) → save as `cookies.json`
4. Run: `scripts/fb-monitor-pattern.sh login-cookies cookies.json`

Output:
```json
{"success": true, "action": "login-cookies", "message": "Imported 15 cookies. Session active — logged into Facebook."}
```

## Output JSON

```json
{
  "success": true,
  "action": "scrape",
  "matched_count": 3,
  "posts": [
    {
      "monitor_name": "VN30 Stock Tracker",
      "group_url": "https://www.facebook.com/groups/123456789",
      "group_name": "Chứng khoán VN",
      "post_url": "https://facebook.com/groups/123456/posts/789",
      "author": "Nguyễn Văn A",
      "text": "FPT tăng 5% hôm nay, VCB giữ giá...",
      "matched_patterns": ["FPT", "VCB"],
      "total_comment": 12,
      "total_liked": 5,
      "total_shared": 3,
      "post_date": "2026-03-15",
      "scraped_at": "2026-03-16T08:00:00.000Z",
      "images": 2
    }
  ],
  "message": "Found 3 matched posts across 2 groups."
}
```

## Agent Workflow

When triggered by OpenClaw cron:

### Step 1: Run scrape
```bash
scripts/fb-monitor-pattern.sh scrape "VN30 Stock Tracker"
```

### Step 2: Report results
If `success == true` and `matched_count > 0`, report matched posts with links.
If `matched_count == 0`, stay silent (no notification).
If `success == false`, report error briefly.

### Step 3: Format per matched post
```
📌 *[Pattern Match: FPT, VCB]*
👤 Author: Nguyễn Văn A
📝 FPT tăng 5% hôm nay, VCB giữ giá...
💬 12 comments | 👍 5 likes | 🔄 3 shares
🔗 [Post Link](https://facebook.com/groups/.../posts/...)
```

## Important Notes

- **Rate limiting**: Cooldown between groups (2-5 min), random delays between actions (3-8s)
- **Dedup**: Posts are tracked per day — reruns on the same day won't duplicate
- **Daily cleanup**: Old dedup entries auto-removed at start of each new day
- **Separate session**: This skill has its own browser session (`.browser-data/`)
- **Engagement metrics**: Extracted from visible text (e.g., "12 comments"), may be null
- **UI changes**: Facebook updates DOM frequently — selectors may need updates
