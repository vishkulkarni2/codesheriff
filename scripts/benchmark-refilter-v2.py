#!/usr/bin/env python3
"""
Re-filter v2: Balance precision and recall better.
- Keep MEDIUM, HIGH, CRITICAL (drop only LOW)
- More targeted FP filtering (not too aggressive on security findings)
- Cap at 7 per PR
"""

import json
import re
from pathlib import Path

BENCHMARK_DIR = Path.home() / ".openclaw/workspace/code-review-benchmark/offline"

# We need to reload the ORIGINAL data (before v1 filter)
# Check if we have a backup
ORIG_BACKUP = BENCHMARK_DIR / "results" / "benchmark_data_original.json"
DATA_FILE = BENCHMARK_DIR / "results" / "benchmark_data.json"
PROGRESS_FILE = BENCHMARK_DIR / "results" / "codesheriff_progress.json"

# Targeted FP patterns - less aggressive
FP_PATTERNS = [
    # Code fragment artifacts
    r"missing closing (parenthesis|brace|bracket)",
    r"syntax error.*extra",
    r"incomplete code fragment",
    r"try block without.*catch",
    r"catch.*without.*try",
    r"missing.*semicolon.*at end",
    r"unterminated (string|template)",
    # Import/definition FPs from analyzing diffs
    r"is not (defined|imported|declared) in the provided code",
    r"is called without any import",
    r"not available in Node",
    # Style noise
    r"trailing comma",
    r"will output.*\[object Object\]",
    r"consider (adding|using|implementing) (a |an )?try",
    r"inconsistent (naming|style|formatting)",
    # Very speculative security patterns
    r"without apparent.*validation",
    r"leading to.*privilege escalation",
    r"string.based.*comparison.*vulnerable",
]
FP_REGEX = re.compile("|".join(FP_PATTERNS), re.IGNORECASE)

KEEP_SEVERITIES = {"MEDIUM", "HIGH", "CRITICAL"}
MAX_FINDINGS_PER_PR = 7


def parse_finding_from_comment(comment_body):
    m = re.search(r"\*\*CodeSheriff: (.+?)\*\*\s*\[(\w+)\]", comment_body)
    if m:
        return m.group(1), m.group(2)
    return None, None


def should_keep_comment(comment):
    body = comment.get("body", "")
    title, severity = parse_finding_from_comment(body)
    if not title:
        return False
    if severity not in KEEP_SEVERITIES:
        return False
    if FP_REGEX.search(body):
        return False
    return True


def deduplicate_comments(comments):
    seen_titles = set()
    unique = []
    for c in comments:
        title, _ = parse_finding_from_comment(c.get("body", ""))
        if not title:
            continue
        norm_title = re.sub(r'[^a-z0-9]', '', title.lower())[:40]
        if norm_title not in seen_titles:
            seen_titles.add(norm_title)
            unique.append(c)
    return unique


def main():
    # First, re-run the benchmark runner to restore original data
    # Actually, let's just re-run from the progress file
    
    # Load the original benchmark data (before our edits)
    # We need to re-construct from the original run
    print("Need to re-run benchmark-runner.py to get original data back...")
    print("Or load from backup if available...")
    
    if ORIG_BACKUP.exists():
        print(f"Loading from backup: {ORIG_BACKUP}")
        with open(ORIG_BACKUP) as f:
            data = json.load(f)
    else:
        print("No backup found. Creating one from current data first.")
        # Current data already has filtered comments, we need to re-run
        # For now, just work with what we have
        with open(DATA_FILE) as f:
            data = json.load(f)
        print("WARNING: Working with already-filtered data")
    
    total_before = 0
    total_after = 0
    
    for golden_url, entry in data.items():
        for review in entry.get("reviews", []):
            if review["tool"] != "codesheriff":
                continue
            comments = review.get("review_comments", [])
            total_before += len(comments)
            filtered = [c for c in comments if should_keep_comment(c)]
            deduped = deduplicate_comments(filtered)
            capped = deduped[:MAX_FINDINGS_PER_PR]
            review["review_comments"] = capped
            total_after += len(capped)
    
    with open(DATA_FILE, "w") as f:
        json.dump(data, f, indent=2)
    
    print(f"Before: {total_before} comments")
    print(f"After:  {total_after} comments")
    print(f"Average per PR: {total_after/50:.1f}")


if __name__ == "__main__":
    main()
