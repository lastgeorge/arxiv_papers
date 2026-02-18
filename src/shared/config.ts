import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface AppConfig {
    gemini: { apiKey: string; model: string };
    browser: { headless: boolean; slowMo: number };
    slack: { botToken?: string; appToken?: string; channelId?: string };
    screenshotDir: string;
}

function requireEnv(name: string): string {
    const value = process.env[name];
    if (!value) {
        throw new Error(`Missing required environment variable: ${name}`);
    }
    return value;
}

export function loadConfig(): AppConfig {
    return {
        gemini: {
            apiKey: requireEnv('GEMINI_API_KEY'),
            model: process.env['GEMINI_MODEL'] || 'gemini-1.5-flash',
        },
        browser: {
            headless: process.env['HEADLESS'] !== 'false', // Default to true
            slowMo: parseInt(process.env['SLOW_MO'] || '100', 10),
        },
        slack: {
            botToken: process.env['SLACK_BOT_TOKEN'],
            appToken: process.env['SLACK_APP_TOKEN'],
            channelId: process.env['SLACK_CHANNEL_ID'],
        },
        screenshotDir: path.resolve(__dirname, '..', '..', 'screenshots'),
    };
}
