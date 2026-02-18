import { WebClient } from '@slack/web-api';
import { type AppConfig } from '../../shared/config.js';
import { getPaper, updatePaperPdfPath, getPapersWithoutPdf } from '../../shared/db.js';
import { savePaper } from '../arxiv/saver.js';

export async function checkSlackForSavedPapers(config: AppConfig, dryRun: boolean = false) {
    if (!config.slack.botToken || !config.slack.channelId) {
        console.warn('Slack not configured.');
        return;
    }

    const client = new WebClient(config.slack.botToken);
    console.log('Checking Slack for saved papers...');

    // 1. Fetch recent history
    const history = await client.conversations.history({
        channel: config.slack.channelId,
        limit: 50, // Check last 50 messages
    });

    if (!history.messages) {
        console.log('No messages found.');
        return;
    }

    let savedCount = 0;

    for (const message of history.messages) {
        // We only care about messages with reactions
        if (!message.reactions || message.reactions.length === 0) continue;

        // Check for floppy_disk reaction
        const saveReaction = message.reactions.find(r => r.name === 'floppy_disk');
        if (!saveReaction) continue;

        // Extract paper ID from message text
        let paperId: string | null = null;

        // Strategy 1: Check message text (fallback)
        const textMatch = message.text?.match(/arxiv\.org\/abs\/([^\s|]+)/);
        if (textMatch) {
            paperId = textMatch[1];
        }

        // Strategy 2: Check blocks (rich text)
        if (!paperId && message.blocks) {
            const blocksJson = JSON.stringify(message.blocks);
            const blockMatch = blocksJson.match(/arxiv\.org\/abs\/([^\s|"\\]+)/);
            if (blockMatch) {
                paperId = blockMatch[1];
            } else {
                console.log(`[DEBUG] Could not find arXiv ID in blocks for message: ${message.text?.substring(0, 50)}...`);
            }
        }

        if (!paperId) {
            console.log(`[DEBUG] Skipped message with reaction but no ID found.`);
            continue;
        }

        // Check if already saved in DB
        const paper = getPaper(paperId);
        if (!paper) {
            console.warn(`Paper ${paperId} found in Slack but not in DB. Skipping.`);
            continue;
        }

        if (paper.pdf_path) {
            // Already saved locally
            continue;
        }

        // Save it!
        console.log(`Found save request for paper ${paperId} ("${paper.title}")`);

        if (dryRun) {
            console.log(`[DRY RUN] Would save paper ${paperId} and react with check mark.`);
            continue;
        }

        try {
            const pdfPath = await savePaper(paperId, paper.category || 'hep-ex');
            updatePaperPdfPath(paperId, pdfPath);
            savedCount++;

            // React with check mark to confirm
            await client.reactions.add({
                channel: config.slack.channelId,
                name: 'white_check_mark',
                timestamp: message.ts as string,
            });

        } catch (e) {
            console.error(`Failed to save paper ${paperId}:`, e);
            // Maybe react with x?
            try {
                await client.reactions.add({
                    channel: config.slack.channelId,
                    name: 'x',
                    timestamp: message.ts as string,
                });
            } catch (ignore) { }
        }
    }

    console.log(`Checked Slack. Saved ${savedCount} new papers.`);
}
