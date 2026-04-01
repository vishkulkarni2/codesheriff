# autotune — Self-Improving Detection Loop

## Goal
Maximize F1 score across all detection categories (auth, hallucination, logic) by
continuously generating and testing variants of semgrep rules and Claude prompts.

## What the agent can modify
- `corpus/` — add new labeled code snippets to improve coverage
- `evolvers/rule-evolver.ts` — change how semgrep rule variants are generated
- `evolvers/prompt-evolver.ts` — change how Claude prompt variants are generated
- Seed rules and seed prompts inside `loop.ts`

## What the agent CANNOT modify
- `metrics/index.ts` — the F1/precision/recall formulas are ground truth
- `corpus/types.ts` — the CorpusEntry schema is fixed
- `logger.ts` — the TSV format must remain stable for analysis
- Any file outside `packages/autotune/`

## Loop

```
generate variants (Claude)
    ↓
test each variant (semgrep / Claude-as-judge)
    ↓
compare F1 vs baseline
    ↓
keep if F1 improves, discard if not
    ↓
log result to evolution-log.tsv
    ↓
repeat forever
```

## Metrics
- **True Positive (TP)**: vulnerable snippet flagged by the rule/prompt ✓
- **False Positive (FP)**: safe snippet flagged by the rule/prompt ✗
- **False Negative (FN)**: vulnerable snippet NOT flagged ✗
- **True Negative (TN)**: safe snippet NOT flagged ✓
- **F1** = 2 × (precision × recall) / (precision + recall)

High precision → fewer false alarms for developers.
High recall → fewer missed vulnerabilities.
F1 balances both.

## Stopping condition
The loop never stops on its own. It runs until:
- `--dry-run` flag is passed (one cycle then exit)
- The process receives SIGINT (Ctrl+C)
- The process is killed by an external scheduler (cron, systemd, etc.)

## Adding corpus entries
New entries belong in `corpus/{category}/{label}-{NNN}.ts`.
File must start with:
```
// @description <one-line description of the pattern>
// @expectedRuleIds <comma-separated semgrep rule IDs>  (optional)
```
The rest of the file is the code snippet.

## Interpreting evolution-log.tsv
| Column | Meaning |
|--------|---------|
| commit | Short run ID (timestamp + random suffix) |
| type | `rule` or `prompt` |
| category | `auth`, `hallucination`, or `logic` |
| f1 | F1 score of the winner from this cycle |
| precision | Precision of the winner |
| recall | Recall of the winner |
| status | `keep` (F1 improved), `discard` (no improvement), `crash` (error) |
| description | cycle number + confusion matrix counts |
