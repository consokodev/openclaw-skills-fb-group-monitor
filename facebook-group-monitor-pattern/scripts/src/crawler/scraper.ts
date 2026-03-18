import type { Page } from 'playwright';
import type { ScrapedPost, Settings } from '../config/types.js';
import { actionDelay, getScrollDelay, getScrollDistance } from './rate-limiter.js';
import { log, logError } from '../utils/logger.js';

export async function scrapeGroupPosts(
  page: Page,
  groupUrl: string,
  settings: Settings
): Promise<{ posts: ScrapedPost[]; groupName: string }> {
  let url = groupUrl;
  if (!url.startsWith('http')) {
    url = `https://www.facebook.com/groups/${url}`;
  }

  log(`Navigating to ${url}...`);
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await actionDelay(settings);

  // Check for login/checkpoint redirect
  if (page.url().includes('login')) {
    throw new Error('Not logged into Facebook. Run login first.');
  }

  const title = await page.title();
  if (['security check', 'checkpoint', 'log in'].some((kw) => title.toLowerCase().includes(kw))) {
    throw new Error(`Facebook verification required: ${title}`);
  }

  const groupName = title.replace(' | Facebook', '').trim();
  log(`Group: ${groupName}`);

  // Dismiss Facebook notification popup if present
  await dismissFacebookDialogs(page);

  // Wait for feed to appear (up to 15s)
  try {
    await page.waitForSelector('[role="feed"]', { timeout: 15_000 });
    log('Feed element found');
  } catch {
    log('⚠️ Feed element [role="feed"] not found after 15s');
    const bodyText = await page.evaluate(() => document.body?.innerText?.substring(0, 300) || '(empty)');
    log(`Page body preview: ${bodyText}`);
  }

  // Wait for initial content to render
  await page.waitForTimeout(5000);

  // Dismiss popup again in case it appeared after page settled
  await dismissFacebookDialogs(page);

  // Extract posts WHILE scrolling — Facebook virtualizes DOM,
  // so off-screen post content becomes empty. We must extract when visible.
  const posts: ScrapedPost[] = [];
  const seenTexts = new Set<string>();

  const scrollRounds = settings.max_scroll_rounds;
  for (let i = 0; i < scrollRounds; i++) {
    if (posts.length >= settings.post_limit_per_group) break;

    // Extract visible posts in current viewport
    const feedChildren = await page.$$('[role="feed"] > div');
    for (const child of feedChildren) {
      if (posts.length >= settings.post_limit_per_group) break;

      try {
        // NOTE: Must use inline arrow function — named function references
        // don't serialize correctly with tsx's compilation
        const data = await page.evaluate((el) => {
          const fullText = el.textContent || '';
          if (fullText.length < 30) return null;

          // --- Author ---
          let author = '';
          const profileLinks = el.querySelectorAll(
            'a[href*="/user/"], a[href*="/profile.php"], a[href*="facebook.com/"][role="link"]'
          );
          for (const pl of profileLinks) {
            const name = (pl as HTMLElement).textContent?.trim();
            if (name && name.length > 1 && name.length < 60 && !/^\d/.test(name)) {
              author = name;
              break;
            }
          }

          // --- Post text ---
          const dirAutos = el.querySelectorAll('div[dir="auto"]');
          const textParts: string[] = [];
          dirAutos.forEach(d => {
            const t = d.textContent?.trim();
            if (t && t.length > 10 && t !== author) {
              textParts.push(t);
            }
          });
          textParts.sort((a, b) => b.length - a.length);
          const text = textParts.length > 0 ? textParts[0].substring(0, 2000) : '';

          // --- Post URL & Relative time (extracted together) ---
          let postUrl = '';
          let relativeTime = '';
          const BAD_URL = ['comment_id', '/photo/', '/photos/', '/profile.php', '/user/', 'refsrc=', 'action='];
          // Regex to match time-like text: "5 phút", "2 giờ", "3d", "1w", "Hôm qua", "Yesterday"
          const TIME_RE = /^(\d+\s*(giờ|phút|ngày|tuần|tháng|h|m|d|w|hr|hrs|min|mins|day|days|week|weeks|month|months)s?\s*(trước|ago)?\s*$)|(hôm qua|yesterday|hôm nay|today|vừa xong|just now)$/i;

          // Strategy: scan all <a> elements for timestamp text — these also carry the post URL
          for (const a of el.querySelectorAll('a[role="link"]')) {
            const aText = a.textContent?.trim() || '';
            if (aText && TIME_RE.test(aText)) {
              relativeTime = aText;
              const h = (a as HTMLAnchorElement).href;
              if (h && h.includes('facebook.com') && (h.includes('/posts/') || h.includes('/permalink/') || h.includes('story_fbid'))) {
                postUrl = h;
              }
              break;
            }
          }

          // Also try without role="link" — some timestamp links don't have role
          if (!relativeTime) {
            for (const a of el.querySelectorAll('a[href*="/posts/"], a[href*="/permalink/"]')) {
              const aText = a.textContent?.trim() || '';
              if (aText && aText.length < 40 && TIME_RE.test(aText)) {
                relativeTime = aText;
                postUrl = (a as HTMLAnchorElement).href;
                break;
              }
            }
          }

          // Fallback URL extraction if timestamp didn't give us a URL
          if (!postUrl) {
            // Pass 1: direct post links
            for (const pl of el.querySelectorAll('a[href*="/posts/"], a[href*="/permalink/"], a[href*="story_fbid"]')) {
              const href = pl.getAttribute('href') || '';
              if (href && !href.includes('comment_id')) {
                postUrl = (pl as HTMLAnchorElement).href;
                break;
              }
            }
          }

          if (!postUrl) {
            // Pass 2: scan all anchors
            for (const a of el.querySelectorAll('a[href]')) {
              const h = (a as HTMLAnchorElement).href;
              if (h && h.includes('facebook.com') && !BAD_URL.some(b => h.includes(b))
                && (h.includes('/posts/') || h.includes('/permalink/') || h.includes('story_fbid'))) {
                postUrl = h;
                break;
              }
            }
          }

          // Fallback relative time: try aria-label patterns and abbr
          if (!relativeTime) {
            const abbrEl = el.querySelector('a abbr');
            if (abbrEl) relativeTime = abbrEl.textContent?.trim() || '';
          }
          if (!relativeTime) {
            const ariaSelectors = [
              'a[aria-label*="giờ"]', 'a[aria-label*="phút"]', 'a[aria-label*="ngày"]',
              'a[aria-label*="tuần"]', 'a[aria-label*="tháng"]',
              'a[aria-label*="hour"]', 'a[aria-label*="minute"]', 'a[aria-label*="day"]',
            ];
            for (const sel of ariaSelectors) {
              const el2 = el.querySelector(sel);
              if (el2) {
                relativeTime = el2.textContent?.trim() || el2.getAttribute('aria-label') || '';
                break;
              }
            }
          }

          // Clean URL params
          if (postUrl) {
            try { const u = new URL(postUrl); u.search = ''; postUrl = u.toString(); } catch { }
          }
          // --- Images ---
          const imageCount = el.querySelectorAll('img[src*="scontent"]').length;

          // --- Engagement metrics ---
          let totalComment = null;
          let totalLiked = null;
          let totalShared = null;
          const allText = fullText.toLowerCase();
          const commentMatch = allText.match(/(\d+)\s*(?:comments?|bình luận)/);
          if (commentMatch) totalComment = parseInt(commentMatch[1], 10);
          const likeMatch = allText.match(/(\d+)\s*(?:likes?|thích|reactions?|lượt thích)/);
          if (likeMatch) totalLiked = parseInt(likeMatch[1], 10);
          const shareMatch = allText.match(/(\d+)\s*(?:shares?|lượt chia sẻ|chia sẻ)/);
          if (shareMatch) totalShared = parseInt(shareMatch[1], 10);

          if (!author && text.length < 20) return null;

          return {
            author: author || 'Unknown',
            text,
            url: postUrl,
            images: imageCount,
            total_comment: totalComment,
            total_liked: totalLiked,
            total_shared: totalShared,
            relative_time: relativeTime,
          };
        }, child) as ScrapedPost | null;

        if (data && data.text) {
          const key = data.text.substring(0, 100);
          if (!seenTexts.has(key)) {
            seenTexts.add(key);
            posts.push(data);
          }
        }
      } catch {
        // Skip elements that can't be evaluated
      }
    }

    // Scroll down
    const distance = getScrollDistance();
    await page.evaluate((d) => window.scrollBy(0, d), distance);
    await page.waitForTimeout(getScrollDelay());
  }

  log(`Extracted ${posts.length} posts from ${groupName}`);
  return { posts, groupName };
}

/** Dismiss Facebook's own notification/cookie dialogs (DOM overlays, not browser prompts) */
async function dismissFacebookDialogs(page: Page): Promise<void> {
  try {
    const dialog = await page.$('div[role="dialog"]');
    if (!dialog) return;

    // Check if this is just the notification dropdown panel (not a blocking modal)
    const dialogText = await dialog.evaluate((el: Element) =>
      el.textContent?.substring(0, 50) || ''
    );

    if (dialogText.includes('Thông báo') || dialogText.includes('Notifications')) {
      return;
    }

    log('🔔 Facebook dialog detected, dismissing...');

    // Strategy 1: aria-label buttons
    const ariaSelectors = [
      'div[role="dialog"] [aria-label="Not Now"]',
      'div[role="dialog"] [aria-label="Block"]',
      'div[role="dialog"] [aria-label="Decline"]',
      'div[role="dialog"] [aria-label="Close"]',
      'div[role="dialog"] [aria-label="Không phải bây giờ"]',
      'div[role="dialog"] [aria-label="Chặn"]',
      'div[role="dialog"] [aria-label="Đóng"]',
    ];

    for (const sel of ariaSelectors) {
      const btn = await page.$(sel);
      if (btn) {
        await btn.click();
        log(`🔔 Clicked: ${sel}`);
        await page.waitForTimeout(1000);
        return;
      }
    }

    // Strategy 2: text-based buttons
    const dismissTexts = ['Not Now', 'Block', 'Decline', 'Không phải bây giờ', 'Chặn', 'Lúc khác', 'Bỏ qua'];
    const clicked = await page.evaluate((texts: string[]) => {
      const dlg = document.querySelector('div[role="dialog"]');
      if (!dlg) return null;
      const buttons = dlg.querySelectorAll('div[role="button"], button, a[role="button"], span[role="button"]');
      for (const btn of buttons) {
        const btnText = btn.textContent?.trim();
        if (btnText && texts.some(t => btnText === t)) {
          (btn as HTMLElement).click();
          return btnText;
        }
      }
      return null;
    }, dismissTexts);

    if (clicked) {
      log(`🔔 Clicked button by text: "${clicked}"`);
      await page.waitForTimeout(1000);
      return;
    }

    // Strategy 3: click outside
    await page.mouse.click(640, 500);
    log('🔔 Clicked outside dialog to close');
    await page.waitForTimeout(1000);
  } catch {
    // Ignore errors during dialog dismissal
  }
}
