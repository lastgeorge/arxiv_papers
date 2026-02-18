import { WebClient } from '@slack/web-api';
import type { AppConfig } from '../../shared/config.js';
import type { SummarizedPaper } from './summarizer.js';

export async function sendSummariesToSlack(papers: SummarizedPaper[], config: AppConfig): Promise<Map<string, string>> {
    if (!config.slack.botToken || !config.slack.channelId) {
        console.warn('Slack not configured, skipping notification.');
        return new Map();
    }

    const client = new WebClient(config.slack.botToken);

    if (papers.length === 0) {
        await client.chat.postMessage({
            channel: config.slack.channelId,
            text: 'No relevant papers found in the latest scan.',
        });
        return new Map();
    }

    // Group papers by category for the intro message
    const categories = [...new Set(papers.map(p => p.category || 'unknown'))];
    const catLabel = categories.join(', ');

    // Send an intro message
    await client.chat.postMessage({
        channel: config.slack.channelId,
        text: `Found ${papers.length} new relevant papers in [${catLabel}]:`,
        unfurl_links: false,
        unfurl_media: false,
    });

    const sentMessages = new Map<string, string>();

    for (const paper of papers) {
        const blocks = [
            {
                type: 'section',
                text: {
                    type: 'mrkdwn',
                    text: `*[${paper.category || 'hep-ex'}] <${paper.link}|${paper.title}>*\n${paper.summary}`,
                },
            },
            {
                type: 'actions',
                elements: [
                    {
                        type: 'button',
                        text: {
                            type: 'plain_text',
                            text: 'Save PDF 💾',
                        },
                        value: `save_${paper.id}`,
                        action_id: `save_${paper.id}`,
                    },
                    {
                        type: 'button',
                        text: {
                            type: 'plain_text',
                            text: 'Read on arXiv 📄',
                        },
                        url: paper.link,
                    }
                ],
            },
            {
                type: 'context',
                elements: [
                    {
                        type: 'mrkdwn',
                        text: '💡 _Click "Save PDF" or react with :floppy_disk: to save._',
                    },
                ],
            },
            {
                type: 'divider',
            },
        ];

        try {
            const response = await client.chat.postMessage({
                channel: config.slack.channelId,
                blocks,
                text: `New Paper: ${paper.title}`, // Fallback text
                unfurl_links: false,
                unfurl_media: false,
            });

            if (response.ok && response.ts) {
                sentMessages.set(paper.id, response.ts);
            }
        } catch (e) {
            console.error(`Failed to send Slack message for paper ${paper.id}:`, e);
        }
    }

    return sentMessages;
}
