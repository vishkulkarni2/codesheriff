# Martian Code Review Benchmark -- CodeSheriff Results

**Date:** April 1, 2026
**Benchmark:** Martian Code Review Bench (Offline) v2026-03
**Judge Model:** Claude Sonnet 4 (claude-sonnet-4-20250514)

---

## Summary

| Metric | Value |
|--------|-------|
| **F1 Score** | **8.7%** |
| Precision | 5.0% |
| Recall | 35.3% |
| True Positives | 6 |
| False Positives | 115 |
| False Negatives | 11 |
| PRs Evaluated | 6 / 50 (cal.com only) |
| Total Candidates | 121 |

**Status: NOT READY FOR SUBMISSION**

---

## Key Findings

### 1. Coverage Gap
CodeSheriff only produced reviews for **6 out of 50 benchmark PRs**, all from the cal.com (TypeScript) repository. No reviews were generated for:
- Sentry (Python)
- Grafana (Go)
- Keycloak (Java)
- Discourse (Ruby)

This means the scan was incomplete. The benchmark requires coverage across all 50 PRs and 5 repositories to be competitive.

### 2. Precision is Critically Low (5.0%)
Of 121 candidate issues CodeSheriff raised, only 6 matched real golden issues. The dominant failure mode is **generic, repetitive warnings** that do not correspond to actual bugs:
- "Deep property access without optional chaining" (repeated across many files/PRs)
- "Missing authorization check" (generic, not specific to the actual code issue)
- "Organization verification status hardcoded" (not a real bug in context)

For comparison, the top tools achieve 40-60% precision on the same cal.com PRs.

### 3. Recall is Moderate (35.3%)
When CodeSheriff does find real issues, the recall is reasonable (35.3%), meaning it catches about 1 in 3 actual bugs. However, this is measured on only 6 PRs (17 golden comments) so the sample is too small to be meaningful.

### 4. True Positive Examples (What CodeSheriff Got Right)
- Detected `===` comparison on dayjs objects always returning false (cal.com #8330)
- Found async functions not awaiting delete operations (cal.com #7232)
- Identified backup codes decrypted/mutated in memory issue (cal.com #10600)
- Caught potential null reference on mainHostDestinationCalendar (cal.com #10967)
- Found forEach with async callbacks issue (cal.com #8087)

---

## Per-PR Breakdown

| PR | TP | FP | FN | Precision | Recall |
|----|---:|---:|---:|----------:|-------:|
| cal.com #8330 | 1 | 8 | 1 | 11.1% | 50.0% |
| cal.com #22345 | 0 | 4 | 2 | 0.0% | 0.0% |
| cal.com #7232 | 2 | 19 | 0 | 9.5% | 100.0% |
| cal.com #10600 | 1 | 48 | 3 | 2.0% | 25.0% |
| cal.com #10967 | 1 | 22 | 4 | 4.3% | 20.0% |
| cal.com #8087 | 1 | 14 | 1 | 6.7% | 50.0% |
| **Total** | **6** | **115** | **11** | **5.0%** | **35.3%** |

---

## Comparison vs. Top Tools (All 3 Judge Models, Full 50 PRs)

### Full Benchmark (50 PRs)

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
| -- | **CodeSheriff** | **n/a** | **n/a** | **n/a** | **8.7%*** |

*CodeSheriff evaluated with claude-sonnet-4-20250514 judge only, on 6/50 PRs.

### Cal.com-Only Comparison (10 PRs, for context)

On the same repository (cal.com), other tools with the Opus 4.5 judge score:

| Tool | F1 (cal.com) |
|------|-------------:|
| Sourcery | 61.8% |
| Qodo Ext Summary | 56.1% |
| Cubic v2 | 53.5% |
| Devin | 54.5% |
| Augment | 51.2% |
| **CodeSheriff** | **8.7%** |

---

## Root Cause Analysis

### Why Precision is So Low
1. **Generic rule-based findings**: CodeSheriff applies static-analysis-style rules (e.g., "optional chaining missing") broadly, generating many warnings that are technically valid but not actual bugs
2. **No context awareness**: The tool flags patterns without understanding whether they represent real issues in the specific codebase context
3. **No deduplication of rule types**: The same rule (e.g., Ts Optional Chain Missing) fires dozens of times across a single PR

### Why Coverage is Incomplete
1. CodeSheriff only reviewed cal.com (TypeScript) PRs -- the other 4 repos use Python, Go, Java, and Ruby
2. This suggests either language support limitations or incomplete GitHub App installation across benchmark fork repos

---

## Recommendations Before Benchmark Submission

1. **DO NOT SUBMIT** these results to Martian. An 8.7% F1 would place CodeSheriff near the bottom of the leaderboard, below even tools that score 0% (which at least don't generate noise).

2. **Fix multi-language support**: Ensure CodeSheriff can analyze Python, Go, Java, and Ruby PRs to cover all 50 benchmark PRs.

3. **Dramatically reduce false positives**: The #1 priority is precision. Consider:
   - Suppressing generic/repetitive warnings (optional chaining, authorization checks)
   - Adding severity thresholds -- only report High/Critical issues
   - Using LLM-based filtering to determine if a finding is a real bug vs. a style nit

4. **Re-run the benchmark** after fixes, targeting at minimum 30% F1 (which would place CodeSheriff in the middle of the pack).

5. **Target for launch**: 40%+ F1 would be competitive (top 15). 50%+ F1 would be noteworthy.

---

## Pipeline Details

- **Extraction**: Step 2 extracted 121 candidates from 6 CodeSheriff reviews (all cal.com PRs)
- **Deduplication**: Step 2.5 grouped candidates; 6 dedup groups found
- **Judging**: Step 3 evaluated all 121 candidates against golden comments using claude-sonnet-4-20250514
- **Benchmark repo**: `~/.openclaw/workspace/code-review-benchmark/offline/`
- **Results file**: `results/claude-sonnet-4-20250514/evaluations.json`
