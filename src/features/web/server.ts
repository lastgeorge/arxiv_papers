import express from 'express';
import path from 'path';
import fs from 'fs';
import { getAllPapers, getPapersWithoutPdf, deletePapers, savePaperToDb, updatePaperPdfPath } from '../../shared/db.js';
import { savePaper } from '../arxiv/saver.js';

import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const port = 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/files', express.static(path.resolve(process.cwd(), 'arxiv_papers')));

app.get('/irrelevant', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'irrelevant.html'));
});

// API: Get papers with search and pagination
app.get('/api/papers', (req, res) => {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 50;
    const search = (req.query.q as string || '').toLowerCase();

    let papers = getAllPapers();
    // Filter to show ONLY papers with a saved PDF
    papers = papers.filter(p => p.pdf_path);

    if (search) {
        papers = papers.filter(p =>
            p.title.toLowerCase().includes(search) ||
            p.id.includes(search) ||
            (p.summary && p.summary.toLowerCase().includes(search))
        );
    }

    // Sort by scanned_at desc
    papers.sort((a, b) => new Date(b.scanned_at).getTime() - new Date(a.scanned_at).getTime());

    const startIndex = (page - 1) * limit;
    const endIndex = page * limit;
    const results = papers.slice(startIndex, endIndex);

    res.json({
        page,
        limit,
        total: papers.length,
        papers: results
    });
});

// API: Get latest summary JSON (supports ?category= query param)
app.get('/api/summary', (req, res) => {
    const category = (req.query.category as string) || '';
    // If category specified, load per-category file; otherwise load combined
    const filename = category ? `arxiv-summary-${category}.json` : 'arxiv-summary.json';
    const summaryPath = path.resolve(process.cwd(), 'data', filename);
    if (fs.existsSync(summaryPath)) {
        res.sendFile(summaryPath);
    } else {
        res.status(404).json({ error: `No summary file found for ${filename}` });
    }
});

// API: Delete papers
app.post('/api/delete', (req, res) => {
    const { ids } = req.body;
    if (!ids || !Array.isArray(ids)) {
        return res.status(400).json({ error: 'Invalid IDs' });
    }

    // Delete from DB and Filesystem
    // We need to implement deletePapers in db.ts or handle it here. 
    // Let's implement deletePapers in db.ts for cleaner separation.

    // For now, let's assume deletePapers exists and returns count
    // We also need to delete the files. 
    // Ideally deletePapers should return the deleted records so we know which files to delete.
    // Or we handle it here.

    // Let's fetch papers first to get paths
    const allPapers = getAllPapers();
    const toDelete = allPapers.filter(p => ids.includes(p.id));

    let deletedFiles = 0;
    toDelete.forEach(p => {
        if (p.pdf_path && fs.existsSync(p.pdf_path)) {
            try {
                fs.unlinkSync(p.pdf_path);
                deletedFiles++;
            } catch (e) {
                console.error(`Failed to delete file ${p.pdf_path}`, e);
            }
        }
    });

    try {
        deletePapers(ids);
        res.json({ success: true, deletedCount: ids.length, deletedFiles });
    } catch (e) {
        console.error('Delete failed', e);
        res.status(500).json({ error: 'Delete failed' });
    }
});
// API: Add paper (from irrelevant list)
app.post('/api/add', async (req, res) => {
    const { paper } = req.body;
    if (!paper || !paper.id) {
        return res.status(400).json({ error: 'Invalid paper data' });
    }

    console.log(`Adding paper ${paper.id}...`);

    try {
        // 1. Save to DB
        // Use abstract as summary as requested
        savePaperToDb({
            id: paper.id,
            title: paper.title,
            summary: paper.abstract || paper.summary || '',
            published_date: '', // TODO
            scanned_at: new Date().toISOString(),
            category: 'hep-ex', // Default
            saved_at: new Date().toISOString()
        });

        // 2. Download PDF
        try {
            const pdfPath = await savePaper(paper.id, paper.category || 'hep-ex');
            updatePaperPdfPath(paper.id, pdfPath);
            res.json({ success: true, pdfPath });
        } catch (downloadError) {
            console.error('Failed to download PDF', downloadError);
            // Return success but with warning? Or just error? 
            // The paper is in DB, so it's partially successful.
            res.json({ success: true, warning: 'Paper added to DB but PDF download failed' });
        }

    } catch (e) {
        console.error('Add failed', e);
        res.status(500).json({ error: 'Add failed' });
    }
});

import { exec } from 'child_process';

export function startServer() {
    app.listen(port, () => {
        const url = `http://localhost:${port}`;
        console.log(`Web interface running at ${url}`);
        exec(`open ${url}`);
    });
}
