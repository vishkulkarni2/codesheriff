# CodeSheriff test fixtures — recall baseline

> Last measured: 2026-04-09. Owner: dogfood loop on Mac Mini at `~/.dogfood/`.

## Why this exists

Recall measurement on real fixtures is the only way to catch silent regressions in the analyzer. The Martian benchmark (grafana / sentry / discourse / keycloak / cal.com) gave us a single F1 number across mostly-JS/TS/Go/Java fixtures, with no per-language breakdown. As a result, Python recall silently sat at 55% for months while JavaScript hit 100%, until 2026-04-09 when manual scans surfaced the gap. The fix was per-language test fixtures + a recurring dogfood loop that tracks each language's recall over time.

This file is the manifest the dogfood loop reads to know what fixtures exist and what their ground truth counts are. Any time you add a new fixture, add a row here AND update the loop's `~/.dogfood/code/config.yaml`.

## Fixtures

| Repo | Branch | Lang(s) | Ground truth | Semgrep recall (2026-04-09) | Production recall (2026-04-09) | Notes |
|---|---|---|---|---|---|---|
| [cs-test-nodejs](https://github.com/vishkulkarni2/cs-test-nodejs) | main | JS | 11 | 9 / 11 = 82% | 11 / 11 = **100%** | The original benchmark fixture. JS rules are tuned hard against this. |
| [cs-test-python-ai](https://github.com/vishkulkarni2/cs-test-python-ai) | main | Python | 11 | 11 / 11 = 100% | ~12 / 11 = **100%** | Was 55% before the rule additions in commit `a069a47` (2026-04-09). |
| [codesheriff-test](https://github.com/vishkulkarni2/codesheriff-test) | test/bad-code | Python + JS | 16 | 8 / 16 = 50% | ~11 / 16 = ~69% | Mixed-language fixture. The Python file gets lifted by `a069a47`. |
| [cs-test-clean](https://github.com/vishkulkarni2/cs-test-clean) | main | JS | **0** (negative test) | 0 / 0 = n/a | 0 / 0 = n/a | Any finding here is a **false positive**. Tracked as `fp_count_on_clean`. |
| [cs-test-branches](https://github.com/vishkulkarni2/cs-test-branches) | develop | JS | 1 | 1 / 1 = 100% | ? | Branch-coverage test. Two `feature/*` branches are empty stubs and excluded from the dogfood loop. |
| [cs-test-java](https://github.com/vishkulkarni2/cs-test-java) | main | Java | 16 | **0 / 16 = 0%** 🔴🔴🔴 | TBD | New fixture (2026-04-09). Java rules do not match real Java patterns. |
| [cs-test-go](https://github.com/vishkulkarni2/cs-test-go) | main | Go | 14 | **2 / 14 = 14%** 🔴 | TBD | New fixture (2026-04-09). Only correctness rules fire, no security catches. |
| [cs-test-ruby](https://github.com/vishkulkarni2/cs-test-ruby) | main | Ruby | 17 | **6 / 17 = 35%** 🔴 | TBD | New fixture (2026-04-09). Mostly correctness rules; only one real security rule fires. |
| [cs-test-typescript](https://github.com/vishkulkarni2/cs-test-typescript) | main | TypeScript | 15 | **11 / 15 = 73%** ⚠️ | TBD | New fixture (2026-04-09). Inherits JS rules; misses all 3 TS-specific patterns (`as any`, `forEach + async`, `@ts-ignore`). |

## Per-language summary

| Language | Rule count | Best recall (any fixture) | Highest-leverage gap |
|---|---|---|---|
| JavaScript | 8 (`js-vulnerabilities.yaml`) | **100%** ✅ | Generalize beyond cs-test-nodejs idioms |
| Python | 13 (`python-security.yaml`) | **100%** ✅ | TOCTOU rule, PII/PCI category, 3rd-party framework coverage (Django, FastAPI) |
| TypeScript | 2 (`typescript-correctness.yaml`) + JS rules | 73% | TS-specific: `as any` cast, `// @ts-ignore`, async-misuse in forEach |
| Ruby | 4 (`ruby-security.yaml`) | 35% | Rails-specific patterns, command injection via backticks, mass assignment |
| Go | 4 (`go-security.yaml`) | 14% | The entire security rule set is missing — fmt.Sprintf SQL, exec.Command shell, SSRF, TLS bypass, weak crypto, race conditions |
| Java | 7 (`java-security.yaml`) | **0%** | All 7 existing rules need to be re-audited and replaced; this is the highest-leverage improvement target across the entire product |

## Action items (sorted by leverage)

1. **Java rule rewrite** — current `java-security.yaml` has 7 rules and 0% recall on a realistic Spring/JDBC fixture. The whole file needs to be replaced. Pattern this on the Python fix in commit `a069a47`. (~2 hours of focused work for ~16 new rules covering JDBC SQLi, LDAP injection, XXE, deserialization, command injection, weak crypto, path traversal, missing CSRF.)
2. **Go rule expansion** — 14% recall. Need rules for fmt.Sprintf SQL injection, exec.Command shell injection, http.Get SSRF, TLS InsecureSkipVerify, MD5/SHA1, race conditions on shared maps. (~1.5 hours.)
3. **Ruby rule expansion** — 35% recall. Need rules for ERB string interpolation SQL, backtick command injection, mass assignment without strong parameters, YAML.load, Marshal.load, cookie attributes. (~1 hour.)
4. **TypeScript-specific rules** — 73% recall, but the misses are TS-specific patterns that JS rules can't catch. Need rules for `as any` casts, `// @ts-ignore` near non-test code, `forEach((x) => async ...)` patterns. (~1 hour.)
5. **Per-language recall in CI** — wire the dogfood loop into a GitHub Actions check that fails any PR which drops recall on any language by more than 10 percentage points. (~30 min once the dogfood loop is stable.)

## Tracked by

The dogfood loop on Mac Mini at `~/.dogfood/` (deployment in progress as of 2026-04-09). It reads this file's table to know which fixtures to scan and what their ground truth counts are, then writes per-language and per-fixture recall to `~/.dogfood/data/metrics-history.json` every 6 hours and alerts via Telegram on regression.
