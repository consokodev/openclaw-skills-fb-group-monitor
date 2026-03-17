import type { Page } from 'playwright';
import type { ScrapedPost, Settings } from '../config/types.js';
import { actionDelay, getScrollDelay, getScrollDistance } from './rate-limiter.js';
import { log, logError } from '../utils/logger.js';

/**
 * JS to extract data from a single post element (runs in browser context).
 * Ported from the Python facebook-group-monitor skill.
 */
const EXTRACT_POST_JS = `(el) => {
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

  // --- Post URL (4-pass strategy) ---
  let postUrl = '';

  const isPostLink = (h) => {
    if (!h) return false;
    if (!h.includes('facebook.com')) return false;
    const bad = ['comment_id', '/photo/', '/photos/', '/profile.php', '/user/', 'refsrc=', 'action='];
    if (bad.some(b => h.includes(b))) return false;
    return h.includes('/posts/') || h.includes('/permalink/') || h.includes('story_fbid');
  };

  // Pass 1: direct post links
  const postLinks = el.querySelectorAll('a[href*="/posts/"], a[href*="/permalink/"], a[href*="story_fbid"]');
  for (const pl of postLinks) {
    const href = pl.getAttribute('href') || '';
    if (href && !href.includes('comment_id')) {
      postUrl = pl.href;
      break;
    }
  }

  // Pass 2: scan all anchors
  if (!postUrl) {
    for (const a of el.querySelectorAll('a[href]')) {
      if (isPostLink(a.href)) {
        postUrl = a.href;
        break;
      }
    }
  }

  // Pass 3: timestamp link fallback
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

  // Pass 4: extract from photo set param
  if (!postUrl) {
    for (const a of el.querySelectorAll('a[href*="/photo/"]')) {
      const photoHref = a.href || '';
      const setMatch = photoHref.match(/[?&]set=(?:pcb|gm|pb|g)\\.(\\d+)/);
      if (setMatch) {
        const groupLink = el.querySelector('a[href*="/groups/"][href*="/user/"]');
        if (groupLink) {
          const grpMatch = groupLink.href.match(/\\/groups\\/(\\d+)\\//);
          if (grpMatch) {
            postUrl = 'https://www.facebook.com/groups/' + grpMatch[1] + '/posts/' + setMatch[1] + '/';
            break;
          }
        }
      }
    }
  }

  // Clean URL params
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

  // --- Relative time ---
  let relativeTime = '';
  const timeEl = el.querySelector('a[aria-label] abbr') ||
    el.querySelector('a[aria-label*="giờ"]') ||
    el.querySelector('a[aria-label*="phút"]') ||
    el.querySelector('a[aria-label*="ngày"]') ||
    el.querySelector('a[aria-label*="hour"]') ||
    el.querySelector('a[aria-label*="minute"]') ||
    el.querySelector('a[aria-label*="day"]') ||
    el.querySelector('a[aria-label*="Yesterday"]') ||
    el.querySelector('a[aria-label*="Hôm qua"]');
  if (timeEl) {
    relativeTime = timeEl.getAttribute('aria-label') || timeEl.textContent || '';
  }

  // --- Engagement metrics (from visible text) ---
  let totalComment = null;
  let totalLiked = null;
  let totalShared = null;

  // Facebook shows engagement as text like "12 comments", "5 likes", "3 shares"
  const allText = fullText.toLowerCase();

  // Comments: "X comments" or "X bình luận"
  const commentMatch = allText.match(/(\\d+)\\s*(?:comments?|bình luận)/);
  if (commentMatch) totalComment = parseInt(commentMatch[1], 10);

  // Likes/reactions: look for reaction count element
  // Facebook often shows "X" near reaction icons or "X likes"
  const likeMatch = allText.match(/(\\d+)\\s*(?:likes?|thích|reactions?|lượt thích)/);
  if (likeMatch) totalLiked = parseInt(likeMatch[1], 10);

  // Shares: "X shares" or "X lượt chia sẻ"
  const shareMatch = allText.match(/(\\d+)\\s*(?:shares?|lượt chia sẻ|chia sẻ)/);
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
}`;

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

  // Wait for feed to load
  await page.waitForTimeout(5000);

  // Scroll to load more posts
  const scrollRounds = settings.max_scroll_rounds;
  for (let i = 0; i < scrollRounds; i++) {
    const distance = getScrollDistance();
    await page.evaluate((d) => window.scrollBy(0, d), distance);
    await page.waitForTimeout(getScrollDelay());
  }

  // Extract posts from feed
  const feedChildren = await page.$$('[role="feed"] > *');
  const posts: ScrapedPost[] = [];

  for (const child of feedChildren) {
    if (posts.length >= settings.post_limit_per_group) break;

    try {
      const data = (await child.evaluate(EXTRACT_POST_JS)) as ScrapedPost | null;
      if (data && data.text) {
        posts.push(data as ScrapedPost);
      }
    } catch {
      // Skip elements that can't be evaluated
    }
  }

  log(`Extracted ${posts.length} posts from ${groupName}`);
  return { posts, groupName };
}
