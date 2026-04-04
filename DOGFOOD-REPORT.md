# CodeSheriff CLI Dogfood Test Report

**Date:** 2026-04-03
**Tester:** Automated dogfood agent
**CLI Version:** codesheriff (from /Users/oc/.openclaw/workspace/codesheriff/packages/cli/)
**Node:** v25.8.2 on macOS (Mac Mini)

---

## Executive Summary

**Overall: FAIL** -- The CLI has a crash-level bug in the default (text) output mode that blocks all non-JSON usage. Two of three test repos were scanned successfully via --json workaround; the third ran out of API credits mid-scan. Several significant issues were found.

| Repo | Pass/Fail | Findings | Duration | Notes |
|------|-----------|----------|----------|-------|
| calendar_tools (Python, 11 files) | **FAIL** | 8 (via --json) | 25.7s | Text mode crashes; only 1/11 files scanned (extensionless scripts ignored) |
| aes-128-decryption-tool (TS, 8 files) | **PARTIAL** | 2 (via --json) | 10.9s | Text mode crashes; 3/8 files scanned; findings seem reasonable |
| saanvi (Python, 21 files) | **FAIL** | 8 partial (via --json) | 58.5s | API credits exhausted mid-scan; text mode crashes |

---

## Bug 1: BLOCKER -- Text Output Crashes on Every Scan

**Symptom:** `codesheriff scan <path>` (without --json) always crashes with:
```
Error: spinner?.text is not a function
```

**Root cause:** In `packages/cli/dist/commands/scan.js` (line ~41) and `review.js` (line ~45):
```js
spinner?.text(`Running analysis on ${files.length} files...`);
```
The ora spinner's `text` is a **property**, not a method. Should be:
```js
if (spinner) spinner.text = `Running analysis on ${files.length} files...`;
```

**Affected commands:** `scan` (text mode), `review` (text mode). The --json flag works because spinner is set to null in that path.

**Fix priority:** P0 -- this makes the default CLI experience completely broken.

---

## Bug 2: HIGH -- Extensionless Script Files Are Ignored

**Symptom:** The calendar_tools repo has 5 Python scripts without .py extensions (meeting_summary, add_to_calendar, ai_add_meeting, when2meet, _when2meet, _add_to_calendar). CodeSheriff only scanned 1 file (tests/test_meeting_summary.py).

**Impact:** For repos with extensionless scripts (common in Unix CLI tools, shebanged scripts, etc.), CodeSheriff misses the majority of the codebase. The test file was scanned but the actual application code was completely missed.

**Fix priority:** P1 -- File collector should check shebang lines (#!/usr/bin/env python3 etc.) for language detection when extensions are missing.

---

## Bug 3: HIGH -- Missing External Tool Dependencies (trufflehog, semgrep)

**Symptom:** Every scan logs errors:
```
SecretsScanner unexpected error: Failed to spawn trufflehog: spawn trufflehog ENOENT
StaticAnalyzer unexpected error: Failed to spawn semgrep: spawn semgrep ENOENT
```

**Impact:** SecretsScanner and StaticAnalyzer silently fail on every scan. The scan continues but these detectors produce zero findings. The user is never informed that critical scanning capabilities are missing.

**Notes:**
- In --json mode, these errors appear as raw structured log lines mixed into stdout -- they should go to stderr or be included in the JSON result under an errors/warnings field.
- In text mode, the user would never see these (because text mode crashes first), but even if fixed, there is no warning shown.

**Fix priority:** P1 -- At minimum, warn the user that dependencies are missing.

---

## Bug 4: MEDIUM -- File Count Discrepancy vs Reality

| Repo | Actual files (non-git) | Files scanned by CodeSheriff |
|------|------------------------|------------------------------|
| calendar_tools | 11 | 1 |
| aes-128-decryption-tool | 8 | 3 |
| saanvi | 21 | 13 |

Even for repos with proper extensions, CodeSheriff scans fewer files than exist. Some of this is expected (ignoring README.md, COPYING, .gitignore, config files), but the calendar_tools case (1/11) is extreme because of the extensionless file issue.

---

## Bug 5: MEDIUM -- JSON Output Mixes Structured Logs with Result JSON

When using --json, the output contains:
1. Structured pino log lines (pipeline started, detector complete, errors, etc.)
2. The actual JSON result object

These are all written to stdout. A CI/CD tool trying to parse the JSON output would fail because the log lines come first. The structured logs should go to stderr, or there should be a --quiet flag to suppress them.

---

## Bug 6: LOW -- API Credit Exhaustion Not Handled Gracefully

When Anthropic API credits are exhausted mid-scan:
- LLM-based detectors fail individually with full stack traces in logs
- The scan continues with partial results
- The final JSON result shows "passed": true and a low risk score even though most detectors failed
- No summary of which detectors failed is included in the result
- Exit code is 0 (success) despite detector failures

The user gets a false sense of security -- the scan "passed" but most analysis was skipped.

---

## Bug 7: LOW -- Duplicate scanId in Log Output

Every pipeline start log line contains scanId twice:
```json
{"scanId":"7a63df71-...","scanId":"7a63df71-...",...}
```

---

## Bug 8: LOW -- Node.js Deprecation Warning

Every invocation shows:
```
(node:PID) [DEP0040] DeprecationWarning: The `punycode` module is deprecated.
```
Should suppress with --no-deprecation or fix the dependency.

---

## Findings Accuracy Assessment

### calendar_tools (8 findings, all in tests/test_meeting_summary.py)

| # | Rule | Title | Sev | Accurate? | Notes |
|---|------|-------|-----|-----------|-------|
| 1 | hallucination:api-usage | type('module', (), {})() hallucinated | HIGH | **FALSE POSITIVE** | type() with 3 args creating a class, then () instantiates it -- this is valid Python |
| 2 | logic:ai-generated-bug | File path construction fragile | HIGH | **TRUE POSITIVE** | Valid concern -- relative path depends on CWD |
| 3 | logic:ai-generated-bug | File handle not properly closed | MEDIUM | **FALSE POSITIVE** | Uses with open(...) context manager which handles closing |
| 4 | logic:ai-generated-bug | exec() without sandboxing | HIGH | **TRUE POSITIVE** | Valid security concern |
| 5 | logic:ai-generated-bug | Flaky test at midnight | MEDIUM | **TRUE POSITIVE** | Real edge case |
| 6 | logic:ai-generated-bug | Flaky test at midnight (duplicate) | MEDIUM | **DUPLICATE** of #5 |
| 7 | logic:ai-generated-bug | Unclear assertion | LOW | **MARGINAL** | Assertion logic is clear enough in context |
| 8 | logic:ai-generated-bug | Flaky test at midnight (triplicate) | MEDIUM | **DUPLICATE** of #5 |

**Accuracy: 3 true positives, 2 false positives, 3 duplicates. Effective accuracy: ~60%.**

**Major miss:** The actual application code (meeting_summary, add_to_calendar, etc.) was never scanned because files lack extensions.

### aes-128-decryption-tool (2 findings)

| # | Rule | Title | Sev | Accurate? | Notes |
|---|------|-------|-----|-----------|-------|
| 1 | hallucination:api-usage | require.main === module hallucinated | MEDIUM | **TRUE POSITIVE** | Valid -- CJS pattern in likely ES module context |
| 2 | logic:ai-generated-bug | Missing await on main().catch() | HIGH | **FALSE POSITIVE** | .catch() on a Promise works fine without await |

**Accuracy: 1 true positive, 1 false positive. Effective accuracy: 50%.**

### saanvi (partial -- 8 findings before credit exhaustion)

Could not fully assess due to API credit exhaustion. HallucinationDetector found 2 findings and AuthFlowValidator found 6 before credits ran out. LogicBugDetector and ExplanationEngine failed.

---

## Edge Case Results

| Test | Result | Notes |
|------|--------|-------|
| Empty directory | **PASS** | Clean message in both text and JSON modes |
| Single file | **PASS** (--json only) | Text mode crashes (same spinner bug) |
| --fix flag | **UNTESTABLE** | API credits exhausted; no findings to show fixes for |
| review command | **FAIL** | Same spinner crash as scan |
| --static-only | **PASS** | Runs fast (9ms), but trufflehog/semgrep missing means zero findings |

---

## UX Issues

1. **No progress indication in --json mode.** Long scans (25+ seconds) produce no output until completion.
2. **No file list shown.** User cannot verify which files were actually scanned.
3. **Code snippets often empty.** Many findings have empty codeSnippet which makes them harder to evaluate.
4. **Duplicate findings not deduplicated.** The "flaky test at midnight" finding appeared 3 times.
5. **Risk score seems arbitrary.** calendar_tools got 74 (8 findings, mostly medium) while aes-128 got 22 (2 findings). The scoring formula is not transparent.
6. **No --verbose or --debug flag.** When things go wrong, the only way to see details is --json which dumps raw pino logs.

---

## Recommendations (Priority Order)

1. **P0: Fix spinner.text bug** -- Change spinner?.text(...) to property assignment in both scan.js and review.js. Rebuild.
2. **P1: Add shebang-based language detection** -- When a file has no extension, read the first line for #!/usr/bin/env python etc.
3. **P1: Handle missing trufflehog/semgrep gracefully** -- Show a warning like "SecretsScanner disabled: trufflehog not found."
4. **P1: Separate logs from JSON output** -- Send pino logs to stderr, JSON result to stdout only.
5. **P2: Deduplicate findings** -- Group similar findings or flag duplicates.
6. **P2: Handle API credit/auth errors gracefully** -- Fail fast with a clear message.
7. **P2: Include detector health in results** -- Add a "detectors" field showing which ran, which failed, and why.
8. **P3: Suppress Node.js deprecation warnings.**
9. **P3: Fix duplicate scanId in logs.**
10. **P3: Add --verbose flag for debugging.**

---

## Environment Notes

- trufflehog and semgrep are not installed on the Mac Mini. These are required dependencies.
- Anthropic API credits exhausted during testing. The API key in ~/.zshrc is valid but the account balance is zero.


---

# Re-Test Results After Bug Fixes

**Date:** 2026-04-01
**Tester:** Automated fix agent
**Fixes applied:** 5 bugs fixed (P0 x1, P1 x3, P2 x1)

---

## Fixes Applied

### 1. P0 FIXED: spinner.text() crash
- **Files:** `packages/cli/src/commands/scan.ts`, `packages/cli/src/commands/review.ts`
- **Change:** `spinner?.text(...)` changed to `if (spinner) spinner.text = ...`
- **Result:** Text mode output works for all commands (scan, review). No more crash.

### 2. P1 FIXED: Extensionless files ignored
- **File:** `packages/cli/src/lib/file-collector.ts`
- **Change:** Added `detectShebangLanguage()` function and `SHEBANG_LANG_MAP`. Files without extensions are now included in the glob results, and their first line is checked for shebangs (`#!/usr/bin/env python3`, `#!/usr/bin/node`, etc.). Files without a recognized shebang or extension are skipped.
- **Result:** calendar_tools now scans 5 files (up from 1). All 4 shebanged Python scripts + 1 .py test file are collected. Zsh completion files (`_add_to_calendar`, `_when2meet`) and config files are correctly excluded.

### 3. P1 FIXED: JSON output polluted with Pino logs
- **File:** `packages/analyzer/src/utils/logger.ts`
- **Change:** Added `pino.destination(2)` (fd 2 = stderr) as the second argument to the pino constructor.
- **Result:** `--json` output is now clean, parseable JSON on stdout. Pino structured logs go to stderr only.

### 4. P1 FIXED: Missing trufflehog/semgrep warning
- **File:** `packages/cli/src/cli.ts`
- **Change:** Added `checkExternalTools()` function that runs on startup. Checks for `semgrep` and `trufflehog` via `which`. Prints a yellow warning to stderr if either is missing.
- **Result:** Users now see: `Note: semgrep, trufflehog not found. Install them for full analysis.`

### 5. P2 FIXED: Duplicate findings
- **File:** `packages/cli/src/lib/renderer.ts`
- **Change:** Added `deduplicateFindings()` function that filters by `(filePath, lineStart, category)` key. Applied in `renderResults()` before both terminal and JSON rendering.
- **Result:** Duplicate findings are now suppressed. (Could not verify against LLM-generated duplicates since API key has no credits, but the dedup logic is in place.)

---

## Re-Test Results

| Repo | Text Mode | JSON Mode | Files Scanned | Findings | Duration | Notes |
|------|-----------|-----------|---------------|----------|----------|-------|
| calendar_tools | PASS | PASS | 5 (was 1) | 0 | 9ms | No API key; static-only. Extensionless files now collected. |
| aes-128-decryption-tool | PASS | PASS | 3 | 0 | 5ms | No API key; static-only. |
| saanvi | PASS | PASS | 13 | 0 | 9ms | No API key; static-only. |

### Edge Cases

| Test | Text Mode | JSON Mode | Notes |
|------|-----------|-----------|-------|
| Empty directory | PASS | PASS | Clean "No supported files" message |
| `review` command | PASS | N/A | Scanned codesheriff repo itself; found 8 CRITICAL + 22 LOW findings. No crash. |

### Notes

- **0 findings on dogfood repos:** All three test repos show 0 findings because `ANTHROPIC_API_KEY` is not set (credits exhausted), so LLM detectors are skipped. The `semgrep` and `trufflehog` tools are not installed, so SecretsScanner and StaticAnalyzer produce 0 findings. Only the AIPatternDetector (regex-based) runs, and it found nothing in these repos. This is expected behavior -- the CLI correctly downgrades to static-only mode and warns the user.
- **review command works well:** When run against the codesheriff repo itself, the AIPatternDetector correctly flags hardcoded API keys in shell scripts and test fixtures. This validates that the scanner pipeline is functional end-to-end for the non-LLM detectors.
- **Pino logs confirmed on stderr:** Running with `2>/dev/null` produces clean JSON output; running with `2>/tmp/file` captures all structured logs separately.
- **Semgrep/trufflehog warning confirmed:** Appears on stderr at startup.

---

## Remaining Issues (Not Fixed)

1. **Bug 7 (LOW): Duplicate scanId in log output** -- Still present. The pipeline emits `scanId` twice in log lines. Low priority.
2. **Bug 8 (LOW): Node.js punycode deprecation warning** -- Still present. Suppress with `NODE_OPTIONS=--no-deprecation` or fix the dependency.
3. **API credit exhaustion handling** -- Not addressed. When API credits run out, the scan reports "passed" with 0 findings, giving a false sense of security.
4. **No `--verbose`/`--debug` flag** -- Not addressed. Users must rely on stderr logs for debugging.

---

## Verdict

**The CLI is now usable for beta.** The P0 crash is fixed, extensionless script support works, JSON output is clean, and missing tool warnings are shown. The main limitation is that without `semgrep`, `trufflehog`, and Anthropic API credits, only the regex-based AIPatternDetector runs. Once those dependencies are installed and API credits are restored, the full detection pipeline should work.
