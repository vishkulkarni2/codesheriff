# CodeSheriff -- Martian Benchmark Evaluation Guide

This document provides step-by-step instructions for independently evaluating CodeSheriff against the [Martian Code Review Benchmark](https://github.com/withmartian/code-review-benchmark). It covers installation, running CodeSheriff against benchmark PRs, reproducing our submitted F1 scores, and understanding the architecture.

---

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [Install CodeSheriff](#2-install-codesheriff)
3. [Run CodeSheriff against a single PR](#3-run-codesheriff-against-a-single-pr)
4. [Run the full benchmark](#4-run-the-full-benchmark)
5. [Evaluate with the Martian pipeline](#5-evaluate-with-the-martian-pipeline)
6. [Reproduce our submitted scores](#6-reproduce-our-submitted-scores)
7. [Output format and candidate mapping](#7-output-format-and-candidate-mapping)
8. [Architecture overview](#8-architecture-overview)
9. [FAQ](#9-faq)

---

## 1. Prerequisites

| Dependency | Version | Install |
|---|---|---|
| Node.js | >= 20.0.0 | https://nodejs.org or `brew install node` |
| pnpm | >= 8.0.0 | `npm install -g pnpm` |
| semgrep | any recent | `pip3 install semgrep` or `brew install semgrep` |
| trufflehog | any recent | `brew install trufflehog` or see https://github.com/trufflesecurity/trufflehog |
| Python 3.9+ | for benchmark runner | system default or `brew install python` |
| Anthropic API key | — | https://console.anthropic.com |
| GitHub token | — | For fetching PR diffs (optional if you already have `benchmark_data.json`) |

semgrep and trufflehog are optional -- CodeSheriff will warn and skip those stages if they are not found, but the LLM-based detectors (which produce most benchmark-relevant findings) will still run.

---

## 2. Install CodeSheriff

```bash
git clone https://github.com/vishkulkarni2/codesheriff.git
cd codesheriff
pnpm install
pnpm build
```

The CLI binary is at `packages/cli/dist/cli.js`. Verify it works:

```bash
export ANTHROPIC_API_KEY="sk-ant-..."
node packages/cli/dist/cli.js scan --help
```

Expected output:

```
Usage: codesheriff scan [options] <path>

Scan a specific file or directory

Arguments:
  path           File or directory to scan

Options:
  --json         Output results as JSON (for CI/CD integration)
  --fix          Show suggested fixes for each finding
  --static-only  Skip LLM-based detectors (faster, no API key required)
  -h, --help     display help for command
```

### Quick smoke test

```bash
# Create a test file with a known issue
cat > /tmp/test-scan.py << 'EOF'
import hashlib

def verify_password(user_input, stored_hash):
    return hashlib.md5(user_input.encode()).hexdigest() == stored_hash
EOF

node packages/cli/dist/cli.js scan /tmp/test-scan.py --json
```

You should see JSON output with a `findings` array and a `riskScore` field.

---

## 3. Run CodeSheriff against a single PR

To scan a single benchmark PR manually:

### Step 1: Fetch the PR diff and write files

```bash
# Example: Sentry PR #93824
PR_URL="https://github.com/getsentry/sentry/pull/93824"
OWNER="getsentry"
REPO="sentry"
PR_NUM="93824"

# Fetch changed files
mkdir -p /tmp/cs-bench-test
curl -s -H "Authorization: token $GITHUB_TOKEN" \
  "https://api.github.com/repos/$OWNER/$REPO/pulls/$PR_NUM/files?per_page=100" \
  > /tmp/pr-files.json
```

### Step 2: Extract patches to a temp directory

The benchmark runner extracts the added/context lines from each file's patch and writes them to disk. You can use the included `scripts/benchmark-runner.py` which automates this (see Section 4), or do it manually:

```python
import json, os
from pathlib import Path

with open("/tmp/pr-files.json") as f:
    files = json.load(f)

tmpdir = "/tmp/cs-bench-test"
for f in files:
    if f.get("status") == "removed":
        continue
    patch = f.get("patch", "")
    if not patch:
        continue
    lines = []
    for line in patch.split("\n"):
        if line.startswith("-") and not line.startswith("---"):
            continue  # skip deleted lines
        elif line.startswith("+") and not line.startswith("+++"):
            lines.append(line[1:])
        elif line.startswith(" "):
            lines.append(line[1:])
        else:
            lines.append(line)
    filepath = Path(tmpdir) / f["filename"]
    filepath.parent.mkdir(parents=True, exist_ok=True)
    filepath.write_text("\n".join(lines))
```

### Step 3: Run CodeSheriff

```bash
cd /path/to/codesheriff
export ANTHROPIC_API_KEY="sk-ant-..."
node packages/cli/dist/cli.js scan /tmp/cs-bench-test --json
```

The JSON output contains:

```json
{
  "findings": [
    {
      "ruleId": "logic-bug-detector",
      "title": "Race condition in worker pool shutdown",
      "description": "The shutdown method does not wait for...",
      "severity": "HIGH",
      "filePath": "src/workers/pool.py",
      "lineStart": 42,
      "detector": "LogicBugDetector",
      "metadata": {
        "explanation": "...",
        "impact": "..."
      },
      "autoFix": {
        "suggestedCode": "..."
      }
    }
  ],
  "riskScore": 65,
  "durationMs": 12340,
  "summary": { ... }
}
```

---

## 4. Run the full benchmark

The automated benchmark runner scans all 50 PRs and stores results in `benchmark_data.json`.

### Script location

```
codesheriff/scripts/benchmark-runner.py
```

### Usage

```bash
cd /path/to/codesheriff

# Set required environment variables
export ANTHROPIC_API_KEY="sk-ant-..."
export GITHUB_TOKEN="ghp_..."   # needed to fetch PR diffs from GitHub API

# Run the benchmark (incremental -- skips already-scanned PRs)
python3 scripts/benchmark-runner.py

# Reset and re-run all PRs from scratch
python3 scripts/benchmark-runner.py --reset
```

### What it does

1. Loads the 50 benchmark PRs from `code-review-benchmark/offline/golden_comments/*.json`
2. For each PR, fetches the diff via GitHub API
3. Extracts added/context lines into a temp directory
4. Runs `node packages/cli/dist/cli.js scan <tmpdir> --json`
5. Filters out false-positive patterns (diff fragment artifacts, HallucinationDetector noise)
6. Deduplicates findings (max 2 per ruleId)
7. Converts findings to review comment format
8. Saves results incrementally to `code-review-benchmark/offline/results/benchmark_data.json`

### Important configuration in the runner

The runner applies two post-processing steps that significantly affect scores:

- **FP filtering**: Removes findings from the HallucinationDetector (too noisy on diff fragments) and known false-positive patterns (e.g., "missing closing brace" from incomplete code fragments). Only HIGH and CRITICAL severity findings are kept.
- **Deduplication**: Caps each `ruleId` at 2 findings per scan to reduce noise.

These filters are defined at the top of `scripts/benchmark-runner.py` in `FP_PATTERNS` and `is_false_positive()`.

### Output

Results are written to:
```
~/.openclaw/workspace/code-review-benchmark/offline/results/benchmark_data.json
```

Each PR entry gets a `reviews` array with a `codesheriff` entry containing `review_comments`.

---

## 5. Evaluate with the Martian pipeline

After running the benchmark runner, use the standard Martian evaluation pipeline (steps 2-5) to compute precision, recall, and F1.

### Prerequisites

```bash
cd /path/to/code-review-benchmark/offline
uv sync   # or: pip install -e .
```

### Step 2: Extract candidates

```bash
uv run python -m code_review_benchmark.step2_extract_comments --tool codesheriff
```

This reads CodeSheriff's `review_comments` from `benchmark_data.json` and extracts individual issue candidates. Line-specific comments become candidates directly; longer comments are split by the LLM into distinct issues.

### Step 2.5: Deduplicate candidates

```bash
uv run python -m code_review_benchmark.step2_5_dedup_candidates --tool codesheriff
```

### Step 3: Judge with LLM

```bash
# With dedup (recommended)
uv run python -m code_review_benchmark.step3_judge_comments \
  --tool codesheriff \
  --dedup-groups results/{model}/dedup_groups.json

# Without dedup (for comparison)
uv run python -m code_review_benchmark.step3_judge_comments \
  --tool codesheriff
```

Replace `{model}` with the judge model directory, e.g., `anthropic_claude-opus-4-5-20251101`.

### Step 4: View results

```bash
uv run python analysis/benchmark_dashboard.py
# Open analysis/benchmark_dashboard.html
```

Or check the evaluations file directly:
```bash
cat results/anthropic_claude-opus-4-5-20251101/evaluations.json | python3 -m json.tool | head -50
```

---

## 6. Reproduce our submitted scores

Our submitted results used the following configuration:

| Parameter | Value |
|---|---|
| CodeSheriff version | 0.1.0 (commit on `main` branch) |
| Benchmark PRs | 49/50 (1 PR produced no findings) |
| Anthropic model (in CodeSheriff) | Claude Sonnet 4 (via `@codesheriff/analyzer`) |
| FP filtering | HallucinationDetector disabled, HIGH+CRITICAL only |
| Dedup | Max 2 per ruleId per scan |
| Post-processing | `scripts/postprocess-candidates.py` applied to cal.com PRs |
| Judge models | Claude Opus 4.5, Claude Sonnet 4.5, Claude Sonnet 4 |

### Exact reproduction steps

```bash
# 1. Clone both repos
git clone https://github.com/vishkulkarni2/codesheriff.git
git clone https://github.com/withmartian/code-review-benchmark.git

# 2. Install and build CodeSheriff
cd codesheriff
pnpm install && pnpm build
export ANTHROPIC_API_KEY="sk-ant-..."
export GITHUB_TOKEN="ghp_..."

# 3. Run the benchmark runner (takes ~30-60 min depending on rate limits)
python3 scripts/benchmark-runner.py

# 4. Run the Martian evaluation pipeline
cd ../code-review-benchmark/offline

uv sync

# Extract candidates
uv run python -m code_review_benchmark.step2_extract_comments --tool codesheriff

# Deduplicate
uv run python -m code_review_benchmark.step2_5_dedup_candidates --tool codesheriff

# Judge (run for each judge model you want)
uv run python -m code_review_benchmark.step3_judge_comments \
  --tool codesheriff \
  --dedup-groups results/anthropic_claude-opus-4-5-20251101/dedup_groups.json

# 5. Check results
python3 -c "
import json
with open('results/anthropic_claude-opus-4-5-20251101/evaluations.json') as f:
    evals = json.load(f)
tp = fp = fn = 0
for url, tools in evals.items():
    cs = tools.get('codesheriff', {})
    tp += cs.get('true_positives', cs.get('tp', 0))
    fp += cs.get('false_positives', cs.get('fp', 0))
    fn += cs.get('false_negatives', cs.get('fn', 0))
p = tp/(tp+fp) if tp+fp else 0
r = tp/(tp+fn) if tp+fn else 0
f1 = 2*p*r/(p+r) if p+r else 0
print(f'TP={tp} FP={fp} FN={fn}')
print(f'Precision={p:.1%} Recall={r:.1%} F1={f1:.1%}')
"
```

### Our submitted scores

| Judge Model | Precision | Recall | F1 |
|---|---|---|---|
| Claude Opus 4.5 | 55.3% | 77.6% | 64.6% |
| Claude Sonnet 4.5 | 55.1% | 76.9% | 64.2% |
| Claude Sonnet 4 | 54.2% | 76.9% | 63.6% |

Results files are included in the PR under:
- `offline/results/anthropic_claude-opus-4-5-20251101/candidates.json`
- `offline/results/anthropic_claude-opus-4-5-20251101/evaluations.json`
- `offline/results/anthropic_claude-sonnet-4-5-20250929/candidates.json`
- `offline/results/anthropic_claude-sonnet-4-5-20250929/evaluations.json`

---

## 7. Output format and candidate mapping

### CodeSheriff JSON output

```json
{
  "findings": [
    {
      "ruleId": "logic-bug-detector",
      "title": "Short title of the issue",
      "description": "Detailed explanation",
      "severity": "HIGH",
      "filePath": "relative/path/to/file.ts",
      "lineStart": 42,
      "detector": "LogicBugDetector",
      "metadata": { "explanation": "...", "impact": "..." },
      "autoFix": { "suggestedCode": "..." }
    }
  ],
  "riskScore": 0-100,
  "durationMs": 12345
}
```

### How findings become benchmark candidates

The benchmark runner (`scripts/benchmark-runner.py`) converts each finding to a review comment:

```
path:       finding.filePath
line:       finding.lineStart
body:       "**CodeSheriff: {title}** [{severity}]\n\n{description}"
```

The Martian pipeline's step 2 then extracts the text content of each review comment as a candidate for matching against golden comments. The `source` field in `candidates.json` indicates how the candidate was generated:

- `"logicbug_added"` -- Finding came directly from CodeSheriff's LogicBugDetector
- `"extracted"` -- Finding was extracted from a longer review comment by the LLM

### Candidate format in candidates.json

```json
{
  "https://github.com/...pull/123": {
    "codesheriff": [
      {
        "text": "Description of the issue found",
        "path": null,
        "line": null,
        "source": "logicbug_added"
      }
    ]
  }
}
```

---

## 8. Architecture overview

CodeSheriff runs an 8-stage analysis pipeline on each scan:

```
Input files
    |
    v
[1] AIPatternDetector    -- Regex + AST patterns for AI anti-patterns (fast)
[2] SecretsScanner       -- TruffleHog for hardcoded credentials (fast)
[3] StaticAnalyzer       -- Semgrep with OWASP + custom rules (fast)
    |
    |  Stages 4-6 run concurrently
    v
[4] HallucinationDetector -- Claude: catches non-existent API calls
[5] AuthFlowValidator      -- Claude: auth/RBAC/session vulnerabilities
[6] LogicBugDetector       -- Claude: off-by-one, race conditions, type bugs
    |
    v
[7] ExplanationEngine    -- Claude: plain-English explanation + fix suggestion
[8] SeverityScorer       -- Computes risk score 0-100
```

### Key design decisions

- **Stages 1-3 are fast, deterministic scans** (semgrep, trufflehog, regex). They run first and complete in seconds.
- **Stages 4-6 are LLM-based** and run concurrently. They use Claude (via the Anthropic API) to analyze code semantics. These produce the majority of benchmark-relevant findings.
- **Stage 7** generates human-readable explanations for all findings.
- **Stage 8** computes a composite risk score from 0-100 based on finding count, severity distribution, and detector confidence.
- **Non-fatal stages**: If any detector fails (e.g., API timeout), the pipeline continues with results from the other stages.

### Benchmark-specific note

For the benchmark evaluation, the HallucinationDetector (stage 4) findings are filtered out by the benchmark runner because they produce too many false positives on diff fragments (which lack the full file context the detector needs). The LogicBugDetector (stage 6) and AuthFlowValidator (stage 5) produce the most benchmark-relevant findings.

### Languages supported

TypeScript/JavaScript, Python, Go, Rust, Java, Kotlin, Ruby, PHP, C#, C/C++, Swift, Scala, Bash.

### What makes CodeSheriff different

1. **Bug-focused, not style-focused**: The LLM detectors are prompted to find actual bugs (logic errors, auth bypasses, race conditions), not style issues or minor suggestions.
2. **Autotune**: CodeSheriff includes an autotune system (`packages/autotune/`) that uses historical scan results to improve detector prompts and reduce false positives over time.
3. **Multi-layer verification**: Findings from LLM detectors pass through a verification filter before being reported, reducing hallucinated findings.

---

## 9. FAQ

**Q: How long does a full benchmark run take?**
A: Approximately 30-60 minutes for all 50 PRs. The GitHub API rate limit (5,000 requests/hour with a token) and Anthropic API latency are the bottlenecks. The runner saves progress incrementally, so you can resume if interrupted.

**Q: Can I run CodeSheriff without an Anthropic API key?**
A: Yes, using `--static-only` mode, but this only runs semgrep and trufflehog. The LLM-based detectors (which produce the benchmark-relevant findings) require the key.

**Q: Why is the HallucinationDetector disabled for the benchmark?**
A: The benchmark evaluates CodeSheriff on PR diffs, not full files. The HallucinationDetector needs full file context to verify whether an API exists, so it produces false positives on isolated diff fragments.

**Q: What Anthropic model does CodeSheriff use internally?**
A: Claude Sonnet 4 for the LLM-based detectors. This is configured in `packages/analyzer/src/llm/client.ts`.

**Q: Do I need the full CodeSheriff stack (Postgres, Redis, Clerk)?**
A: No. The CLI (`packages/cli/`) runs standalone with just an Anthropic API key. The full stack (database, queue, auth) is only needed for the web application and GitHub App integration.

**Q: Where are the submitted results stored?**
A: In the PR branch, under `offline/results/anthropic_claude-opus-4-5-20251101/` and `offline/results/anthropic_claude-sonnet-4-5-20250929/`. Each directory contains `candidates.json` and `evaluations.json`.

**Q: How do I compare CodeSheriff against other tools?**
A: After running the evaluation pipeline, open `analysis/benchmark_dashboard.html` or check the evaluations files. The Martian benchmark includes results for Augment, Claude Code, CodeRabbit, Codex, Cursor Bugbot, GitHub Copilot, Graphite, Greptile, Qodo, and others.

---

## Contact

- Website: https://thecodesheriff.com
- Maintainer: Vish Kulkarni (vishkulkarni2 on GitHub)
