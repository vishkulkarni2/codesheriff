# Martian Code Review Benchmark -- CodeSheriff Results

**Benchmark:** Martian Code Review Bench (Offline) v2026-03
**Judge Model:** Claude Sonnet 4 (claude-sonnet-4-20250514)

---

## v2 Results (April 1, 2026) -- Full 48-PR Evaluation

| Metric | v1 (6 PRs) | v2 (48 PRs) | Delta |
|--------|------------|-------------|-------|
| **F1 Score** | **8.7%** | **12.2%** | +3.5pp |
| Precision | 5.0% | 8.2% | +3.2pp |
| Recall | 35.3% | 23.5% | -11.8pp |
| True Positives | 6 | 31 | +25 |
| False Positives | 115 | 347 | +232 |
| False Negatives | 11 | 101 | +90 |
| PRs Evaluated | 6 / 50 | 48 / 50 | +42 PRs |
| Total Candidates | 121 | 378 | +257 |

**Status: IMPROVED BUT NOT COMPETITIVE**

Key changes from v1 to v2:
- Coverage expanded from 6 PRs (cal.com only) to 48 PRs across all 5 repos
- Precision improved from 5.0% to 8.2% (still very low)
- Recall dropped from 35.3% to 23.5% as harder repos were included
- F1 improved modestly from 8.7% to 12.2%

---

## Per-Repository Breakdown (v2)

| Repository | PRs | TP | FP | FN | Precision | Recall | F1 |
|------------|----:|---:|---:|---:|----------:|-------:|---:|
| sentry-greptile | 4 | 3 | 2 | 10 | 60.0% | 23.1% | 33.3% |
| grafana | 10 | 4 | 20 | 18 | 16.7% | 18.2% | 17.4% |
| discourse-graphite | 10 | 7 | 83 | 21 | 7.8% | 25.0% | 11.9% |
| cal.com | 10 | 15 | 214 | 16 | 6.6% | 48.4% | 11.5% |
| keycloak | 9 | 2 | 22 | 20 | 8.3% | 9.1% | 8.7% |
| keycloak-greptile | 1 | 0 | 4 | 2 | 0.0% | 0.0% | 0.0% |
| sentry | 4 | 0 | 2 | 14 | 0.0% | 0.0% | 0.0% |
| **Total** | **48** | **31** | **347** | **101** | **8.2%** | **23.5%** | **12.2%** |

### Observations by Repo
- **sentry-greptile** (F1=33.3%): Best precision (60%) -- few candidates but they were on target
- **grafana** (F1=17.4%): Decent balance, second-best precision (16.7%)
- **cal.com** (F1=11.5%): Highest recall (48.4%) but very low precision (6.6%) -- generates too much noise on TypeScript repos
- **sentry** (F1=0.0%): No true positives found at all on Python code
- **keycloak** (F1=8.7%): Poor on Java code

---

## Comparison vs. Top Tools (Full 50 PRs, All Judge Models)

| Rank | Tool | F1 (Opus 4.5) | F1 (Sonnet 4.5) | F1 (GPT-5.2) | Avg F1 |
|------|------|---------------:|----------------:|--------------:|-------:|
| 1 | Cubic v2 | 61.8% | 61.4% | 59.0% | 60.7% |
| 2 | Augment | 53.5% | 53.4% | 49.6% | 52.2% |
| 3 | Qodo Extended Summary | 50.3% | 50.1% | 48.4% | 49.6% |
| 4 | Qodo v22 | 49.2% | 46.8% | 44.6% | 46.9% |
| 5 | Qodo v2 | 48.4% | 47.1% | 44.0% | 46.5% |
| ... | ... | ... | ... | ... | ... |
| 15 | Claude (Sonnet) | 35.3% | 37.8% | 34.6% | 35.9% |
| 19 | Copilot | 37.0% | 35.5% | 33.6% | 35.4% |
| -- | **CodeSheriff v2** | **n/a** | **n/a** | **n/a** | **12.2%*** |
| -- | **CodeSheriff v1** | **n/a** | **n/a** | **n/a** | **8.7%*** |

*CodeSheriff evaluated with claude-sonnet-4-20250514 judge only, on 48/50 PRs (v2) or 6/50 PRs (v1).

---

## Root Cause Analysis

### Why Precision Remains Low (8.2%)
1. **Noise volume**: 378 candidates for 48 PRs = ~8 candidates/PR on average, but only 0.6 true positives/PR
2. **cal.com dominates noise**: 214 of 347 false positives (62%) come from cal.com TypeScript PRs
3. **Generic warnings persist**: Optional chaining, authorization checks, and other pattern-matching rules fire too broadly
4. **No severity filtering**: Low-confidence findings are not suppressed

### Why Recall is Moderate (23.5%)
1. **2 PRs with no reviews at all** (missing from benchmark_data entirely)
2. **sentry coverage is poor**: 0 TPs across 4 sentry PRs -- Python analysis is weak
3. **Strongest on cal.com**: 48.4% recall on TypeScript, but tanks on other languages

### Improvement from v1
1. **Multi-language support works**: Reviews now generated for Java, Go, Ruby, Python repos
2. **Precision improved 64%**: From 5.0% to 8.2% (still insufficient)
3. **More true positives**: 31 vs 6, finding real bugs across 5 repos

---

## Recommendations

1. **DO NOT SUBMIT** these results to Martian. A 12.2% F1 would place CodeSheriff near the bottom of the leaderboard.

2. **Priority 1 -- Reduce false positives**:
   - Add severity threshold: only report High/Critical
   - Filter generic/repetitive warnings (optional chaining, authorization)
   - Cap candidates per PR (e.g., top 5 highest confidence only)
   - Target: 30%+ precision

3. **Priority 2 -- Improve Python/sentry recall**:
   - 0% recall on sentry is unacceptable; investigate why no findings match
   - Check if Python-specific rules are generating relevant candidates

4. **Target for competitive submission**: 35%+ F1 (matches Claude/Copilot baseline)

5. **Target for launch**: 45%+ F1 (top 10 on leaderboard)

---

## Pipeline Details

- **Extraction**: Step 2 extracted candidates from 43 codesheriff reviews (some PRs had no review comments)
- **Deduplication**: Step 2.5 deduplicated 38 reviews
- **Judging**: Step 3 evaluated 48 reviews using claude-sonnet-4-20250514
- **Benchmark repo**: `~/.openclaw/workspace/code-review-benchmark/offline/`
- **Results file**: `results/claude-sonnet-4-20250514/evaluations.json`
- **No rate limiting issues encountered** (Anthropic API key used directly)
