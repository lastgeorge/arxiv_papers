# arxiv-agent

An automated tool that scrapes arXiv for new physics papers, summarizes them using Google Gemini AI, posts them to Slack, and lets you save PDFs of interesting ones with a button click or emoji reaction.

## Features

- Scrapes new or recent papers from configurable arXiv categories
- Summarizes papers for relevance using Gemini AI (with a customizable prompt)
- Posts relevant papers to Slack with "Save PDF" action buttons
- Polls Slack reactions (🔖) or listens for button clicks to download PDFs on demand
- Stores papers in a local SQLite database for deduplication across runs
- Optional web UI (port 3000) to browse and manage saved papers

## Requirements

- Node.js 18+
- A Google Gemini API key
- Slack bot and app tokens (optional, for Slack integration)

## Installation

```bash
npm install
npx playwright install chromium  # only needed on first install
```

## Configuration

Copy `.env.example` to `.env` (or create `.env`) and fill in the values:

```env
GEMINI_API_KEY=your_gemini_api_key
GEMINI_MODEL=gemini-1.5-flash        # or any compatible model

# Optional — required only for Slack integration
SLACK_BOT_TOKEN=xoxb-...
SLACK_APP_TOKEN=xapp-...
SLACK_CHANNEL_ID=C...

# Browser options
HEADLESS=true     # set to false to watch the browser
SLOW_MO=0         # milliseconds of slowdown between actions
```

### Relevance Prompt

Edit `prompt.txt` to define what counts as a relevant paper. The file is sent verbatim to Gemini. The expected output is either the word `IRRELEVANT` or a two-sentence summary for relevant papers.

## Usage

```bash
# Scan new papers, summarize, post to Slack, then poll for 2 minutes
npm start -- arxiv

# Limit to 10 papers per category (useful for testing)
npm start -- arxiv --limit 10

# Scan "recent" papers instead of "new submissions"
npm start -- arxiv --recent

# Change which arXiv categories are scanned
npm start -- arxiv --categories "hep-ex,nucl-ex,physics.ins-det"

# Adjust Gemini batch size (papers sent per API call)
npm start -- arxiv --batch-size 5

# Only poll Slack for reactions — skip scanning entirely
npm start -- arxiv --check-slack

# Change the Slack polling window (minutes)
npm start -- arxiv --wait 5

# Start the web UI on port 3000
npm start -- arxiv --web

# Run without writing to the DB or posting to Slack
npm start -- arxiv --dry-run

# Show the browser window while scraping
npm start -- arxiv --headless false
```

All options can be combined. The `run_agent.sh` convenience script passes arguments straight through to `npm start`.

## Code Structure

```
src/
├── main.ts                    # CLI entry point (Commander.js)
├── plugin.ts                  # FormPlugin interface for extensibility
├── features/
│   ├── arxiv/
│   │   ├── index.ts           # Main orchestrator — wires everything together
│   │   ├── scraper.ts         # Playwright-based arXiv scraper
│   │   ├── summarizer.ts      # Gemini AI batched summarization
│   │   ├── saver.ts           # PDF downloader with retry logic
│   │   └── notifier.ts        # Slack message formatter and poster
│   ├── slack/
│   │   ├── checker.ts         # Polls Slack for 🔖 reactions
│   │   └── socket.ts          # Real-time Slack Socket Mode button handler
│   └── web/
│       └── server.ts          # Express.js web UI (port 3000)
└── shared/
    ├── config.ts              # Loads and validates environment variables
    ├── db.ts                  # SQLite operations (better-sqlite3)
    └── browser/
        └── setup.ts           # Playwright Chromium configuration
```

### How it works

```
CLI (main.ts)
  └─▶ arxiv plugin (features/arxiv/index.ts)
        ├─▶ Scraper       — visits arxiv.org and extracts paper metadata
        ├─▶ Summarizer    — sends batches to Gemini, receives relevance + summary
        ├─▶ Database      — deduplicates and persists relevant papers (SQLite)
        ├─▶ Notifier      — posts papers to Slack with action buttons
        ├─▶ Checker       — polls Slack reactions every 30 s
        ├─▶ Socket        — listens for button clicks in real time
        ├─▶ Saver         — downloads PDFs on demand
        └─▶ Web server    — optional Express.js UI on port 3000
```

### Key files to edit

| Goal | File |
|---|---|
| Change what counts as relevant | `prompt.txt` |
| Add a new arXiv category | pass `--categories` flag, or change the default in `features/arxiv/index.ts` |
| Change how papers are posted to Slack | `features/arxiv/notifier.ts` |
| Add a new CLI command | implement `FormPlugin` in a new file and register it in `main.ts` |
| Change the database schema | `shared/db.ts` |
| Change the web UI API | `features/web/server.ts` |

### Data storage

| What | Where |
|---|---|
| SQLite database | `data/papers.db` |
| Downloaded PDFs | `arxiv_papers/{category}/{YYYY}/{MM}/{DD}/{id}.pdf` |
| JSON summaries | `data/arxiv-summary.json` (combined), `data/arxiv-summary-{category}.json` |

## Development

```bash
# Run directly from TypeScript source (no build step needed)
npm start -- arxiv --dry-run --limit 5

# Type-check and compile to dist/
npm run build
```

The project uses ES modules (`"type": "module"` in package.json) and targets Node.js with `NodeNext` module resolution. `tsx` is used for running TypeScript directly during development.
