import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import type { AppConfig } from '../config.js';

export interface BrowserSession {
    browser: Browser;
    context: BrowserContext;
    newPage(): Promise<Page>;
}

export async function setupBrowser(config: Pick<AppConfig, 'browser'>): Promise<BrowserSession> {
    const browser = await chromium.launch({
        headless: config.browser.headless,
        slowMo: config.browser.slowMo,
    });

    const context = await browser.newContext({
        ignoreHTTPSErrors: true,
        viewport: { width: 1280, height: 720 },
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    });

    return {
        browser,
        context,
        newPage: () => context.newPage(),
    };
}
