import fs from 'node:fs/promises';
import path from 'node:path';
import type { Command } from 'commander';
import type { FormPlugin, GlobalOptions } from '../../plugin.js';
import { loadConfig } from '../../shared/config.js';
import { setupBrowser } from '../../shared/browser/setup.js';
import { scrapeArxiv, type ScanMode } from './scraper.js';
import { summarizePapers } from './summarizer.js';
import { sendSummariesToSlack } from './notifier.js';
import { checkSlackForSavedPapers } from '../slack/checker.js';
import { startSocketMode } from '../slack/socket.js';
import { startServer } from '../web/server.js';
import { getPaper, savePaperToDb, updatePaperSlackTs } from '../../shared/db.js';
import type { SummarizedPaper } from './summarizer.js';

const DEFAULT_CATEGORIES = 'hep-ex,nucl-ex,physics.data-an';

export const arxivPlugin: FormPlugin = {
    name: 'arxiv',
    description: 'Scan and summarize arXiv papers',

    registerOptions(sub: Command) {
        sub.option('--limit <n>', 'Limit number of papers to scan per category (0 for all)', '0')
            .option('--scan', 'Explicitly enable scanning (required if combined with --web)', false)
            .option('--check-slack', 'Check Slack for saved papers instead of scanning', false)
            .option('--wait <n>', 'Wait and poll Slack for N minutes after finishing', '2')
            .option('--web', 'Start the web interface', false)
            .option('--batch-size <n>', 'Batch size for summarization', '10')
            .option('--categories <list>', 'Comma-separated list of arXiv categories', DEFAULT_CATEGORIES)
            .option('--recent', 'Scan recent papers instead of new', false);
    },

    async run(opts: Record<string, unknown>, globalOpts: GlobalOptions) {
        console.log('Starting arXiv agent...');
        const limit = parseInt(opts.limit as string || '0', 10);
        const batchSize = parseInt(opts.batchSize as string || '10', 10);
        const categories = (opts.categories as string || DEFAULT_CATEGORIES).split(',').map(c => c.trim());
        const mode: ScanMode = opts.recent ? 'recent' : 'new';

        // Load config
        const config = loadConfig();

        if (opts.web) {
            startServer();
        }

        // Determine if we should scan
        const shouldScrape = opts.scan || (!opts.checkSlack && !opts.web);

        // Start Socket Mode early so user can interact with Slack buttons during scanning
        let socketClient: Awaited<ReturnType<typeof startSocketMode>> = null;
        if (!opts.web && !globalOpts.dryRun) {
            socketClient = await startSocketMode(config);
        }

        if (opts.checkSlack) {
            await checkSlackForSavedPapers(config, globalOpts.dryRun);
        } else if (shouldScrape) {
            // Setup browser
            const browserConfig = {
                headless: globalOpts.headless,
                slowMo: config.browser.slowMo,
            };
            const session = await setupBrowser({ browser: browserConfig });

            try {
                // Collect ALL relevant summaries across categories for a single Slack notification
                const allRelevantSummaries: SummarizedPaper[] = [];
                const allSummarizedForFile: SummarizedPaper[] = [];

                for (const category of categories) {
                    console.log(`\n=== Scanning [${category}] (${mode}) ===`);

                    // 1. Scrape
                    const papers = await scrapeArxiv(session, category, mode, limit);
                    console.log(`[${category}] Scraped ${papers.length} papers.`);

                    // Filter out papers already in DB
                    const newPapers = papers.filter(p => !getPaper(p.id));
                    if (newPapers.length < papers.length) {
                        console.log(`[${category}] Skipping ${papers.length - newPapers.length} papers already in DB.`);
                    }

                    if (newPapers.length > 0) {
                        // 2. Summarize (separate Gemini query per category)
                        console.log(`[${category}] Summarizing ${newPapers.length} new papers...`);
                        const categorySummarized = await summarizePapers(newPapers, config, batchSize);
                        const categoryRelevant = categorySummarized.filter(p => p.relevance === 'RELEVANT');

                        console.log(`[${category}] Relevant: ${categoryRelevant.length}, Irrelevant: ${categorySummarized.length - categoryRelevant.length}`);

                        // 3. Save to per-category JSON file
                        const filename = `arxiv-summary-${category}.json`;
                        const filepath = path.resolve(process.cwd(), 'data', filename);

                        try {
                            await fs.mkdir(path.dirname(filepath), { recursive: true });
                            await fs.writeFile(filepath, JSON.stringify(categorySummarized, null, 2));
                            console.log(`[${category}] Saved report to ${filepath}`);
                        } catch (e) {
                            console.error(`[${category}] Failed to save summaries to file:`, e);
                        }

                        // Save to DB with correct category
                        for (const paper of categoryRelevant) {
                            savePaperToDb({
                                id: paper.id,
                                title: paper.title,
                                summary: paper.summary,
                                published_date: '',
                                scanned_at: new Date().toISOString(),
                                category,
                            });
                        }

                        allRelevantSummaries.push(...categoryRelevant);
                        allSummarizedForFile.push(...categorySummarized);

                        // 4. Notify Slack immediately for this category
                        if (categoryRelevant.length > 0) {
                            console.log(`[${category}] Sending ${categoryRelevant.length} relevant papers to Slack...`);
                            if (globalOpts.dryRun) {
                                console.log('[DRY RUN] Would send to Slack.');
                            } else {
                                const sentMap = await sendSummariesToSlack(categoryRelevant, config);
                                for (const [id, ts] of sentMap) {
                                    updatePaperSlackTs(id, ts);
                                }
                                console.log(`[${category}] Sent to Slack.`);
                            }
                        }
                    } else {
                        console.log(`[${category}] No new papers found.`);
                    }
                }

                // Also save a combined summary file for backward compat
                try {
                    const combinedPath = path.resolve(process.cwd(), 'data', 'arxiv-summary.json');
                    await fs.writeFile(combinedPath, JSON.stringify(allSummarizedForFile, null, 2));
                } catch (e) {
                    console.error('Failed to save combined summary:', e);
                }

                if (allRelevantSummaries.length === 0) {
                    console.log('\nNo new relevant papers found across all categories.');
                }

            } catch (e) {
                console.error('Error in arXiv workflow:', e);
                throw e;
            } finally {
                await session.browser.close();
            }
        }

        // POLLING LOOP
        const waitMins = parseFloat(opts.wait as string || '0');
        // Only poll if NOT web mode
        if (waitMins > 0 && !opts.web) {
            console.log(`\nEntering polling mode for ${waitMins} minutes...`);
            console.log('Press Ctrl+C to exit early.\n');

            const endTime = Date.now() + waitMins * 60 * 1000;
            const intervalMs = 30 * 1000;

            while (Date.now() < endTime) {
                await new Promise(r => setTimeout(r, intervalMs));
                try {
                    await checkSlackForSavedPapers(config, globalOpts.dryRun);
                } catch (e) {
                    console.error('Error during polling:', e);
                }
            }

            if (socketClient) {
                await socketClient.disconnect();
            }
            console.log('Polling finished.');
        }

        if (opts.web) {
            console.log('Web interface active. Press Ctrl+C to stop.');
            await new Promise(() => { });
        }
    },
};
