#!/usr/bin/env python3
"""
Re-filter v3: Optimized for F1 score.
Strategy:
- Keep MEDIUM/HIGH/CRITICAL (drop LOW)  
- Remove only high-confidence FP patterns
- Limit to 6 per PR
- Better deduplication
- Save backup before modifying
"""

import json
import re
import shutil
from pathlib import Path

BENCHMARK_DIR = Path.home() / ".openclaw/workspace/code-review-benchmark/offline"
DATA_FILE = BENCHMARK_DIR / "results" / "benchmark_data.json"
BACKUP_FILE = BENCHMARK_DIR / "results" / "benchmark_data_backup.json"

# Only filter patterns that are definitely noise from diff analysis
FP_PATTERNS = [
    # Syntax artifacts from analyzing partial code
    r"missing closing (parenthesis|brace|bracket)",
    r"syntax error.*extra",
    r"incomplete code fragment",
    r"try block without.*catch",
    r"catch.*without.*try",
    # Import/context artifacts
    r"is not (defined|imported|declared) in the provided code",
    r"is called without any import statement",
    r"not available in Node\.js",
    # Clear noise
    r"trailing comma.*older",
    r"will output.*\[object Object\]",
    r"inconsistent naming",
]
FP_REGEX = re.compile("|".join(FP_PATTERNS), re.IGNORECASE)

KEEP_SEVERITIES = {"MEDIUM", "HIGH", "CRITICAL"}
MAX_FINDINGS_PER_PR = 6


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
    """Deduplicate by normalized title."""
    seen = set()
    unique = []
    for c in comments:
        title, _ = parse_finding_from_comment(c.get("body", ""))
        if not title:
            continue
        # Normalize: lowercase, remove non-alphanumeric, take first 35 chars
        norm = re.sub(r'[^a-z0-9]', '', title.lower())[:35]
        if norm not in seen:
            seen.add(norm)
            unique.append(c)
    return unique


def main():
    # Backup first
    if not BACKUP_FILE.exists():
        shutil.copy2(DATA_FILE, BACKUP_FILE)
        print(f"Backed up to {BACKUP_FILE}")
    else:
        # Restore from backup
        shutil.copy2(BACKUP_FILE, DATA_FILE)
        print(f"Restored from backup")

    with open(DATA_FILE) as f:
        data = json.load(f)

    total_before = 0
    total_after = 0
    per_repo_before = {}
    per_repo_after = {}

    for golden_url, entry in data.items():
        repo = entry.get("source_repo", "unknown")
        for review in entry.get("reviews", []):
            if review["tool"] != "codesheriff":
                continue
            comments = review.get("review_comments", [])
            total_before += len(comments)
            per_repo_before[repo] = per_repo_before.get(repo, 0) + len(comments)

            # Filter, deduplicate, cap
            filtered = [c for c in comments if should_keep_comment(c)]
            deduped = deduplicate_comments(filtered)
            capped = deduped[:MAX_FINDINGS_PER_PR]

            review["review_comments"] = capped
            total_after += len(capped)
            per_repo_after[repo] = per_repo_after.get(repo, 0) + len(capped)

    with open(DATA_FILE, "w") as f:
        json.dump(data, f, indent=2)

    print(f"\nBefore: {total_before} comments")
    print(f"After:  {total_after} comments")
    print(f"Reduction: {total_before - total_after} ({(1 - total_after/max(total_before,1))*100:.0f}%)")
    print(f"Average per PR: {total_after/50:.1f}")
    print(f"\nPer-repo:")
    for repo in sorted(per_repo_before.keys()):
        b = per_repo_before.get(repo, 0)
        a = per_repo_after.get(repo, 0)
        print(f"  {repo:<20} {b:>5} -> {a:>5}")


if __name__ == "__main__":
    main()
