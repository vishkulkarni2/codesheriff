# CodeSheriff Showcase Scans

Dogfood test results from scanning intentionally vulnerable and real-world repositories.

**Date:** 2026-04-01
**Mode:** Static analysis only (semgrep + trufflehog + regex pattern detectors). LLM detectors disabled (no Anthropic API credits).

## Dependencies Installed

- semgrep 1.136.0 (via pip3)
- trufflehog 3.94.2 (via brew)

## Bugs Fixed During Testing

1. **Semgrep rules path resolution** (`packages/analyzer/src/detectors/static.ts`): `BUILTIN_RULES_DIR` was `../../../../../rules` (5 levels up) but should be `../../../../rules` (4 levels up) from `dist/detectors/`.
2. **Semgrep JSON field name mismatch** (`packages/analyzer/src/detectors/static.ts`): Code referenced `match.checkId` but semgrep outputs `check_id` (snake_case). Fixed in both src and dist.
3. **All semgrep rules used `patterns:` instead of `pattern-either:`**: This is AND semantics when OR was intended. Every multi-pattern rule was silently requiring ALL patterns to match instead of ANY. Bulk-fixed across all 13 rule YAML files.
4. **Rule title included full filesystem path**: The `check_id` from semgrep includes the config directory path. Added `.split('.').pop()` to extract just the rule name.
5. **`pattern-not` inside `pattern-either` is invalid**: The `ai-jwt-client-only.yaml` rule had `pattern-not` nested under `pattern-either`, which semgrep rejects. Restructured.

## Scan Results Summary

| Repository | Source | Findings | Critical | High | Risk Score | Best For |
|---|---|---|---|---|---|---|
| vuln-nodejs-app | github.com/payatu | 142 | 3 | 139* | 100/100 | API keys, auth patterns |
| securityvulnerabilities | github.com/satishkumarvenkatasamy | 8 | 6 | 2 | 100/100 | Password comparison, deserialization, None deref |
| Vulnerable-API | github.com/michealkeines | 5 | 1 | 4 | 100/100 | SQL injection (f-string), bare exceptions |
| vulnerable-app-nodejs-express | github.com/samoylenko | 5 | 2 | 3 | 100/100 | SQL injection (template literal), optional chaining |
| saanvi | (original dogfood) | 2 | 1 | 1 | 42/100 | QuerySet negative slice, None deref |
| insecure-web | github.com/BrenesRM | 0 | 0 | 0 | 0/100 | (SQL injection via indirect variable -- needs taint analysis) |
| calendar_tools | (original dogfood) | 0 | 0 | 0 | 0/100 | Clean |
| aes-128-decryption-tool | (original dogfood) | 0 | 0 | 0 | 0/100 | Clean |

*139 HIGH findings in vuln-nodejs-app are mostly `Ts Optional Chain Missing` in a vendored `run_prettify.js` (noise from third-party code).

## Best Showcase Repos (Ranked)

1. **securityvulnerabilities** -- Cleanest results. 6 critical + 2 high, all genuine, no noise. Demonstrates password comparison, unsafe deserialization, and None dereference detection.

2. **Vulnerable-API** -- Great for Python demos. SQL injection detected via f-string pattern, plus bare exception handling. 5 findings, all real.

3. **vulnerable-app-nodejs-express** -- Best for JavaScript/Node.js demos. Detects SQL injection via template literals and missing optional chaining. 5 findings, all actionable.

4. **vuln-nodejs-app** -- Good for API key detection demo. 3 critical findings are strong (hardcoded apiToken, password comparison). However, 139 HIGH findings from vendored JS file create noise.

## What Was NOT Detected (Known Gaps)

- **insecure-web SQL injection**: The code assigns the SQL query to a variable before passing it to `execute()`. Semgrep's pattern matching cannot follow data flow across variable assignments without taint mode (requires Semgrep Pro).
- **Hardcoded passwords under 20 characters**: The regex detector requires 20+ character secrets. Short passwords like `"mysecretpassword"` (16 chars) or `"password123"` (11 chars) are missed.
- **TruffleHog `--only-verified` limitation**: The secrets scanner uses `--only-verified` which means it only reports live/valid secrets. Test repos with fake/expired keys show no findings from TruffleHog.
- **LLM-powered detectors disabled**: Hallucination detection, auth flow validation, and logic bug detection all require Anthropic API credits.

## Files

Each repo has two output files:
- `<repo>-output.txt` -- Human-readable text output
- `<repo>-output.json` -- Machine-readable JSON output
