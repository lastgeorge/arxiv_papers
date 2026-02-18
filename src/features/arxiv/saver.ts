import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { finished } from 'node:stream/promises';
import { ReadableStream } from 'node:stream/web';

export async function savePaper(paperId: string, category: string = 'hep-ex', dateObj?: Date): Promise<string> {
    const date = dateObj || new Date();
    const year = date.getFullYear().toString();
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');

    // Save to category-specific subfolder: ./arxiv_papers/{category}/YYYY/MM/DD
    const baseDir = path.resolve(process.cwd(), 'arxiv_papers', category, year, month, day);

    if (!fs.existsSync(baseDir)) {
        fs.mkdirSync(baseDir, { recursive: true });
    }

    const filename = `${paperId}.pdf`;
    const filepath = path.join(baseDir, filename);

    if (fs.existsSync(filepath)) {
        console.log(`Paper ${paperId} already saved at ${filepath}`);
        return filepath;
    }

    const pdfUrl = `https://arxiv.org/pdf/${paperId}.pdf`;
    console.log(`Downloading ${pdfUrl} to ${filepath}...`);

    const MAX_RETRIES = 5;
    const RETRY_DELAY_MS = 10000;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            const response = await fetch(pdfUrl, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.114 Safari/537.36'
                }
            });

            if (!response.ok) {
                throw new Error(`Status ${response.status} ${response.statusText}`);
            }

            const contentType = response.headers.get('content-type');
            if (contentType && !contentType.includes('application/pdf')) {
                throw new Error(`Invalid content-type: ${contentType}. Likely still generating.`);
            }

            if (!response.body) {
                throw new Error('No response body');
            }

            const fileStream = fs.createWriteStream(filepath);
            // @ts-ignore
            await finished(Readable.fromWeb(response.body as ReadableStream).pipe(fileStream));

            console.log(`Saved ${filepath}`);
            return filepath;

        } catch (e) {
            console.warn(`Attempt ${attempt}/${MAX_RETRIES} failed for ${paperId}: ${e}`);

            // Clean up partial file
            if (fs.existsSync(filepath)) {
                fs.unlinkSync(filepath);
            }

            if (attempt < MAX_RETRIES) {
                console.log(`Waiting ${RETRY_DELAY_MS / 1000}s before retrying...`);
                await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
            } else {
                console.error(`Failed to download paper ${paperId} after ${MAX_RETRIES} attempts.`);
                throw e;
            }
        }
    }

    throw new Error('Unreachable');
}
