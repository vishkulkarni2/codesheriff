# CodeSheriff Evaluation Gap Analysis

## Current Performance

- **F1 Score**: 12.6% (official: 12.2%)
- **Precision**: 8.5% (target: 30%+)
- **Recall**: 24.1% (target: 50%+)
- **TP**: 33 | **FP**: 355 | **FN**: 104

Target: 40%+ F1 to be competitive.

---
## 1. What Bugs Are We Missing? (FN by Category)

| Bug Type | Count | High/Critical | Medium | Low |
|----------|-------|---------------|--------|-----|
| incorrect_value | 30 | 9 | 11 | 10 |
| api_misuse | 21 | 6 | 9 | 6 |
| logic_error | 12 | 4 | 6 | 2 |
| other | 9 | 0 | 0 | 9 |
| race_condition | 8 | 5 | 1 | 2 |
| null_reference | 7 | 4 | 2 | 1 |
| security | 6 | 4 | 2 | 0 |
| missing_validation | 5 | 1 | 1 | 3 |
| dead_code | 3 | 1 | 0 | 2 |
| type_error | 3 | 2 | 1 | 0 |

### Key Observations

1. **incorrect_value** (30 misses): The largest category. Wrong variable, key, or constant used.
   Requires deep semantic understanding -- hard to catch with static rules alone.

2. **api_misuse** (21 misses): Wrong API calls, missing parameters, incorrect method signatures.
   E.g., Django querysets don't support negative slicing, picocli.exit() calls System.exit().

3. **logic_error** (12 misses): Inverted conditions, wrong operators (AND vs OR), broken control flow.

4. **race_condition** (8 misses): Thread safety issues. We generate some race findings but miss many.

5. **null_reference** (7 misses): Missing null/nil/None checks. We generate null-related findings
   but often on wrong targets.

---
## 2. What False Positives Are We Generating?

### FP Volume by Repository

| Repository | FP Count | % of Total |
|------------|----------|-----------|
| cal.com | 219 | 61.7% |
| discourse-graphite | 85 | 23.9% |
| keycloak | 22 | 6.2% |
| grafana | 19 | 5.4% |
| keycloak-greptile | 4 | 1.1% |
| sentry-greptile | 4 | 1.1% |
| sentry | 2 | 0.6% |

### FP Categories (heuristic classification)

| Pattern | Count | % of Total |
|---------|-------|-----------|
| other/generic warnings | 243 | 68.5% |
| auth/security warnings | 48 | 13.5% |
| error handling warnings | 27 | 7.6% |
| null/undefined safety warnings | 22 | 6.2% |
| race condition warnings | 15 | 4.2% |

### Key Observations

1. **cal.com generates 62% of all FPs** (219/355). TypeScript analysis is way too noisy.
2. **discourse-graphite generates 24% of FPs** (85/355). Ruby analysis also over-triggers.
3. **Most impactful precision fix**: cap findings per PR to top-3 or top-5 by confidence.

---
## 3. Weakest Repositories

| Repository | Language | F1 | Precision | Recall | Issue |
|------------|----------|-----|-----------|--------|-------|
| sentry | Python | 0.0% | 0.0% | 0.0% | 0 TP on 6 PRs. Python rules missing/ineffective. |
| keycloak | Java | 8.7% | 8.3% | 9.1% | Only 2 TP on 9 PRs. Complex auth domain. |
| keycloak-greptile | Java | 0.0% | 0.0% | 0.0% | No matches. 4 FP, 2 FN. |
| sentry-greptile | Python | 11.1% | 20.0% | 7.7% | 1 TP out of 13 golden. Very weak Python. |
| discourse-graphite | Ruby | 10.1% | 6.6% | 21.4% | Some recall (21%) but 6.6% precision. Too noisy. |
| cal.com | TypeScript | 14.1% | 8.0% | 61.3% | Best recall (61%) but 8% precision. Drowns in noise. |
| grafana | Go | 21.7% | 20.8% | 22.7% | Best balance. 21% precision, 23% recall. Needs more. |

---
## 4. Path to 40% F1

### Strategy: Combined Precision + Recall

1. **Cap findings per PR to top-5 by confidence** (immediate precision gain)
2. **Filter common FP patterns** (optional chaining, generic security advice)
3. **Add 10 targeted rules** from quick-wins analysis
4. **Fix Python/Sentry coverage** (0% recall is unacceptable)

### Projected Impact

| Strategy | TP | FP | FN | Precision | Recall | F1 |
|----------|----|----|-----|-----------|--------|-----|
| Current | 33 | 355 | 104 | 8.5% | 24.1% | 12.6% |
| Cap to 5/PR | ~33 | ~217 | ~104 | 13.2% | 24.1% | 17.1% |
| Cap to 3/PR | ~30 | ~120 | ~107 | 20.0% | 21.9% | 20.9% |
| Cap 5/PR + 10 new rules | ~43 | ~207 | ~94 | 17.2% | 31.4% | 22.2% |
| Cap 3/PR + 10 new rules | ~40 | ~110 | ~97 | 26.7% | 29.2% | 27.9% |
| Cap 3/PR + 20 new rules + Python fix | ~55 | ~100 | ~82 | 35.5% | 40.1% | 37.6% |

To reach 40%+ F1: catch ~55 golden comments (40% recall) with ~100 FP (35%+ precision).
