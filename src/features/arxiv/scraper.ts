import { type Page } from 'playwright';
import { type BrowserSession } from '../../shared/browser/setup.js';

export interface Paper {
    id: string;
    title: string;
    abstract: string;
    link: string;
    pdfLink?: string;
    category: string;
}

export type ScanMode = 'new' | 'recent';

export async function scrapeArxiv(
    session: BrowserSession,
    category: string,
    mode: ScanMode = 'new',
    limit: number = 0,
    checkExists?: (id: string) => boolean
): Promise<Paper[]> {
    const page = await session.newPage();
    const url = `https://arxiv.org/list/${category}/${mode}`;
    console.log(`Navigating to ${url}...`);
    await page.goto(url, { waitUntil: 'domcontentloaded' });

    // Select all paper links (dt elements contain the links)
    const paperLinks = await page.locator('dt a[title="Abstract"]').all();

    const limitText = limit > 0 ? limit.toString() : 'ALL';
    console.log(`[${category}] Found ${paperLinks.length} papers. Processing ${limitText}.`);
    const papersToProcess = limit > 0 ? paperLinks.slice(0, limit) : paperLinks;
    const papers: Paper[] = [];

    const urls: string[] = [];
    for (const link of papersToProcess) {
        const href = await link.getAttribute('href');
        if (href) {
            const id = href.split('/').pop() || '';
            if (checkExists && checkExists(id)) {
                // skip already known papers
            } else {
                urls.push(`https://arxiv.org${href}`);
            }
        }
    }

    // Close the list page
    await page.close();

    // Now visit each paper page
    for (const url of urls) {
        console.log(`[${category}] Scraping ${url}...`);
        const paperPage = await session.newPage();
        try {
            await paperPage.goto(url, { waitUntil: 'domcontentloaded' });

            const title = await paperPage.locator('h1.title').innerText().then(t => t.replace('Title:', '').trim());
            const abstract = await paperPage.locator('blockquote.abstract').innerText().then(t => t.replace('Abstract:', '').trim());
            const pdfLinkValue = await paperPage.locator('div.full-text a.download-pdf').getAttribute('href');
            const pdfLink = pdfLinkValue ? `https://arxiv.org${pdfLinkValue}` : undefined;
            const id = url.split('/').pop() || '';

            papers.push({
                id,
                title,
                abstract,
                link: url,
                pdfLink,
                category,
            });
        } catch (e) {
            console.error(`[${category}] Failed to scrape ${url}:`, e);
        } finally {
            await paperPage.close();
        }

        // Be nice to arXiv
        await new Promise(r => setTimeout(r, 1000));
    }

    return papers;
}
