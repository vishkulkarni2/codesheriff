#!/bin/bash
export PATH="/opt/homebrew/bin:/opt/homebrew/Cellar/node/25.8.2/bin:$PATH"
cd "$HOME/.openclaw/workspace/codesheriff"

# Load .env.production
set -a
source .env.production
set +a

# Override placeholders
export ANTHROPIC_API_KEY="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"
export GITHUB_APP_PRIVATE_KEY="$(cat github-app-private-key.pem)"

exec node packages/api/dist/index.js
