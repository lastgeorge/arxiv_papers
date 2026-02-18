import type { Command } from 'commander';

export interface FormPlugin {
    readonly name: string;
    readonly description: string;
    registerOptions(subcommand: Command): void;
    run(opts: Record<string, unknown>, globalOpts: GlobalOptions): Promise<void>;
}

export interface GlobalOptions {
    headless: boolean;
    dryRun: boolean;
}
