#!/usr/bin/env python3
"""
CodeSheriff Eval Harness
========================
Compares CodeSheriff review comments against golden benchmark comments.
Uses cached CS results from benchmark_data.json (no re-running CS).

This is the v2 harness that uses raw CS review_comments from benchmark_data.json.
For the Martian-style candidates.json approach, see MARTIAN-BENCHMARK-RESULTS.md.

Usage:
    python3 run-eval.py [--verbose] [--threshold FLOAT]
"""

import json
import os
import re
import sys
import math
from collections import Counter, defaultdict
from pathlib import Path

# Configuration
SCRIPT_DIR = Path(__file__).parent
WORKSPACE = Path(os.path.expanduser("~/.openclaw/workspace"))
BENCHMARK_DIR = WORKSPACE / "code-review-benchmark" / "offline" / "results"
PR_LABELS_FILE = BENCHMARK_DIR / "pr_labels.json"
BENCHMARK_DATA_FILE = BENCHMARK_DIR / "benchmark_data.json"
CANDIDATES_FILE = BENCHMARK_DIR / "claude-sonnet-4-20250514" / "candidates.json"
EVALUATIONS_FILE = BENCHMARK_DIR / "claude-sonnet-4-20250514" / "evaluations.json"

# Text matching threshold (tuned to approximate LLM judge results)
DEFAULT_THRESHOLD = 0.225

# ─── Text Matching Engine ────────────────────────────────────────────────

# Domain-specific synonyms to improve matching
SYNONYMS = {
    'null': ['nil', 'none', 'undefined', 'empty', 'missing'],
    'nil': ['null', 'none', 'undefined', 'empty'],
    'none': ['null', 'nil', 'undefined'],
    'error': ['exception', 'crash', 'failure', 'bug', 'fault'],
    'exception': ['error', 'crash', 'throw'],
    'race': ['concurrent', 'thread', 'synchronization', 'atomic', 'lock', 'mutex'],
    'concurrent': ['race', 'thread', 'parallel', 'async'],
    'thread': ['concurrent', 'goroutine', 'async', 'parallel'],
    'cast': ['type', 'conversion', 'coercion', 'unsafe'],
    'incorrect': ['wrong', 'invalid', 'bad', 'broken', 'flawed'],
    'wrong': ['incorrect', 'invalid', 'bad'],
    'missing': ['absent', 'lacking', 'omitted', 'null', 'undefined'],
    'validation': ['check', 'verify', 'validate', 'assert'],
    'check': ['validation', 'verify', 'assert', 'guard'],
    'permission': ['auth', 'authorization', 'access', 'security'],
    'auth': ['authentication', 'authorization', 'permission', 'security'],
    'security': ['vulnerability', 'exploit', 'auth', 'permission', 'bypass'],
    'bypass': ['circumvent', 'skip', 'avoid', 'evade'],
    'return': ['returns', 'returned', 'result', 'output'],
    'value': ['variable', 'parameter', 'argument', 'field'],
    'function': ['method', 'procedure', 'handler', 'callback'],
    'method': ['function', 'procedure', 'handler'],
    'async': ['await', 'asynchronous', 'promise', 'concurrent'],
    'await': ['async', 'asynchronous', 'promise'],
    'logic': ['conditional', 'branch', 'boolean', 'flow'],
    'dead': ['unused', 'unreachable', 'orphan'],
    'override': ['overwrite', 'shadow', 'replace', 'redefine'],
    'import': ['require', 'include', 'module', 'dependency'],
    'slice': ['index', 'substring', 'array', 'list'],
    'reference': ['pointer', 'dereference', 'access'],
    'pointer': ['reference', 'dereference', 'nil', 'null'],
}

STOP_WORDS = {
    'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
    'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
    'should', 'may', 'might', 'shall', 'can', 'to', 'of', 'in', 'for',
    'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through', 'during',
    'before', 'after', 'above', 'below', 'between', 'out', 'off', 'up',
    'down', 'and', 'but', 'or', 'nor', 'not', 'so', 'yet', 'both',
    'each', 'few', 'more', 'most', 'other', 'some', 'such', 'no',
    'only', 'own', 'same', 'than', 'too', 'very', 'just', 'because',
    'if', 'when', 'while', 'where', 'how', 'what', 'which', 'who',
    'this', 'that', 'these', 'those', 'it', 'its', 'they', 'them',
    'their', 'we', 'our', 'you', 'your', 'he', 'she', 'him', 'her',
    'all', 'also', 'any', 'about', 'then', 'there', 'here', 'still',
    'since', 'using', 'used', 'use', 'instead', 'rather', 'consider',
}


def tokenize(text: str) -> list[str]:
    """Tokenize text into meaningful words."""
    text = text.lower()
    # Keep dots for things like "System.exit" but split on most punctuation
    text = re.sub(r'[^\w\.\-]', ' ', text)
    tokens = text.split()
    # Also split camelCase and PascalCase
    expanded = []
    for token in tokens:
        # Split camelCase: "NullPointerException" -> ["null", "pointer", "exception"]
        parts = re.sub(r'([a-z])([A-Z])', r'\1 \2', token)
        parts = re.sub(r'([A-Z]+)([A-Z][a-z])', r'\1 \2', parts)
        for part in parts.lower().split():
            if part and part not in STOP_WORDS and len(part) > 1:
                expanded.append(part)
    return expanded


def extract_key_terms(text: str) -> set[str]:
    """Extract important technical terms from text."""
    tokens = tokenize(text)
    terms = set(tokens)
    # Add compound terms (bigrams)
    for i in range(len(tokens) - 1):
        terms.add(f"{tokens[i]}_{tokens[i+1]}")
    return terms


def expand_with_synonyms(terms: set[str]) -> set[str]:
    """Expand term set with known synonyms."""
    expanded = set(terms)
    for term in terms:
        if term in SYNONYMS:
            expanded.update(SYNONYMS[term])
    return expanded


def compute_similarity(golden_text: str, candidate_text: str) -> float:
    """
    Compute semantic similarity between a golden comment and a candidate finding.
    Uses a combination of:
    1. Jaccard similarity on expanded keyword sets
    2. Key technical term overlap bonus
    3. Identifier matching bonus (variable names, method names, etc.)
    """
    golden_terms = extract_key_terms(golden_text)
    candidate_terms = extract_key_terms(candidate_text)

    if not golden_terms or not candidate_terms:
        return 0.0

    # Expand both with synonyms
    golden_expanded = expand_with_synonyms(golden_terms)
    candidate_expanded = expand_with_synonyms(candidate_terms)

    # 1. Jaccard on expanded sets
    intersection = golden_expanded & candidate_expanded
    union = golden_expanded | candidate_expanded
    jaccard = len(intersection) / len(union) if union else 0.0

    # 2. Directional coverage: what fraction of golden terms appear in candidate
    golden_in_candidate = len(golden_terms & candidate_expanded) / len(golden_terms) if golden_terms else 0.0
    candidate_in_golden = len(candidate_terms & golden_expanded) / len(candidate_terms) if candidate_terms else 0.0

    # 3. Extract identifiers (camelCase, dot-notation, specific patterns)
    golden_ids = set(re.findall(r'[a-zA-Z_][a-zA-Z0-9_.]*(?:\(\))?', golden_text))
    candidate_ids = set(re.findall(r'[a-zA-Z_][a-zA-Z0-9_.]*(?:\(\))?', candidate_text))
    # Filter to interesting identifiers (longer than 3 chars, not common words)
    golden_ids = {i for i in golden_ids if len(i) > 3 and i.lower() not in STOP_WORDS}
    candidate_ids = {i for i in candidate_ids if len(i) > 3 and i.lower() not in STOP_WORDS}
    id_overlap = len(golden_ids & candidate_ids)
    id_bonus = min(id_overlap * 0.05, 0.25)  # Cap bonus at 0.25

    # Combine scores
    score = (
        0.3 * jaccard +
        0.35 * golden_in_candidate +
        0.15 * candidate_in_golden +
        0.2 * id_bonus / 0.25 if id_bonus > 0 else 0
    )

    # Give extra weight if score is already above a threshold (nonlinear boost)
    if score > 0.15:
        score = score * 1.2

    return min(score, 1.0)


# ─── Evaluation Engine ───────────────────────────────────────────────────

def load_data():
    """Load all benchmark data files."""
    with open(PR_LABELS_FILE) as f:
        pr_labels = json.load(f)
    with open(BENCHMARK_DATA_FILE) as f:
        benchmark_data = json.load(f)

    # Try loading official evaluations for comparison
    official_evals = None
    if EVALUATIONS_FILE.exists():
        with open(EVALUATIONS_FILE) as f:
            official_evals = json.load(f)

    # Try loading candidates
    candidates = None
    if CANDIDATES_FILE.exists():
        with open(CANDIDATES_FILE) as f:
            candidates = json.load(f)

    return pr_labels, benchmark_data, official_evals, candidates


def get_repo_name(url: str) -> str:
    """Extract a short repo name from PR URL."""
    if 'keycloak' in url and 'greptile' in url:
        return 'keycloak-greptile'
    elif 'keycloak' in url:
        return 'keycloak'
    elif 'sentry' in url and 'greptile' in url:
        return 'sentry-greptile'
    elif 'sentry' in url:
        return 'sentry'
    elif 'grafana' in url:
        return 'grafana'
    elif 'discourse' in url:
        return 'discourse-graphite'
    elif 'cal.com' in url or 'calcom' in url:
        return 'cal.com'
    return 'unknown'


def run_evaluation(threshold: float = DEFAULT_THRESHOLD, verbose: bool = False):
    """Run the full evaluation."""
    pr_labels, benchmark_data, official_evals, candidates_data = load_data()

    total_tp = 0
    total_fp = 0
    total_fn = 0
    per_repo = defaultdict(lambda: {'tp': 0, 'fp': 0, 'fn': 0, 'total_golden': 0})
    per_bug_type_fn = Counter()
    per_severity_fn = Counter()
    fp_categories = []
    fn_details = []
    tp_details = []
    all_pr_results = []

    # Track which PRs are in benchmark_data
    evaluated_prs = set()

    for pr_url, label_data in pr_labels.items():
        if pr_url == 'https://example/pr':
            continue  # Skip example entry

        repo = get_repo_name(pr_url)
        language = label_data['derived']['language']
        n_golden = label_data['derived']['num_golden_comments']
        bug_types = label_data.get('comment_bug_types', [])

        # Get golden comments
        bd = benchmark_data.get(pr_url, {})
        golden_comments = bd.get('golden_comments', [])

        if not golden_comments:
            # PR not in benchmark_data -- all golden are FN
            for i in range(n_golden):
                bt = bug_types[i]['bug_type'] if i < len(bug_types) else 'unknown'
                sev = label_data['derived']['severity_mix']
                per_bug_type_fn[bt] += 1
            total_fn += n_golden
            per_repo[repo]['fn'] += n_golden
            per_repo[repo]['total_golden'] += n_golden
            continue

        evaluated_prs.add(pr_url)

        # Get CodeSheriff candidates
        cs_candidates = []
        if candidates_data and pr_url in candidates_data:
            cs_candidates = candidates_data[pr_url].get('codesheriff', [])
        else:
            # Fall back to benchmark_data reviews
            for review in bd.get('reviews', []):
                if review.get('tool') == 'codesheriff':
                    for comment in review.get('review_comments', []):
                        body = comment.get('body', '')
                        # Extract the core finding text (strip markdown formatting)
                        body = re.sub(r'\*\*CodeSheriff:?\s*', '', body)
                        body = re.sub(r'\*\*', '', body)
                        body = re.sub(r'\[(?:HIGH|MEDIUM|LOW|CRITICAL)\]', '', body)
                        body = body.strip()
                        if body:
                            cs_candidates.append({
                                'text': body,
                                'path': comment.get('path'),
                                'line': comment.get('line'),
                            })

        # Match candidates to golden comments
        n_candidates = len(cs_candidates)
        matched_golden = set()
        matched_candidates = set()
        match_details = []

        # Build similarity matrix
        sim_matrix = []
        for gi, gc in enumerate(golden_comments):
            for ci, cand in enumerate(cs_candidates):
                cand_text = cand.get('text', cand.get('body', ''))
                sim = compute_similarity(gc['comment'], cand_text)
                sim_matrix.append((sim, gi, ci))

        # Greedy matching: highest similarity first
        sim_matrix.sort(reverse=True)
        for sim, gi, ci in sim_matrix:
            if gi in matched_golden or ci in matched_candidates:
                continue
            if sim >= threshold:
                matched_golden.add(gi)
                matched_candidates.add(ci)
                gc = golden_comments[gi]
                cand = cs_candidates[ci]
                match_details.append({
                    'golden': gc['comment'],
                    'candidate': cand.get('text', cand.get('body', '')),
                    'similarity': sim,
                    'severity': gc.get('severity', 'Unknown'),
                })

        tp = len(matched_golden)
        fp = n_candidates - len(matched_candidates)
        fn = len(golden_comments) - len(matched_golden)

        total_tp += tp
        total_fp += fp
        total_fn += fn
        per_repo[repo]['tp'] += tp
        per_repo[repo]['fp'] += fp
        per_repo[repo]['fn'] += fn
        per_repo[repo]['total_golden'] += len(golden_comments)

        # Track FN bug types
        for gi, gc in enumerate(golden_comments):
            if gi not in matched_golden:
                bt = bug_types[gi]['bug_type'] if gi < len(bug_types) else 'unknown'
                sev = gc.get('severity', 'Unknown')
                per_bug_type_fn[bt] += 1
                per_severity_fn[sev] += 1
                fn_details.append({
                    'pr_url': pr_url,
                    'repo': repo,
                    'language': language,
                    'comment': gc['comment'],
                    'severity': sev,
                    'bug_type': bt,
                    'reasoning': bug_types[gi].get('reasoning', '') if gi < len(bug_types) else '',
                })

        # Track FP details
        for ci, cand in enumerate(cs_candidates):
            if ci not in matched_candidates:
                fp_categories.append({
                    'pr_url': pr_url,
                    'repo': repo,
                    'candidate': cand.get('text', cand.get('body', '')),
                })

        # Track TP details
        for md in match_details:
            tp_details.append({
                'pr_url': pr_url,
                'repo': repo,
                **md,
            })

        pr_result = {
            'pr_url': pr_url,
            'repo': repo,
            'language': language,
            'tp': tp,
            'fp': fp,
            'fn': fn,
            'n_golden': len(golden_comments),
            'n_candidates': n_candidates,
            'matches': match_details,
        }
        all_pr_results.append(pr_result)

    # ─── Output ──────────────────────────────────────────────────────

    print("=" * 80)
    print("  CodeSheriff Internal Evaluation Harness")
    print(f"  Threshold: {threshold}")
    print("=" * 80)
    print()

    # Per-PR details
    if verbose:
        print("─" * 80)
        print("  DETAILED RESULTS BY PR")
        print("─" * 80)
        for pr in sorted(all_pr_results, key=lambda x: x['repo']):
            print(f"\nPR: {pr['pr_url']}")
            print(f"  Repo: {pr['repo']} | Lang: {pr['language']}")
            print(f"  Golden: {pr['n_golden']} | Candidates: {pr['n_candidates']} | TP: {pr['tp']} | FP: {pr['fp']} | FN: {pr['fn']}")

            for m in pr['matches']:
                print(f"  MATCH (sim={m['similarity']:.3f}):")
                print(f"    Golden:    {m['golden'][:100]}")
                print(f"    Candidate: {m['candidate'][:100]}")

            # Show missed golden comments
            bd = benchmark_data.get(pr['pr_url'], {})
            golden_comments = bd.get('golden_comments', [])
            bug_types_data = pr_labels.get(pr['pr_url'], {}).get('comment_bug_types', [])
            matched_indices = set()
            if candidates_data and pr['pr_url'] in candidates_data:
                cs_cands = candidates_data[pr['pr_url']].get('codesheriff', [])
            else:
                cs_cands = []

            for m in pr['matches']:
                for gi, gc in enumerate(golden_comments):
                    if gc['comment'] == m['golden']:
                        matched_indices.add(gi)

            for gi, gc in enumerate(golden_comments):
                if gi not in matched_indices:
                    bt = bug_types_data[gi]['bug_type'] if gi < len(bug_types_data) else '?'
                    print(f"  MISSED [{gc.get('severity','?')}/{bt}]:")
                    print(f"    Golden: {gc['comment'][:120]}")

        print()

    # Overall summary
    precision = total_tp / (total_tp + total_fp) if (total_tp + total_fp) > 0 else 0
    recall = total_tp / (total_tp + total_fn) if (total_tp + total_fn) > 0 else 0
    f1 = 2 * precision * recall / (precision + recall) if (precision + recall) > 0 else 0

    print("─" * 80)
    print("  OVERALL SUMMARY")
    print("─" * 80)
    print(f"  True Positives:   {total_tp}")
    print(f"  False Positives:  {total_fp}")
    print(f"  False Negatives:  {total_fn}")
    print(f"  Precision:        {precision*100:.1f}%")
    print(f"  Recall:           {recall*100:.1f}%")
    print(f"  F1 Score:         {f1*100:.1f}%")
    print(f"  Total Candidates: {total_tp + total_fp}")
    print(f"  Total Golden:     {total_tp + total_fn}")
    print(f"  PRs Evaluated:    {len(evaluated_prs)}")
    print()

    # Per-repo breakdown
    print("─" * 80)
    print("  PER-REPOSITORY BREAKDOWN")
    print("─" * 80)
    print(f"  {'Repo':<22} {'PRs':>4} {'TP':>4} {'FP':>4} {'FN':>4} {'Prec':>7} {'Recall':>7} {'F1':>7}")
    print(f"  {'─'*22} {'─'*4} {'─'*4} {'─'*4} {'─'*4} {'─'*7} {'─'*7} {'─'*7}")

    repo_pr_counts = Counter()
    for pr in all_pr_results:
        repo_pr_counts[pr['repo']] += 1

    for repo in sorted(per_repo.keys()):
        r = per_repo[repo]
        p = r['tp'] / (r['tp'] + r['fp']) if (r['tp'] + r['fp']) > 0 else 0
        rec = r['tp'] / (r['tp'] + r['fn']) if (r['tp'] + r['fn']) > 0 else 0
        f = 2 * p * rec / (p + rec) if (p + rec) > 0 else 0
        n_prs = repo_pr_counts.get(repo, 0)
        print(f"  {repo:<22} {n_prs:>4} {r['tp']:>4} {r['fp']:>4} {r['fn']:>4} {p*100:>6.1f}% {rec*100:>6.1f}% {f*100:>6.1f}%")

    print()

    # FN by bug type
    print("─" * 80)
    print("  FALSE NEGATIVES BY BUG TYPE")
    print("─" * 80)
    for bt, count in per_bug_type_fn.most_common():
        print(f"  {bt:<25} {count:>4}")
    print()

    # FN by severity
    print("─" * 80)
    print("  FALSE NEGATIVES BY SEVERITY")
    print("─" * 80)
    for sev, count in per_severity_fn.most_common():
        print(f"  {sev:<25} {count:>4}")
    print()

    # Compare with official if available
    if official_evals:
        print("─" * 80)
        print("  COMPARISON WITH OFFICIAL MARTIAN EVALUATION")
        print("─" * 80)
        off_tp = off_fp = off_fn = 0
        for url, pr_evals in official_evals.items():
            cs = pr_evals.get('codesheriff', {})
            off_tp += cs.get('tp', 0)
            off_fp += cs.get('fp', 0)
            off_fn += cs.get('fn', 0)

        off_p = off_tp / (off_tp + off_fp) if (off_tp + off_fp) > 0 else 0
        off_r = off_tp / (off_tp + off_fn) if (off_tp + off_fn) > 0 else 0
        off_f1 = 2 * off_p * off_r / (off_p + off_r) if (off_p + off_r) > 0 else 0

        print(f"  {'Metric':<20} {'Official':>12} {'Local':>12} {'Delta':>12}")
        print(f"  {'─'*20} {'─'*12} {'─'*12} {'─'*12}")
        print(f"  {'TP':<20} {off_tp:>12} {total_tp:>12} {total_tp - off_tp:>+12}")
        print(f"  {'FP':<20} {off_fp:>12} {total_fp:>12} {total_fp - off_fp:>+12}")
        print(f"  {'FN':<20} {off_fn:>12} {total_fn:>12} {total_fn - off_fn:>+12}")
        print(f"  {'Precision':<20} {off_p*100:>11.1f}% {precision*100:>11.1f}% {(precision-off_p)*100:>+11.1f}pp")
        print(f"  {'Recall':<20} {off_r*100:>11.1f}% {recall*100:>11.1f}% {(recall-off_r)*100:>+11.1f}pp")
        print(f"  {'F1':<20} {off_f1*100:>11.1f}% {f1*100:>11.1f}% {(f1-off_f1)*100:>+11.1f}pp")
        print()

    # Return data for gap analysis
    return {
        'total_tp': total_tp,
        'total_fp': total_fp,
        'total_fn': total_fn,
        'precision': precision,
        'recall': recall,
        'f1': f1,
        'per_repo': dict(per_repo),
        'fn_details': fn_details,
        'fp_categories': fp_categories,
        'tp_details': tp_details,
        'per_bug_type_fn': dict(per_bug_type_fn),
        'per_severity_fn': dict(per_severity_fn),
        'all_pr_results': all_pr_results,
    }


def find_best_threshold():
    """Search for threshold that best approximates official results."""
    pr_labels_data, benchmark_data, official_evals, candidates_data = load_data()

    if not official_evals:
        print("No official evaluations found. Cannot calibrate.")
        return

    # Get official numbers
    off_tp = off_fp = off_fn = 0
    for url, pr_evals in official_evals.items():
        cs = pr_evals.get('codesheriff', {})
        off_tp += cs.get('tp', 0)
        off_fp += cs.get('fp', 0)
        off_fn += cs.get('fn', 0)

    off_f1 = 2 * off_tp / (2 * off_tp + off_fp + off_fn) if (2 * off_tp + off_fp + off_fn) > 0 else 0
    print(f"Official: TP={off_tp}, FP={off_fp}, FN={off_fn}, F1={off_f1*100:.1f}%")
    print()

    best_threshold = 0.1
    best_diff = float('inf')

    for t in range(5, 40):
        threshold = t / 100.0
        # Suppress output
        import io
        old_stdout = sys.stdout
        sys.stdout = io.StringIO()
        try:
            result = run_evaluation(threshold=threshold, verbose=False)
        finally:
            sys.stdout = old_stdout

        diff = abs(result['f1'] - off_f1) + abs(result['total_tp'] - off_tp) / 100
        if diff < best_diff:
            best_diff = diff
            best_threshold = threshold
            print(f"  t={threshold:.2f}: TP={result['total_tp']}, FP={result['total_fp']}, FN={result['total_fn']}, F1={result['f1']*100:.1f}% (diff={diff:.4f})")

    print(f"\nBest threshold: {best_threshold:.2f}")


if __name__ == '__main__':
    verbose = '--verbose' in sys.argv or '-v' in sys.argv
    threshold = DEFAULT_THRESHOLD

    if '--calibrate' in sys.argv:
        find_best_threshold()
        sys.exit(0)

    for i, arg in enumerate(sys.argv):
        if arg == '--threshold' and i + 1 < len(sys.argv):
            threshold = float(sys.argv[i + 1])

    result = run_evaluation(threshold=threshold, verbose=verbose)

    # Save results JSON for gap analysis
    output_file = SCRIPT_DIR / 'eval-results.json'
    with open(output_file, 'w') as f:
        json.dump(result, f, indent=2, default=str)
    print(f"Results saved to {output_file}")
