#!/usr/bin/env python3
"""
Facebook Group Monitor — Scrape new posts from a Facebook group.
Uses Playwright with stealth mode and persistent login session.
Supports screenshot capture per post for LLM vision analysis.

Usage:
    fb-group-monitor.py login                                      # Login (opens browser — requires display)
    fb-group-monitor.py login-cookies <cookie_file>                # Import cookies (Docker / headless)
    fb-group-monitor.py scrape <group_url> [--limit N]             # Scrape new posts (with screenshots)
    fb-group-monitor.py scrape <group_url> [--limit N] --no-shots  # Scrape without screenshots
    fb-group-monitor.py status                                     # Check login status
    fb-group-monitor.py clean-shots                                # Remove old screenshots

Output: JSON to stdout (for agent consumption)
"""

import asyncio
import argparse
import hashlib
import json
import os
import sys
import time
import random
from datetime import datetime, timedelta
from pathlib import Path

# ── Config ──────────────────────────────────────────────────────────────────
SCRIPT_DIR = Path(__file__).parent
BROWSER_DATA = SCRIPT_DIR / ".browser-data"
SEEN_FILE = SCRIPT_DIR / ".seen-posts.json"
# SCREENSHOTS_DIR can be overridden by --shots-dir argument.
# Default: saves in script dir. Agent SHOULD pass workspace path via --shots-dir
# so OpenClaw image tool can access them (only allowed to read within workspace).
DEFAULT_SCREENSHOTS_DIR = SCRIPT_DIR / "screenshots"

MAX_SCREENSHOTS = 100       # Max screenshots to keep
SCREENSHOT_TTL_HOURS = 48   # Delete screenshots older than N hours

USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)

BROWSER_ARGS = [
    "--disable-blink-features=AutomationControlled",
    "--no-sandbox",
    "--disable-dev-shm-usage",
]

# JS to extract data from a single post element
EXTRACT_POST_JS = """(el) => {
    const fullText = el.textContent || '';
    if (fullText.length < 30) return null;

    // --- Author ---
    let author = '';
    const profileLinks = el.querySelectorAll(
        'a[href*="/user/"], a[href*="/profile.php"], a[href*="facebook.com/"][role="link"]'
    );
    for (const pl of profileLinks) {
        const name = pl.textContent?.trim();
        if (name && name.length > 1 && name.length < 60 && !/^\\d/.test(name)) {
            author = name;
            break;
        }
    }

    // --- Post text ---
    const dirAutos = el.querySelectorAll('div[dir="auto"]');
    const textParts = [];
    for (const d of dirAutos) {
        const t = d.textContent?.trim();
        if (t && t.length > 10 && t !== author) {
            textParts.push(t);
        }
    }
    textParts.sort((a, b) => b.length - a.length);
    const text = textParts.length > 0 ? textParts[0].substring(0, 2000) : '';

    // --- Post URL ---
    let postUrl = '';

    // Helper: check if a resolved href looks like a post permalink (not comment/photo/profile)
    const isPostLink = (h) => {
        if (!h) return false;
        if (!h.includes('facebook.com')) return false;
        const bad = ['comment_id', '/photo/', '/photos/', '/profile.php', '/user/', 'refsrc=', 'action='];
        if (bad.some(b => h.includes(b))) return false;
        return h.includes('/posts/') || h.includes('/permalink/') || h.includes('story_fbid');
    };

    // Pass 1: primary selectors (specific patterns in href attribute)
    const postLinks = el.querySelectorAll(
        'a[href*="/posts/"], a[href*="/permalink/"], a[href*="story_fbid"]'
    );
    for (const pl of postLinks) {
        const href = pl.getAttribute('href') || '';
        if (href && !href.includes('comment_id')) {
            postUrl = pl.href;
            break;
        }
    }

    // Pass 2: fallback — scan ALL anchors, filter by resolved href
    if (!postUrl) {
        for (const a of el.querySelectorAll('a[href]')) {
            if (isPostLink(a.href)) {
                postUrl = a.href;
                break;
            }
        }
    }

    // Pass 3: timestamp link fallback — Facebook timestamp always links to post permalink
    // Timestamp <a> tags typically have aria-label with relative time or wrap a <abbr>/<time>
    if (!postUrl) {
        const timeSelectors = [
            'a[aria-label*="giờ"]', 'a[aria-label*="phút"]', 'a[aria-label*="ngày"]',
            'a[aria-label*="tuần"]', 'a[aria-label*="tháng"]',
            'a[aria-label*="hour"]', 'a[aria-label*="minute"]', 'a[aria-label*="day"]',
            'a[aria-label*="week"]', 'a[aria-label*="month"]',
            'a abbr[title]',
        ];
        for (const sel of timeSelectors) {
            const el2 = sel.endsWith(']') && sel.includes(' ')
                ? el.querySelector(sel)?.closest('a')
                : el.querySelector(sel);
            if (el2 && isPostLink(el2.href)) {
                postUrl = el2.href;
                break;
            }
        }
    }

    // Pass 4: construct URL from photo link's "set" param (post ID hidden inside)
    // Facebook embeds post ID in photo links: /photo/?fbid=X&set=pcb.POSTID or set=gm.POSTID
    if (!postUrl) {
        for (const a of el.querySelectorAll('a[href*="/photo/"]')) {
            const photoHref = a.href || '';
            const setMatch = photoHref.match(/[?&]set=(?:pcb|gm|pb|g)\.(\d+)/);
            if (setMatch) {
                // Extract group ID from any user link in the element
                const groupLink = el.querySelector('a[href*="/groups/"][href*="/user/"]');
                if (groupLink) {
                    const grpMatch = groupLink.href.match(/\/groups\/(\d+)\//);
                    if (grpMatch) {
                        postUrl = 'https://www.facebook.com/groups/' + grpMatch[1] + '/posts/' + setMatch[1] + '/';
                        break;
                    }
                }
            }
        }
    }

    if (postUrl) {
        try {
            const u = new URL(postUrl);
            u.search = '';
            postUrl = u.toString();
        } catch(e) {}
    }

    // --- Images ---
    const imgEls = el.querySelectorAll('img[src*="scontent"]');
    const imageCount = imgEls.length;

    if (!author && text.length < 20) return null;

    return {
        author: author || 'Unknown',
        text: text,
        url: postUrl,
        images: imageCount,
    };
}"""


# ── Helpers ─────────────────────────────────────────────────────────────────
def result_json(success, action, **kwargs):
    data = {"success": success, "action": action, **kwargs}
    print(json.dumps(data, ensure_ascii=False, indent=2))
    sys.exit(0 if success else 1)


def load_seen_posts():
    if SEEN_FILE.exists():
        try:
            return set(json.loads(SEEN_FILE.read_text()))
        except Exception:
            return set()
    return set()


def save_seen_posts(seen):
    SEEN_FILE.write_text(json.dumps(list(seen), ensure_ascii=False))


def post_hash(text, author):
    content = f"{author}:{text[:200]}"
    return hashlib.md5(content.encode()).hexdigest()


def cleanup_screenshots(shots_dir: Path):
    """Remove screenshots older than TTL or exceeding MAX_SCREENSHOTS."""
    cutoff = datetime.now() - timedelta(hours=SCREENSHOT_TTL_HOURS)
    files = sorted(shots_dir.glob("*.jpg"), key=lambda f: f.stat().st_mtime)

    removed = 0
    for f in files:
        mtime = datetime.fromtimestamp(f.stat().st_mtime)
        if mtime < cutoff:
            f.unlink()
            removed += 1

    files = sorted(shots_dir.glob("*.jpg"), key=lambda f: f.stat().st_mtime)
    while len(files) > MAX_SCREENSHOTS:
        files[0].unlink()
        files = files[1:]
        removed += 1

    return removed


async def create_browser_context(p, headless=True):
    try:
        from playwright_stealth import stealth_async
    except ImportError:
        stealth_async = None

    context = await p.chromium.launch_persistent_context(
        user_data_dir=str(BROWSER_DATA),
        headless=headless,
        viewport={"width": 1280, "height": 900},
        user_agent=USER_AGENT,
        args=BROWSER_ARGS,
        ignore_default_args=["--enable-automation"],
        locale="en-US",
        timezone_id="America/New_York",
    )

    if stealth_async:
        for page in context.pages:
            await stealth_async(page)

    return context, stealth_async


# ── Commands ────────────────────────────────────────────────────────────────
async def cmd_login(args):
    from playwright.async_api import async_playwright

    print("Opening browser for Facebook login...")
    print("After logging in, press Enter in this terminal.")

    async with async_playwright() as p:
        context, stealth_fn = await create_browser_context(p, headless=False)
        page = context.pages[0] if context.pages else await context.new_page()
        if stealth_fn:
            await stealth_fn(page)
        await page.goto("https://www.facebook.com/", wait_until="domcontentloaded")
        input("\n✅ Login complete? Press Enter to save session...")
        await context.close()

    result_json(True, "login", message="Facebook session saved.")


async def cmd_login_cookies(args):
    """Import Facebook cookies from a JSON file (Cookie-Editor export format).
    Works in Docker/headless environments where interactive login is impossible.
    """
    cookie_file = Path(args.cookie_file).expanduser()
    if not cookie_file.exists():
        result_json(False, "login-cookies",
                    error=f"Cookie file not found: {cookie_file}")

    try:
        raw_cookies = json.loads(cookie_file.read_text())
    except json.JSONDecodeError as e:
        result_json(False, "login-cookies",
                    error=f"Invalid JSON in cookie file: {e}")

    if not isinstance(raw_cookies, list):
        result_json(False, "login-cookies",
                    error="Cookie file must contain a JSON array of cookie objects.")

    # Normalize cookies to Playwright format
    pw_cookies = []
    for c in raw_cookies:
        if not isinstance(c, dict):
            continue
        name = c.get("name", "")
        value = c.get("value", "")
        domain = c.get("domain", "")
        if not name or not value or not domain:
            continue

        cookie = {
            "name": name,
            "value": value,
            "domain": domain,
            "path": c.get("path", "/"),
        }

        # Handle expiry/expirationDate (Cookie-Editor uses expirationDate)
        expiry = c.get("expirationDate") or c.get("expiry")
        if expiry and isinstance(expiry, (int, float)) and expiry > 0:
            cookie["expires"] = float(expiry)

        if c.get("secure"):
            cookie["secure"] = True
        if c.get("httpOnly"):
            cookie["httpOnly"] = True
        if c.get("sameSite"):
            ss = str(c["sameSite"]).capitalize()
            if ss in ("Strict", "Lax", "None"):
                cookie["sameSite"] = ss

        pw_cookies.append(cookie)

    if not pw_cookies:
        result_json(False, "login-cookies",
                    error="No valid cookies found in file. Expected Cookie-Editor JSON format.")

    # Import cookies into persistent browser context
    from playwright.async_api import async_playwright

    async with async_playwright() as p:
        context, stealth_fn = await create_browser_context(p, headless=True)
        page = context.pages[0] if context.pages else await context.new_page()
        if stealth_fn:
            await stealth_fn(page)

        await context.add_cookies(pw_cookies)

        # Verify login by navigating to Facebook
        await page.goto("https://www.facebook.com/", wait_until="domcontentloaded")
        await page.wait_for_timeout(3000)

        logged_in = False
        if "login" not in page.url and "checkpoint" not in page.url:
            profile_link = await page.query_selector(
                '[aria-label="Your profile"], [aria-label="Trang cá nhân của bạn"]'
            )
            nav_menu = await page.query_selector('[role="navigation"]')
            logged_in = profile_link is not None or nav_menu is not None

        await context.close()

    if logged_in:
        result_json(True, "login-cookies",
                    cookies_imported=len(pw_cookies),
                    message=f"Imported {len(pw_cookies)} cookies. Session active — logged into Facebook.")
    else:
        result_json(False, "login-cookies",
                    cookies_imported=len(pw_cookies),
                    error=f"Imported {len(pw_cookies)} cookies but login verification failed. "
                          "Cookies may be expired or incomplete. Try re-exporting from browser.")


async def cmd_status(args):
    from playwright.async_api import async_playwright

    async with async_playwright() as p:
        context, stealth_fn = await create_browser_context(p, headless=True)
        page = context.pages[0] if context.pages else await context.new_page()
        if stealth_fn:
            await stealth_fn(page)

        await page.goto("https://www.facebook.com/", wait_until="domcontentloaded")
        await page.wait_for_timeout(3000)

        logged_in = False
        if "login" in page.url or "checkpoint" in page.url:
            logged_in = False
        else:
            profile_link = await page.query_selector(
                '[aria-label="Your profile"], [aria-label="Trang cá nhân của bạn"]'
            )
            nav_menu = await page.query_selector('[role="navigation"]')
            logged_in = profile_link is not None or nav_menu is not None

        await context.close()

        if logged_in:
            result_json(True, "status", message="Session active — logged into Facebook.")
        else:
            result_json(False, "status", error="Not logged in. Run: fb-group-monitor.py login")


async def cmd_clean_shots(args):
    shots_dir = Path(args.shots_dir).expanduser()
    shots_dir.mkdir(parents=True, exist_ok=True)
    removed = cleanup_screenshots(shots_dir)
    remaining = len(list(shots_dir.glob("*.jpg")))
    result_json(True, "clean-shots",
                shots_dir=str(shots_dir),
                removed=removed,
                remaining=remaining,
                message=f"Removed {removed} old screenshots. {remaining} remaining.")


async def cmd_scrape(args):
    from playwright.async_api import async_playwright

    group_url = args.group_url
    limit = args.limit
    take_screenshots = not args.no_shots
    shots_dir = Path(args.shots_dir).expanduser()
    shots_dir.mkdir(parents=True, exist_ok=True)

    if not group_url.startswith("http"):
        group_url = f"https://www.facebook.com/groups/{group_url}"

    if take_screenshots:
        cleanup_screenshots(shots_dir)

    async with async_playwright() as p:
        context, stealth_fn = await create_browser_context(p, headless=True)
        page = context.pages[0] if context.pages else await context.new_page()
        if stealth_fn:
            await stealth_fn(page)

        try:
            await page.goto(group_url, wait_until="domcontentloaded")
            await page.wait_for_timeout(random.randint(2000, 4000))

            if "login" in page.url:
                await context.close()
                result_json(False, "scrape",
                            error="Not logged into Facebook. Run: fb-group-monitor.py login")

            title = await page.title()
            if any(kw in title.lower() for kw in ["security check", "checkpoint", "log in"]):
                await context.close()
                result_json(False, "scrape", error=f"Facebook verification required: {title}")

            group_name = title.replace(" | Facebook", "").strip()

            await page.wait_for_timeout(5000)

            # Scroll to load more posts
            for _ in range(4):
                await page.evaluate("window.scrollBy(0, 1000)")
                await page.wait_for_timeout(random.randint(1500, 2500))

            # Get element handles for each post in the feed
            feed_children = await page.query_selector_all('[role="feed"] > *')

            posts_data = []
            for child in feed_children:
                if len(posts_data) >= limit:
                    break

                try:
                    data = await child.evaluate(EXTRACT_POST_JS)
                except Exception:
                    continue

                if not data or not data.get("text"):
                    continue

                # ── Screenshot post element ────────────────────────────────
                if take_screenshots and data.get("images", 0) > 0:
                    try:
                        pid = post_hash(data["text"], data["author"])
                        shot_path = shots_dir / f"{pid}.jpg"

                        # Scroll element into viewport
                        await child.scroll_into_view_if_needed()
                        await page.wait_for_timeout(600)

                        await child.screenshot(
                            path=str(shot_path),
                            type="jpeg",
                            quality=82,
                        )
                        data["screenshot_path"] = str(shot_path)
                    except Exception as e:
                        data["screenshot_error"] = str(e)

                posts_data.append(data)

            await context.close()

            if not posts_data:
                result_json(True, "scrape",
                            group_name=group_name,
                            group_url=group_url,
                            posts=[],
                            new_count=0,
                            message="No posts found. Selectors may need updating.")
                return

            # Filter new posts
            seen = load_seen_posts()
            new_posts = []
            for post in posts_data:
                pid = post_hash(post.get("text", ""), post.get("author", ""))
                if pid not in seen:
                    new_posts.append(post)
                    seen.add(pid)

            if len(seen) > 500:
                seen = set(list(seen)[-500:])
            save_seen_posts(seen)

            shots_count = sum(1 for p in new_posts if p.get("screenshot_path"))

            result_json(
                True, "scrape",
                group_name=group_name,
                group_url=group_url,
                total_scraped=len(posts_data),
                new_count=len(new_posts),
                screenshots_taken=shots_count,
                posts=new_posts,
                message=(
                    f"Found {len(new_posts)} new posts / {len(posts_data)} total. "
                    f"Captured {shots_count} screenshots."
                )
            )

        except Exception as e:
            try:
                await context.close()
            except Exception:
                pass
            result_json(False, "scrape", error=str(e))


# ── CLI ─────────────────────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser(
        description="Facebook Group Monitor — scrape posts + screenshots from FB groups",
        epilog="""Examples:
  %(prog)s login
  %(prog)s status
  %(prog)s scrape https://facebook.com/groups/12345
  %(prog)s scrape https://facebook.com/groups/12345 --limit 5
  %(prog)s scrape https://facebook.com/groups/12345 --no-shots
  %(prog)s clean-shots
""",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    sub = parser.add_subparsers(dest="cmd")
    sub.required = True

    sub.add_parser("login", help="Login to Facebook (opens browser — requires display)")

    cookies_p = sub.add_parser("login-cookies",
                               help="Import cookies from JSON file (Docker / headless)")
    cookies_p.add_argument("cookie_file",
                           help="Path to JSON cookie file (Cookie-Editor export format)")

    sub.add_parser("status", help="Check login session")

    clean_p = sub.add_parser("clean-shots", help="Remove old screenshots")
    clean_p.add_argument(
        "--shots-dir",
        default=str(DEFAULT_SCREENSHOTS_DIR),
        help="Screenshots directory (default: script_dir/screenshots)"
    )

    scrape_p = sub.add_parser("scrape", help="Scrape new posts from a group")
    scrape_p.add_argument("group_url", help="Facebook group URL or ID")
    scrape_p.add_argument("--limit", type=int, default=10, help="Max posts (default: 10)")
    scrape_p.add_argument("--no-shots", action="store_true",
                          help="Skip screenshots (faster, text-only mode)")
    scrape_p.add_argument(
        "--shots-dir",
        default=str(DEFAULT_SCREENSHOTS_DIR),
        help="Screenshot output directory — SHOULD point to agent workspace so image tool can read them."
    )

    args = parser.parse_args()

    cmd_map = {
        "login": cmd_login,
        "login-cookies": cmd_login_cookies,
        "status": cmd_status,
        "scrape": cmd_scrape,
        "clean-shots": cmd_clean_shots,
    }

    asyncio.run(cmd_map[args.cmd](args))


if __name__ == "__main__":
    main()
