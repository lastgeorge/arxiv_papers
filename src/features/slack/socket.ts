import { SocketModeClient, LogLevel } from '@slack/socket-mode';
import { AppConfig } from '../../shared/config.js';
import { savePaper } from '../arxiv/saver.js';
import { getPaper, updatePaperPdfPath } from '../../shared/db.js';

export async function startSocketMode(config: AppConfig) {
    if (!config.slack.appToken) {
        console.warn('Skipping Socket Mode: SLACK_APP_TOKEN not provided.');
        return null;
    }

    const client = new SocketModeClient({
        appToken: config.slack.appToken,
        logLevel: LogLevel.ERROR,
    });

    client.on('interactive', async ({ body, ack }) => {
        await ack();

        if (body.type === 'block_actions') {
            for (const action of body.actions) {
                if (action.type === 'button' && action.value?.startsWith('save_')) {
                    const paperId = action.value.replace('save_', '');
                    console.log(`[Socket] Save button clicked for ${paperId}`);

                    const paper = getPaper(paperId);
                    if (!paper) {
                        console.error(`[Socket] Paper ${paperId} not found in DB.`);
                        return;
                    }

                    if (paper.pdf_path) {
                        console.log(`[Socket] Paper ${paperId} already saved.`);
                        return;
                    }

                    try {
                        console.log(`[Socket] Downloading PDF for ${paperId}...`);
                        const date = new Date(paper.scanned_at);
                        const pdfPath = await savePaper(paperId, paper.category || 'hep-ex', date);
                        updatePaperPdfPath(paperId, pdfPath);
                        console.log(`[Socket] Saved to ${pdfPath}`);

                        // Ideally we would update the message here, but for now just logging.
                    } catch (e) {
                        console.error(`[Socket] Failed to save paper ${paperId}:`, e);
                    }
                }
            }
        }
    });

    await client.start();
    console.log('Socket Mode client started. Listening for interactions...');
    return client;
}
