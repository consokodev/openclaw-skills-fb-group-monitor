import { chromium, type BrowserContext, type Page } from 'playwright';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import type { Settings } from '../config/types.js';
import { log } from '../utils/logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_BROWSER_DATA = resolve(__dirname, '../../.browser-data');

const USER_AGENT =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ' +
    'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const BROWSER_ARGS = [
    '--disable-blink-features=AutomationControlled',
    '--no-sandbox',
    '--disable-dev-shm-usage',
];

export async function createBrowserContext(
    settings: Settings,
    headless = true
): Promise<{ context: BrowserContext; page: Page }> {
    const browserDataDir = settings.browser_data_dir || DEFAULT_BROWSER_DATA;

    log(`Launching browser (headless=${headless})...`);

    const context = await chromium.launchPersistentContext(browserDataDir, {
        headless,
        viewport: { width: 1280, height: 900 },
        userAgent: USER_AGENT,
        args: BROWSER_ARGS,
        ignoreDefaultArgs: ['--enable-automation'],
        locale: 'en-US',
        timezoneId: 'America/New_York',
    });

    // Patch navigator.webdriver to avoid detection
    await context.addInitScript(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => false });
    });

    const pages = context.pages();
    const page = pages[0] ?? (await context.newPage());

    return { context, page };
}

export async function checkLoginStatus(page: Page): Promise<boolean> {
    await page.goto('https://www.facebook.com/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);

    if (page.url().includes('login') || page.url().includes('checkpoint')) {
        return false;
    }

    const profileLink = await page.$(
        '[aria-label="Your profile"], [aria-label="Trang cá nhân của bạn"]'
    );
    const navMenu = await page.$('[role="navigation"]');
    return profileLink !== null || navMenu !== null;
}
