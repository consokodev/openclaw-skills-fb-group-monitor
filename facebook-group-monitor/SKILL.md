---
name: facebook-group-monitor
description: >-
  Monitor Facebook groups for new posts using Playwright browser automation
  with stealth mode and persistent login session. Scrapes group feed, tracks
  seen posts, reports only new ones. Supports screenshot capture per post for
  LLM vision analysis. Use when: monitoring Facebook groups, scraping FB posts,
  checking new group activity, Facebook automation, capturing post screenshots
  for vision AI, tracking marketplace posts, book sale monitoring.
  Triggers: 'check Facebook group', 'scrape FB posts', 'new posts in group',
  'monitor group', 'Facebook marketplace', 'group update'.
metadata:
  openclaw:
    category: "social"
    shared: true
---

# Facebook Group Monitor Skill

## Overview

Playwright-based headless browser scraper for Facebook groups. Default behavior:
**captures screenshots** of each post with images → agent uses vision model to extract information.

Requires one-time manual login via terminal to establish a persistent browser session.

## Setup

See [references/SETUP.md](references/SETUP.md) for installation and first-time login instructions.

## File Locations (after install)

- **Script**: `scripts/fb-group-monitor.py`
- **Shell wrapper**: `scripts/fb-group-monitor.sh`
- **Browser session**: auto-created at `scripts/.browser-data/` (persistent login)
- **Seen posts**: auto-created at `scripts/.seen-posts.json` (dedup tracking)
- **Screenshots**: `scripts/screenshots/` or custom `--shots-dir`

## Commands

### 1. Check login session
```bash
scripts/fb-group-monitor.sh status
```
Output:
```json
{"success": true, "action": "status", "message": "Session active — đã đăng nhập Facebook."}
```

### 2. Scrape new posts (with screenshots)
```bash
scripts/fb-group-monitor.sh scrape <GROUP_URL> [--limit N] [--shots-dir <PATH>]
```

**Parameters:**
- `GROUP_URL`: Full URL (https://www.facebook.com/groups/123456) or just group ID
- `--limit N`: Max posts to scrape (default: 10)
- `--shots-dir <PATH>`: ⚠️ **RECOMMENDED** — save screenshots in agent workspace so image tool can read them
- `--no-shots`: Skip screenshots (faster, text-only)

**Example:**
```bash
scripts/fb-group-monitor.sh scrape "https://www.facebook.com/groups/123456789" --limit 10 --shots-dir ./temp-screenshots
```

**Output JSON (with screenshots):**
```json
{
  "success": true,
  "action": "scrape",
  "group_name": "Example Group Name",
  "group_url": "https://www.facebook.com/groups/123456789",
  "total_scraped": 6,
  "new_count": 3,
  "screenshots_taken": 2,
  "posts": [
    {
      "author": "Poster Name",
      "text": "Post content (may be truncated)...",
      "url": "https://facebook.com/groups/123456/posts/789",
      "images": 3,
      "screenshot_path": "/path/to/temp-screenshots/abc123.jpg"
    },
    {
      "author": "Another Poster",
      "text": "Text-only post, no images...",
      "url": "https://facebook.com/groups/123456/posts/790",
      "images": 0
    }
  ],
  "message": "Tìm thấy 3 bài mới / 6 bài tổng cộng. Đã chụp 2 ảnh."
}
```

> **Note**: `screenshot_path` only present for posts with images (`images > 0`).
> Posts without images have text content only — read directly from `text` field.

### 3. Clean old screenshots
```bash
scripts/fb-group-monitor.sh clean-shots
```
Auto-removes screenshots older than 48h and caps at 100 max. Script also auto-cleans before each scrape.

### 4. Login — Interactive (requires display)
```bash
scripts/fb-group-monitor.sh login
```
Opens browser, login manually, press Enter to save session. Session lasts weeks/months.

> ⚠️ **Not available in Docker / headless environments.** Use `login-cookies` instead.

### 5. Login — Cookie import (Docker / headless)
```bash
scripts/fb-group-monitor.sh login-cookies <path-to-cookies.json>
```

**Steps:**
1. Login to Facebook on your **local browser**
2. Install "Cookie-Editor" extension ([Chrome](https://chromewebstore.google.com/detail/cookie-editor/hlkenndednhfkekhgcdicdfddnkalmdm) / [Firefox](https://addons.mozilla.org/en-US/firefox/addon/cookie-editor/))
3. Go to facebook.com → open Cookie-Editor → **Export** (JSON format) → save as `cookies.json`
4. Copy the file to your Docker container / server
5. Run `login-cookies cookies.json`

**Output:**
```json
{"success": true, "action": "login-cookies", "cookies_imported": 15, "message": "Imported 15 cookies. Session active — logged into Facebook."}
```

## Agent Workflow

When triggered by cron or user request to check a group:

### Step 1: Scrape
```bash
scripts/fb-group-monitor.sh scrape "<GROUP_URL>" --limit 10 --shots-dir ./temp-screenshots
```
> ⚠️ **Use `--shots-dir`** pointing to a path within the workspace so the image tool can access screenshots.

### Step 2: Process each new post

**Posts WITH `screenshot_path`** (has attached images):
- Read the screenshot file using vision
- Use LLM vision to extract relevant information from the image
- Combine with `text` field for complete context
- Prioritize image content (usually more complete than truncated text)

**Posts WITHOUT `screenshot_path`** (text-only):
- Read directly from `text` field
- Summarize available information

### Step 3: Report to user

**MUST** include the original post link in each item for verification.

```
Format per new post:

📌 *[Title/Summary]*
👤 Author: [author]
📝 [Key details extracted]
🔗 [post URL]
```

### Step 4: If no new posts → stay silent (no notification)
### Step 5: If `success == false` → report error briefly

## Important Notes

- **Rate limiting**: Recommended cron interval ≥ 2 hours — safe for Facebook
- **Session expired**: If error "Not logged in" → run `login` (desktop) or re-import cookies via `login-cookies` (Docker)
- **Docker / headless**: Use `login-cookies` — interactive `login` requires a display
- **UI changes**: Facebook updates DOM frequently → selectors may need updates
- **"See more"**: Text is truncated — screenshots usually have more complete content
- **Screenshot quality**: JPEG 82% — sufficient for LLM vision to read text and recognize images
