#!/bin/bash
# Martian Code Review Benchmark Runner for CodeSheriff
# Fetches PR diffs, runs CodeSheriff scan, collects results

set -euo pipefail

export PATH="/Users/oc/Library/Python/3.9/bin:/opt/homebrew/bin:/opt/homebrew/Cellar/node/25.8.2/bin:$PATH"
export ANTHROPIC_API_KEY=$(grep ANTHROPIC_API_KEY ~/.zshrc | cut -d'"' -f2)

CODESHERIFF_DIR="$HOME/.openclaw/workspace/codesheriff"
BENCHMARK_DIR="$HOME/.openclaw/workspace/code-review-benchmark/offline"
RESULTS_DIR="$BENCHMARK_DIR/results"
GOLDEN_DIR="$BENCHMARK_DIR/golden_comments"
SCAN_CMD="node $CODESHERIFF_DIR/packages/cli/dist/cli.js scan"
TMPDIR_BASE="/tmp/codesheriff-benchmark"

mkdir -p "$RESULTS_DIR" "$TMPDIR_BASE"

echo "=== CodeSheriff Benchmark Runner ==="
echo "Timestamp: $(date)"

# Test that CodeSheriff works
echo "Testing CodeSheriff CLI..."
echo 'console.log("test")' > /tmp/test_cs.js
cd "$CODESHERIFF_DIR"
$SCAN_CMD /tmp/test_cs.js --json --static-only 2>/dev/null | head -5 && echo "CLI OK" || echo "CLI test noted"
rm -f /tmp/test_cs.js

echo "Done testing CLI"
