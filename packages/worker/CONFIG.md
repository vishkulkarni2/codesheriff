# `.codesheriff.yml` — Repo Configuration

CodeSheriff reads an optional `.codesheriff.yml` file from the **root of your
repository** at the PR's HEAD commit. It's how you tune scanner behavior on a
per-repo basis without leaving git.

If the file is missing, malformed, or contains invalid values, CodeSheriff
falls back to defaults and logs a warning — your scan will never fail because
of a bad config.

## Location

Put the file at the repo root:

```
my-repo/
├── src/
├── package.json
└── .codesheriff.yml    ← here
```

Both `.codesheriff.yml` and `.codesheriff.yaml` are accepted. If both exist,
`.codesheriff.yml` wins.

## Schema (v1)

```yaml
# .codesheriff.yml
comments:
  # "all" | "high" (default) | "critical" | "none"
  # Controls which findings get an inline PR comment.
  inline_severity_threshold: high

  # Max inline comments for medium/low severity.
  # Ignored when threshold is "critical" or "none".
  inline_low_cap: 20

  # Number of findings shown in the summary card list.
  summary_top_n: 10
```

### `comments.inline_severity_threshold`

| Value      | Behavior                                                                    |
| ---------- | --------------------------------------------------------------------------- |
| `all`      | Inline every severity (including INFO). `inline_low_cap` applies to med/low/info. |
| `high`     | **Default.** CRITICAL + HIGH uncapped. MEDIUM + LOW up to `inline_low_cap`. |
| `critical` | CRITICAL only, uncapped. No inlines for HIGH or below.                      |
| `none`     | No inline comments. Summary card only.                                      |

### `comments.inline_low_cap`

Number between 0 and 1000. Caps the number of lower-severity inline comments
posted. Default: `20`. Env var override (used only when no file is present):
`INLINE_LOW_SEVERITY_CAP`.

### `comments.summary_top_n`

Number between 1 and 100. Caps how many findings appear in the summary card's
"Critical & High Findings" list. Default: `10`.

## Precedence

1. Value from `.codesheriff.yml`
2. Environment variable (for `inline_low_cap` only)
3. Built-in default

## Fallback behavior

| Scenario                               | What happens                                            |
| -------------------------------------- | ------------------------------------------------------- |
| File missing                           | Silent — defaults used.                                 |
| Malformed YAML                         | Warn + defaults used for all fields.                    |
| Top-level is not an object             | Warn + defaults used for all fields.                    |
| Unknown top-level key                  | Warn "ignoring" + other fields still parsed.            |
| Unknown key under `comments`           | Warn "ignoring" + other fields still parsed.            |
| Invalid value for a known field        | Warn + default used **just for that field**.            |

A hard safety cap of 100 inline comments per scan applies regardless of config
— pathological scans won't storm the GitHub API.

## Examples

### Minimal — critical-only noise floor for a noisy repo

```yaml
comments:
  inline_severity_threshold: critical
```

### Summary-only mode (no inline comments)

```yaml
comments:
  inline_severity_threshold: none
```

### Turn everything up for a security-sensitive repo

```yaml
comments:
  inline_severity_threshold: all
  inline_low_cap: 100
  summary_top_n: 25
```

## Future settings

This file is the forward-compatible home for per-repo configuration. Planned
additions (not in v1): rule enable/disable, severity overrides, auto-fix
toggles, path/glob ignores. Unknown keys today are warned-but-accepted so that
adding new keys doesn't break older scans.
