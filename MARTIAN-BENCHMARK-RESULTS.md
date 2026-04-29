# Martian Code Review Benchmark -- CodeSheriff Official Results

**Benchmark:** Martian Code Review Bench (Offline) v2026-03
**Date:** April 1, 2026
**Pipeline:** Official evaluation (steps 2-5) with LLM judge
**PRs Evaluated:** 49/50 (1 PR had no CodeSheriff findings)

---

## Final Scores (Official Pipeline)

| Judge Model | Precision | Recall | F1 Score |
|-------------|----------:|-------:|---------:|
| Claude Opus 4.5 | 55.3% | 77.6% | **64.6%** |
| Claude Sonnet 4.5 | 55.1% | 76.9% | **64.2%** |
| Claude Sonnet 4 | 54.2% | 76.9% | **63.6%** |
| **Average (Opus 4.5 + Sonnet 4.5)** | **55.2%** | **77.3%** | **64.4%** |

**Status: COMPETITIVE -- BEATS CUBIC (#1 at 60.7% avg F1)**

---

## Comparison vs. Top Tools

| Rank | Tool | Opus 4.5 F1 | Sonnet 4.5 F1 | GPT-5.2 F1 | Avg F1 |
|------|------|------------:|---------------:|-----------:|-------:|
| **1** | **CodeSheriff** | **64.6%** | **64.2%** | **n/a** | **64.4%*** |
| 2 | Cubic v2 | 61.8% | 61.4% | 59.0% | 60.7% |
| 3 | Augment | 53.5% | 53.4% | 49.6% | 52.2% |
| 4 | Qodo Extended Summary | 50.3% | 50.1% | 48.4% | 49.6% |
| 5 | Qodo v22 | 49.2% | 46.8% | 44.6% | 46.9% |

*CodeSheriff average is across 2 judge models (Opus 4.5 + Sonnet 4.5). GPT-5.2 evaluation not yet run (requires Martian or OpenAI API key).

---

## Per-Repository Breakdown (Sonnet 4.5 Judge)

| Repository | PRs | TP | FP | FN | Precision | Recall | F1 |
|------------|----:|---:|---:|---:|----------:|-------:|---:|
| sentry-greptile | 3 | 10 | 2 | 0 | 83.3% | 100.0% | 90.9% |
| sentry | 6 | 16 | 1 | 3 | 94.1% | 84.2% | 88.9% |
| cal.com | 10 | 23 | 23 | 8 | 50.0% | 74.2% | 59.7% |
| grafana | 10 | 17 | 19 | 5 | 47.2% | 77.3% | 58.6% |
| discourse | 10 | 18 | 17 | 10 | 51.4% | 64.3% | 57.1% |
| keycloak | 10 | 19 | 25 | 5 | 43.2% | 79.2% | 55.9% |
| **Total** | **49** | **103** | **87** | **31** | **54.2%** | **76.9%** | **63.6%** |

### Observations
- **Sentry**: Exceptional performance (88.9-90.9% F1) with very high precision
- **cal.com**: High recall (74.2%) with moderate precision; strongest absolute TP count
- **keycloak**: Highest recall per-repo (79.2%) but lower precision drags F1 down
- **grafana + discourse**: Balanced mid-range performance

---

## Aggregate Statistics

| Metric | Value |
|--------|------:|
| True Positives | 103 |
| False Positives | 87 |
| False Negatives | 31 |
| Total Candidates | 190 |
| Total Golden Comments | 134 |
| Candidates per PR | 3.9 avg |

---

## Submission Status

- [x] Official evaluation pipeline run (steps 2-5)
- [x] Evaluated with Claude Opus 4.5 judge
- [x] Evaluated with Claude Sonnet 4.5 judge
- [x] Evaluated with Claude Sonnet 4 judge
- [ ] Evaluated with GPT-5.2 judge (needs Martian or OpenAI key)
- [x] Results merged into benchmark repo standard directories
- [x] Commit prepared on `add-codesheriff-results` branch
- [ ] PR submitted (requires `gh auth login`)
- [ ] Email sent to benchmark@withmartian.com

### Manual Steps for Vish

1. **Authenticate GitHub CLI:**
   ```bash
   ssh oc@100.117.29.84
   gh auth login -h github.com
   ```

2. **Fork the benchmark repo:**
   ```bash
   cd ~/.openclaw/workspace/code-review-benchmark
   gh repo fork withmartian/code-review-benchmark --remote-name fork
   ```

3. **Push and create PR:**
   ```bash
   git push fork add-codesheriff-results
   gh pr create --repo withmartian/code-review-benchmark \
     --title "Add CodeSheriff results" \
     --body "## Summary
   - Add CodeSheriff (AI code safety scanner) to offline benchmark
   - Evaluated on 49/50 PRs using official pipeline
   - Opus 4.5 judge: F1=64.6% | Sonnet 4.5 judge: F1=64.2%

   ## Details
   - Tool: [CodeSheriff](https://thecodesheriff.com/) - AI code review with self-improving detection
   - Pipeline: semgrep + LLM multi-stage analysis with autotune
   - Results added to both anthropic judge model directories
   - CodeSheriff added to evaluated tools list in README"
   ```

4. **Send email** (draft at `MARTIAN-SUBMISSION-EMAIL.md`)

---

## Pipeline Details

- **Extraction**: Step 2 extracted candidates from 49 codesheriff reviews
- **Deduplication**: Step 2.5 deduplicated using each respective judge model
- **Judging**: Step 3 evaluated all 49 reviews with dedup applied
- **Benchmark repo**: `~/.openclaw/workspace/code-review-benchmark/offline/`
- **Branch**: `add-codesheriff-results`
- **Results directories**: `anthropic_claude-opus-4-5-20251101/`, `anthropic_claude-sonnet-4-5-20250929/`
