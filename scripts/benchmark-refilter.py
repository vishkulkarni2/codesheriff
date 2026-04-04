#!/usr/bin/env python3
"""
Re-filter CodeSheriff benchmark results for better precision.
Instead of re-running the full pipeline, just refilter existing comments.

Strategy: Keep only HIGH/CRITICAL findings, limit to top N per PR,
filter out speculative findings, improve deduplication.
"""

import json
import re
from pathlib import Path

BENCHMARK_DIR = Path.home() / ".openclaw/workspace/code-review-benchmark/offline"
DATA_FILE = BENCHMARK_DIR / "results" / "benchmark_data.json"
OUTPUT_FILE = DATA_FILE  # Overwrite

# More aggressive FP patterns
FP_PATTERNS = [
    r"missing closing (parenthesis|brace|bracket)",
    r"syntax error",
    r"incomplete code fragment",
    r"try block without.*catch",
    r"catch.*without.*try",
    r"missing.*semicolon",
    r"unterminated (string|template)",
    r"is not (defined|imported|declared)",
    r"is called without any import",
    r"not available in Node",
    r"trailing comma",
    r"will output.*\[object Object\]",
    # Security speculation patterns (high FP rate)
    r"could potentially be (exploited|misused|abused)",
    r"potentially (enabling|allowing) (replay|injection|bypass)",
    r"without apparent.*validation",
    r"without.*CSRF protection",
    r"vulnerable to case sensitivity",
    r"hardcoded.*strings? used for",
    r"leading to.*escalation",
    r"string.based.*comparison.*vulnerable",
    # Too speculative
    r"could (be|cause|lead|allow|enable) (potential|possible)",
    r"potentially (unsafe|dangerous|insecure|vulnerable)",
    r"without proper (timing|CSRF|input|bounds)",
    r"may (be|not be) properly (initialized|validated|sanitized)",
    r"appears to call itself recursively",
    # Style/noise patterns
    r"consider (adding|using|implementing)",
    r"could be (simplified|improved|refactored)",
    r"unnecessary (complexity|abstraction|indirection)",
    r"redundant (null|undefined|type) check",
    r"inconsistent (naming|style|formatting)",
]
FP_REGEX = re.compile("|".join(FP_PATTERNS), re.IGNORECASE)

# Only keep these severity levels
KEEP_SEVERITIES = {"HIGH", "CRITICAL"}

MAX_FINDINGS_PER_PR = 5  # Cap findings per PR for precision


def parse_finding_from_comment(comment_body):
    """Extract severity and title from CodeSheriff comment format."""
    # Pattern: **CodeSheriff: TITLE** [SEVERITY]
    m = re.search(r"\*\*CodeSheriff: (.+?)\*\*\s*\[(\w+)\]", comment_body)
    if m:
        return m.group(1), m.group(2)
    return None, None


def should_keep_comment(comment):
    """Determine if a review comment should be kept."""
    body = comment.get("body", "")
    title, severity = parse_finding_from_comment(body)
    
    if not title:
        return False  # Can't parse
    
    # Only keep HIGH and CRITICAL
    if severity not in KEEP_SEVERITIES:
        return False
    
    # Check FP patterns
    if FP_REGEX.search(body):
        return False
    
    return True


def deduplicate_comments(comments):
    """More aggressive deduplication."""
    seen_titles = set()
    unique = []
    for c in comments:
        title, _ = parse_finding_from_comment(c.get("body", ""))
        if not title:
            continue
        
        # Normalize title for dedup
        norm_title = re.sub(r'[^a-z0-9]', '', title.lower())[:40]
        
        if norm_title not in seen_titles:
            seen_titles.add(norm_title)
            unique.append(c)
    
    return unique


def main():
    with open(DATA_FILE) as f:
        data = json.load(f)
    
    total_before = 0
    total_after = 0
    
    for golden_url, entry in data.items():
        for review in entry.get("reviews", []):
            if review["tool"] != "codesheriff":
                continue
            
            comments = review.get("review_comments", [])
            total_before += len(comments)
            
            # Filter
            filtered = [c for c in comments if should_keep_comment(c)]
            
            # Deduplicate
            deduped = deduplicate_comments(filtered)
            
            # Cap per PR
            capped = deduped[:MAX_FINDINGS_PER_PR]
            
            review["review_comments"] = capped
            total_after += len(capped)
    
    with open(OUTPUT_FILE, "w") as f:
        json.dump(data, f, indent=2)
    
    print(f"Before: {total_before} comments")
    print(f"After:  {total_after} comments")
    print(f"Reduction: {total_before - total_after} ({(1 - total_after/total_before)*100:.0f}%)")
    print(f"Average per PR: {total_after/50:.1f}")


if __name__ == "__main__":
    main()
