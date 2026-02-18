import 'dotenv/config';
import { Command } from 'commander';
import type { FormPlugin, GlobalOptions } from './plugin.js';
import { arxivPlugin } from './features/arxiv/index.js';

const plugins: FormPlugin[] = [
    arxivPlugin,
];

function registerGlobalOptions(cmd: Command): void {
    cmd
        .option('--headless', 'Run browser in headless mode', true)
        .option('--dry-run', 'Run without side effects', false);
}

async function main() {
    const program = new Command();

    program
        .name('arxiv-agent')
        .description('arXiv Scanning and Summarization Agent');

    for (const plugin of plugins) {
        const sub = program
            .command(plugin.name)
            .description(plugin.description);

        registerGlobalOptions(sub);
        plugin.registerOptions(sub);

        sub.action(async (subOpts) => {
            const globalOpts: GlobalOptions = {
                headless: subOpts.headless !== 'false', // Commander treats bool flags differently if not careful, but here we assume standard behavior
                dryRun: subOpts.dryRun ?? false,
            };
            try {
                await plugin.run(subOpts, globalOpts);
                process.exit(0);
            } catch (error) {
                console.error('\n[FATAL]', error);
                process.exit(1);
            }
        });
    }

    await program.parseAsync();
}

main();
