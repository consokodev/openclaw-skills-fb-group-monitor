# Setup Guide — Facebook Group Monitor Pattern

## Prerequisites

- **Node.js** 20+
- **Chromium** browser (installed via Playwright)
- **MongoDB** (self-hosted or Atlas)

## Installation

### 1. Install dependencies

```bash
cd <skill_path>/scripts
npm install
```

### 2. Install Chromium browser

```bash
npx playwright install chromium
```

> **Note**: This downloads a Chromium binary (~150MB) managed by Playwright.

### 3. Configure MongoDB

Copy the example env file and set your connection string:

```bash
cp .env.example .env
```

Edit `.env`:
```
MONGODB_URI=mongodb://user:pass@localhost:27017/openclaw
```

### 4. Configure monitors

Edit `config.yaml` to add your Facebook groups and patterns:

```yaml
monitors:
  - name: "Your Monitor Name"
    groups:
      - url: "https://www.facebook.com/groups/YOUR_GROUP_ID"
        schedule: "0 8 * * *"
    patterns:
      - "pattern1"
      - "pattern2"
    match_mode: "word"          # or "contains" or "regex"
    collection: "your_collection"
```

### 5. First-time login

> ⚠️ This skill uses a **separate** browser session from `facebook-group-monitor`.
> You must login independently.

**Option A: Interactive (requires display)**

```bash
./fb-monitor-pattern.sh login
```

1. Browser opens → login manually (email + password + 2FA)
2. Press Enter in terminal to save session

**Option B: Cookie import (Docker/headless)**

1. Login to Facebook in your local browser (Chrome/Firefox)
2. Install [Cookie-Editor](https://chromewebstore.google.com/detail/cookie-editor/hlkenndednhfkekhgcdicdfddnkalmdm) extension
3. Go to `facebook.com` → open Cookie-Editor → click **Export** → choose **JSON** → save as `cookies.json`
4. Copy the file to the scripts directory:
   ```bash
   cp ~/Downloads/cookies.json <skill_path>/scripts/cookies.json
   ```
5. Import:
   ```bash
   ./fb-monitor-pattern.sh login-cookies cookies.json
   ```

Expected output:
```json
{"success": true, "action": "login-cookies", "message": "Imported 15 cookies. Session active — logged into Facebook."}
```

> **Tip:** This bypasses 2FA since cookies are from an already-authenticated session.

### 6. Verify setup

```bash
./fb-monitor-pattern.sh status
```

Expected output:
```json
{"success": true, "action": "status", "message": "MongoDB: ✅ connected | Facebook: ✅ logged in | Monitors: 2 configured"}
```

## Cron Setup

### OpenClaw cron (recommended)

```bash
openclaw cron add \
  --name "FB Pattern Monitor - VN30" \
  --agent <YOUR_AGENT_ID> \
  --schedule "0 8 * * *" \
  --timezone "Asia/Ho_Chi_Minh" \
  --message "Run: scripts/fb-monitor-pattern.sh scrape 'VN30 Stock Tracker'"
```

### Separate cron per monitor

```bash
# VN30 stocks at 8 AM
openclaw cron add --schedule "0 8 * * *" --message "scrape 'VN30 Stock Tracker'"

# Jobs at 9 AM
openclaw cron add --schedule "0 9 * * *" --message "scrape 'Job Hunter'"
```

### All monitors at once

```bash
openclaw cron add --schedule "0 7 * * *" --message "scrape-all"
```

## Troubleshooting

| Issue | Solution |
|-------|----------|
| `MONGODB_URI not set` | Create `.env` from `.env.example` |
| `Not logged into Facebook` | Run `login` or copy `.browser-data/` |
| `Monitor not found` | Check monitor name matches `config.yaml` (case-insensitive) |
| `No posts found` | Facebook may have changed DOM selectors |
| `Node.js not found` | Install Node.js 20+ |
| `Playwright not found` | Run: `npx playwright install chromium` |
