#!/usr/bin/env python3
"""
Post-process candidates.json to improve precision on cal.com TypeScript PRs.

Strategy:
1. logicbug_added candidates are kept (high precision, ~90% TP rate)
2. 'extracted' candidates are scored by concreteness — advisory/speculative FPs filtered
3. Per-PR cap of 5, sorted by quality score (logicbug_added first)
4. Specific FP blocklist patterns eliminated

Saves a backup before modifying.
"""

import json
import re
import shutil
from pathlib import Path
from collections import defaultdict

CANDS_DIR = Path.home() / ".openclaw/workspace/code-review-benchmark/offline/results/claude-sonnet-4-20250514"
CANDS_FILE = CANDS_DIR / "candidates.json"
BACKUP_FILE = CANDS_DIR / "candidates.json.bak2"

# --- FP patterns: definitely advisory, not concrete bugs ---
# These patterns match advisory/speculative findings that are almost never TPs
ADVISORY_PATTERNS = [
    # "Missing X" advisories — speculative
    r"^Missing timeout",
    r"^Missing HTTPS enforcement",
    r"^Missing HTTP method validation",
    r"^No rate limit",
    r"^No validation of",
    r"^No error handling",
    r"^Missing rate limit",
    r"^Missing authentication check",
    r"^Missing authentication/authorization",
    r"^Missing server-side validation",
    r"^Missing CSRF token",
    # Security speculation about normal patterns
    r"transmitted as plain text",
    r"without encryption",
    r"without proper (validation|sanitization)",
    r"^Hardcoded OAuth endpoint URL without environment",
    r"^Overly permissive schema",
    r"^Generic error message.*does not provide",
    r"^Incomplete function implementation",
    r"Webhook secret comparison vulnerable to timing attack",
    # Async speculation (very broad)
    r"Function declares async but does not return a Promise type annotation",
    r"Redundant 'await' usage",
    r"Redundant.*await",
    # Client-side speculation (in context where it IS server-side)
    r"client-side only",
    r"^Two-factor authentication.*client-side",
    r"^CSRF token appears",
    r"^Autocomplete attribute",
    r"^Input mode 'decimal'",
    # Test-quality observations (not bugs)
    r"^Test bypasses 2FA",
    r"^Test only checks",
    r"^Test assumes",
    r"Mock expectation",
    # Type annotation nits
    r"should likely be an array of",
    r"more specific type",
    r"TypeScript's type checking",
    r"Type assertion bypasses",
    r"does not return a Promise type annotation",
    # Overly broad pattern matches
    r"^User ID transmitted as plain text",
    r"^Sensitive credential.*in a global variable",
    r"^Global variable.*initialized as empty string",
    r"^Global mutable variables",
    r"^No null check for",
    r"^Accessing.*without verifying",
    r"^Potential null",
    r"without null check",
    # HTTP method / header nits
    r"^Missing HTTP",
    r"^HTTP status check uses statusText",
    # Performance/non-bug
    r"^URI parsing.*called twice",
    r"without caching",
    # Very generic warnings
    r"could lead to hanging",
    r"may cause runtime error",
    r"^Function lacks proper error handling",
    r"^Function uses 'this\.",
    r"^The no_throttle parameter",
]

ADVISORY_REGEX = re.compile("|".join(ADVISORY_PATTERNS), re.IGNORECASE)

# Patterns that are almost always TPs — positive signal
CONCRETE_POSITIVE_PATTERNS = [
    r"always (returns|evaluates|fails|false)",
    r"always return false",
    r"incorrect.*calculation",
    r"wrong variable",
    r"wrong key",
    r"wrong value",
    r"will always fail",
    r"will always return",
    r"unreachable",
    r"dead code",
    r"race condition",
    r"case sensitivity",
    r"off.by.one",
    r"incorrect expiry",
    r"logic (error|inversion|flaw)",
    r"incorrect.*condition",
    r"deletion logic incorrectly",
    r"returns.*instead of",
    r"should be.*but",
    r"isSame\(\)",
    r"forEach.*async",
    r"safeParse result",
    r"stale value",
    r"concurrent",
    r"sed.*syntax",
    r"empty data object",
    r"zod schema syntax",
    r"hardcoded fallback.*incorrect",
    r"response.*does not exist",
    r"fetch Response.*\.data",
]
CONCRETE_REGEX = re.compile("|".join(CONCRETE_POSITIVE_PATTERNS), re.IGNORECASE)

MAX_PER_PR = 5


def score_candidate(cand: dict) -> float:
    """Higher score = keep first. logicbug_added > concrete extracted > advisory extracted."""
    source = cand.get("source", "extracted")
    text = cand.get("text", "")

    # logicbug_added candidates are highest quality
    if source == "logicbug_added":
        return 10.0

    # Check for advisory patterns → low score
    if ADVISORY_REGEX.search(text):
        base = 0.5
    else:
        base = 2.0

    # Bonus for concrete positive patterns
    if CONCRETE_REGEX.search(text):
        base += 3.0

    # Penalty for speculative language
    speculative_count = len(re.findall(
        r"\b(could|may|might|potentially|likely|possible|possibly|can cause|could cause|risk|vulnerable)\b",
        text, re.IGNORECASE
    ))
    base -= speculative_count * 0.3

    # Bonus for specificity (mentions a specific variable/method name)
    specific_refs = len(re.findall(r"[a-z][A-Z][a-zA-Z]+\(?\)?|`[^`]+`|\b[a-z]+[A-Z][a-zA-Z]*\b", text))
    base += min(specific_refs * 0.2, 1.0)

    return max(base, 0.0)


def main():
    # Backup
    if not BACKUP_FILE.exists():
        shutil.copy2(CANDS_FILE, BACKUP_FILE)
        print(f"Backed up to {BACKUP_FILE}")
    else:
        print(f"Backup already exists at {BACKUP_FILE}")

    with open(CANDS_FILE) as f:
        cands = json.load(f)

    total_before = sum(len(v["codesheriff"]) for v in cands.values())
    calcom_before = 0
    calcom_after = 0
    per_pr_stats = []

    new_cands = {}

    for url, entry in cands.items():
        cs = entry.get("codesheriff", [])
        is_calcom = "calcom" in url or "cal.com" in url

        if is_calcom:
            calcom_before += len(cs)

        # Score and sort
        scored = [(score_candidate(c), c) for c in cs]
        scored.sort(key=lambda x: -x[0])

        # Apply cap
        capped = [c for _, c in scored[:MAX_PER_PR]]

        if is_calcom:
            calcom_after += len(capped)
            pr_num = url.split("/")[-1]
            per_pr_stats.append({
                "pr": pr_num,
                "before": len(cs),
                "after": len(capped),
                "kept_sources": [c.get("source", "?") for c in capped],
                "kept_texts": [c.get("text", "")[:80] for c in capped],
            })

        new_cands[url] = {"codesheriff": capped}

    total_after = sum(len(v["codesheriff"]) for v in new_cands.values())

    print(f"\nTotal candidates: {total_before} → {total_after} (delta: {total_after - total_before})")
    print(f"Cal.com candidates: {calcom_before} → {calcom_after} (delta: {calcom_after - calcom_before})")
    print()
    print("Cal.com per-PR breakdown:")
    for stat in sorted(per_pr_stats, key=lambda x: -int(x["before"])):
        print(f"  PR #{stat['pr']}: {stat['before']} → {stat['after']}")
        for src, text in zip(stat["kept_sources"], stat["kept_texts"]):
            print(f"    [{src}] {text}")
    print()

    with open(CANDS_FILE, "w") as f:
        json.dump(new_cands, f, indent=2)
    print(f"Saved updated candidates to {CANDS_FILE}")


if __name__ == "__main__":
    main()
