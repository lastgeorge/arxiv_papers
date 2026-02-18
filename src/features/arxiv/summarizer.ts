import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';
import fs from 'node:fs/promises';
import path from 'node:path';
import { type AppConfig } from '../../shared/config.js';
import { type Paper } from './scraper.js';

export interface SummarizedPaper extends Paper {
    summary: string;
    relevance: 'RELEVANT' | 'IRRELEVANT';
    // Paper already has abstract, so it will be preserved if we spread ...paper
}

export async function summarizePapers(papers: Paper[], config: AppConfig, batchSize: number = 10): Promise<SummarizedPaper[]> {
    const genAI = new GoogleGenerativeAI(config.gemini.apiKey);
    const model = genAI.getGenerativeModel({
        model: config.gemini.model,
        generationConfig: {
            responseMimeType: 'application/json',
            responseSchema: {
                type: SchemaType.ARRAY,
                items: {
                    type: SchemaType.OBJECT,
                    properties: {
                        id: { type: SchemaType.STRING },
                        relevance: { type: SchemaType.STRING, enum: ['RELEVANT', 'IRRELEVANT'], format: 'enum' },
                        summary: { type: SchemaType.STRING },
                    },
                    required: ['id', 'relevance'],
                },
            },
        },
    });

    let promptInstructions = '';
    try {
        promptInstructions = await fs.readFile(path.resolve(process.cwd(), 'prompt.txt'), 'utf-8');
    } catch (e) {
        console.warn('Could not read prompt.txt, using default filter.');
        promptInstructions = 'Filter for High Energy Physics experiments.';
    }

    const allSummarized: SummarizedPaper[] = [];

    // Process in batches
    for (let i = 0; i < papers.length; i += batchSize) {
        const batch = papers.slice(i, i + batchSize);
        console.log(`Summarizing batch ${Math.floor(i / batchSize) + 1} of ${Math.ceil(papers.length / batchSize)} (${batch.length} papers)...`);

        const papersForPrompt = batch.map(p => ({
            id: p.id,
            title: p.title,
            abstract: p.abstract,
        }));

        const prompt = `
You are an expert physicist assistant.
${promptInstructions}

Task:
Evaluate the following papers.
For each paper:
1. Determine if it is RELEVANT or IRRELEVANT based on the criteria.
2. If RELEVANT, provide a 2-sentence summary.
3. If IRRELEVANT, the summary field can be empty.

Input Papers:
${JSON.stringify(papersForPrompt, null, 2)}
`;

        try {
            const result = await model.generateContent(prompt);
            const responseText = result.response.text();
            const evaluatedPapers = JSON.parse(responseText) as Array<{ id: string; relevance: 'RELEVANT' | 'IRRELEVANT'; summary?: string }>;

            const evaluatedMap = new Map(evaluatedPapers.map(p => [p.id, p]));

            for (const paper of batch) {
                const evaluation = evaluatedMap.get(paper.id);
                // Default to IRRELEVANT if not found in LLM response
                const relevance = evaluation?.relevance || 'IRRELEVANT';
                const summary = evaluation?.summary || '';

                allSummarized.push({
                    ...paper,
                    summary,
                    relevance,
                });
            }
        } catch (e) {
            console.error(`Failed to summarize batch starting at index ${i}:`, e);
            // Add failed papers as IRRELEVANT to avoid losing them entirely? 
            // Or just skip? Let's add them as unprocessed/IRRELEVANT for now to be safe.
            for (const paper of batch) {
                allSummarized.push({
                    ...paper,
                    summary: 'Failed to summarize',
                    relevance: 'IRRELEVANT',
                });
            }
        }

        // Rate limiting / niceness
        if (i + batchSize < papers.length) {
            await new Promise(r => setTimeout(r, 2000));
        }
    }

    return allSummarized;
}
