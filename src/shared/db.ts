import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';

const dataDir = path.resolve(process.cwd(), 'data');
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

const db = new Database(path.join(dataDir, 'papers.db'));

// Initialize tables
db.exec(`
    CREATE TABLE IF NOT EXISTS papers (
        id TEXT PRIMARY KEY,
        title TEXT,
        summary TEXT,
        published_date TEXT,
        scanned_at DATETIME,
        slack_ts TEXT,
        pdf_path TEXT,
        saved_at DATETIME,
        category TEXT
    )
`);

try {
    db.exec('ALTER TABLE papers ADD COLUMN category TEXT');
} catch (e) {
    // Column likely already exists
}

export interface PaperRecord {
    id: string;
    title: string;
    summary: string;
    published_date: string;
    scanned_at: string;
    slack_ts?: string;
    pdf_path?: string;
    saved_at?: string;
    category?: string;
}

export function savePaperToDb(paper: PaperRecord) {
    const stmt = db.prepare(`
        INSERT OR IGNORE INTO papers (id, title, summary, published_date, scanned_at, slack_ts, pdf_path, saved_at, category)
        VALUES (@id, @title, @summary, @published_date, @scanned_at, @slack_ts, @pdf_path, @saved_at, @category)
    `);

    // convert string[] authors to JSON string
    const data = {
        ...paper,
        slack_ts: paper.slack_ts || null,
        pdf_path: paper.pdf_path || null,
        saved_at: paper.saved_at || null,
        category: paper.category || 'hep-ex',
    };

    stmt.run(data);
}

export function getPaper(id: string): PaperRecord | undefined {
    const stmt = db.prepare('SELECT * FROM papers WHERE id = ?');
    const row = stmt.get(id) as any;
    if (!row) return undefined;

    return {
        ...row,
    };
}

export function updatePaperSlackTs(id: string, slackTs: string) {
    const stmt = db.prepare('UPDATE papers SET slack_ts = ? WHERE id = ?');
    stmt.run(slackTs, id);
}

export function updatePaperPdfPath(id: string, pdfPath: string, savedAt: string = new Date().toISOString()) {
    const stmt = db.prepare('UPDATE papers SET pdf_path = ?, saved_at = ? WHERE id = ?');
    stmt.run(pdfPath, savedAt, id);
}

export function getAllPapers(): PaperRecord[] {
    const stmt = db.prepare('SELECT * FROM papers');
    const rows = stmt.all() as any[];
    return rows.map(row => ({
        ...row,
    }));
}

export function getPapersWithoutPdf(): PaperRecord[] {
    const stmt = db.prepare('SELECT * FROM papers WHERE pdf_path IS NULL AND slack_ts IS NOT NULL');
    const rows = stmt.all() as any[];
    return rows.map(row => ({
        ...row,
    }));
}

export function deletePapers(ids: string[]) {
    if (ids.length === 0) return;
    const placeholders = ids.map(() => '?').join(',');
    const stmt = db.prepare(`DELETE FROM papers WHERE id IN (${placeholders})`);
    stmt.run(...ids);
}
