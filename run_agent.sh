#!/bin/bash
# Helper script to run the arXiv agent
# Usage: ./run_agent.sh [options]
# Example: ./run_agent.sh --limit 50

npm start -- arxiv "$@"
