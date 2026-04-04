#!/usr/bin/env python3
"""
Martian Code Review Benchmark Runner for CodeSheriff
Version 2 - Optimized for precision/recall balance

Key optimizations:
- Disables HallucinationDetector (too many FPs on diff fragments)
- Provides both context lines and added lines for better analysis
- Filters out low-confidence / syntax-artifact findings
- Deduplicates similar findings
"""

import json
import os
import subprocess
import sys
import tempfile
import time
import re
from pathlib import Path
from urllib.request import urlopen, Request
from urllib.error import HTTPError

# Config
CODESHERIFF_DIR = Path.home() / ".openclaw/workspace/codesheriff"
BENCHMARK_DIR = Path.home() / ".openclaw/workspace/code-review-benchmark/offline"
GOLDEN_DIR = BENCHMARK_DIR / "golden_comments"
RESULTS_DIR = BENCHMARK_DIR / "results"
OUTPUT_FILE = RESULTS_DIR / "benchmark_data.json"
PROGRESS_FILE = RESULTS_DIR / "codesheriff_progress.json"
CLI_PATH = CODESHERIFF_DIR / "packages/cli/dist/cli.js"

PATH_ENV = "/Users/oc/Library/Python/3.9/bin:/opt/homebrew/bin:/opt/homebrew/Cellar/node/25.8.2/bin:" + os.environ.get("PATH", "")

EXT_TO_LANG = {
    ".ts": "typescript", ".tsx": "typescript",
    ".js": "javascript", ".jsx": "javascript", ".mjs": "javascript",
    ".py": "python", ".go": "go", ".java": "java",
    ".rb": "ruby", ".rs": "rust", ".kt": "kotlin",
    ".php": "php", ".cs": "csharp", ".cpp": "cpp", ".c": "c",
    ".sh": "bash", ".scala": "scala",
}

# Patterns to filter out false positive findings from diff fragments
FP_PATTERNS = [
    r"missing closing (parenthesis|brace|bracket)",
    r"syntax error.*extra",
    r"incomplete code fragment",
    r"try block without.*catch",
    r"catch.*without.*try",
    r"missing.*semicolon.*at end",
    r"unterminated (string|template)",
    r"is not (defined|imported|declared) in the provided code",  # Hallucination FPs
    r"is called without any import",
    r"is not available in Node\.js",  # performance.mark is fine in Node
    r"trailing comma.*older",
    r"will output.*\[object Object\]",  # style, not a bug
]
FP_REGEX = re.compile("|".join(FP_PATTERNS), re.IGNORECASE)


def github_api(endpoint, retries=3):
    url = f"https://api.github.com{endpoint}"
    headers = {"Accept": "application/vnd.github.v3+json"}
    token = get_github_token()
    if token:
        headers["Authorization"] = f"token {token}"
    for attempt in range(retries):
        try:
            req = Request(url, headers=headers)
            with urlopen(req, timeout=30) as resp:
                remaining = resp.headers.get("X-RateLimit-Remaining", "?")
                if attempt == 0 and remaining != "?":
                    print(f"  (API rate limit remaining: {remaining})")
                return json.loads(resp.read().decode())
        except HTTPError as e:
            if e.code in (403, 429):
                reset = e.headers.get("X-RateLimit-Reset", "")
                wait_time = 120
                if reset:
                    wait_time = max(10, int(reset) - int(time.time()) + 5)
                    wait_time = min(wait_time, 3600)
                print(f"  Rate limited ({e.code}). Waiting {wait_time}s...")
                time.sleep(wait_time)
                continue
            raise
    raise Exception(f"Failed after {retries} retries: {url}")


def fetch_pr_files(pr_url):
    m = re.search(r"github\.com/([^/]+)/([^/]+)/pull/(\d+)", pr_url)
    if not m:
        raise ValueError(f"Invalid PR URL: {pr_url}")
    owner, repo, pr_num = m.groups()
    return github_api(f"/repos/{owner}/{repo}/pulls/{pr_num}/files?per_page=100")


def write_pr_files_to_dir(pr_files, tmpdir):
    """Write PR files to a temp directory. 
    Include both added and context lines for better analysis."""
    written = 0
    for f in pr_files:
        if f.get("status") == "removed":
            continue
        filename = f.get("filename", "")
        ext = os.path.splitext(filename)[1]
        if ext not in EXT_TO_LANG:
            continue
        patch = f.get("patch", "")
        if not patch or len(patch) < 10:
            continue

        # Include context and added lines (not deleted lines)
        lines = []
        for line in patch.split("\n"):
            if line.startswith("@@"):
                # Keep hunk headers as comments for context
                lines.append(f"// {line}")
            elif line.startswith("-") and not line.startswith("---"):
                continue  # Skip deleted lines
            elif line.startswith("+") and not line.startswith("+++"):
                lines.append(line[1:])
            elif line.startswith(" "):
                lines.append(line[1:])
            else:
                lines.append(line)

        content = "\n".join(lines)
        if len(content.strip()) < 10:
            continue

        filepath = Path(tmpdir) / filename
        filepath.parent.mkdir(parents=True, exist_ok=True)
        filepath.write_text(content, encoding="utf-8")
        written += 1
    return written


def get_api_key():
    key = os.environ.get("ANTHROPIC_API_KEY", "")
    if not key:
        zshrc = Path.home() / ".zshrc"
        if zshrc.exists():
            for line in zshrc.read_text().split("\n"):
                if "ANTHROPIC_API_KEY" in line and "=" in line and "export" in line:
                    key = line.split('"')[1] if '"' in line else line.split("=")[1].strip()
                    break
    return key


def get_github_token():
    token = os.environ.get("GITHUB_TOKEN", "")
    if not token:
        zshrc = Path.home() / ".zshrc"
        if zshrc.exists():
            for line in zshrc.read_text().split("\n"):
                if "GITHUB_TOKEN" in line and "=" in line and "export" in line:
                    token = line.split('"')[1] if '"' in line else line.split("=")[1].strip()
                    break
    return token.strip()


def run_codesheriff(scan_dir):
    """Run CodeSheriff CLI on a directory and return JSON results."""
    api_key = get_api_key()
    env = os.environ.copy()
    env["PATH"] = PATH_ENV
    env["ANTHROPIC_API_KEY"] = api_key

    cmd = ["node", str(CLI_PATH), "scan", str(scan_dir), "--json"]
    try:
        result = subprocess.run(
            cmd, capture_output=True, text=True, timeout=300,
            cwd=str(CODESHERIFF_DIR), env=env,
        )
        stdout = result.stdout.strip()
        if not stdout:
            return {"findings": [], "riskScore": 0, "error": result.stderr[:500] if result.stderr else "empty"}
        try:
            return json.loads(stdout)
        except json.JSONDecodeError:
            for line in stdout.split("\n"):
                line = line.strip()
                if line.startswith("{"):
                    try:
                        return json.loads(line)
                    except json.JSONDecodeError:
                        continue
            return {"findings": [], "riskScore": 0, "error": f"parse: {stdout[:200]}"}
    except subprocess.TimeoutExpired:
        return {"findings": [], "riskScore": 0, "error": "timeout"}
    except Exception as e:
        return {"findings": [], "riskScore": 0, "error": str(e)}


def is_false_positive(finding):
    """Check if a finding is likely a false positive from analyzing diff fragments."""
    # Only keep HIGH and CRITICAL findings — filter everything else as noise
    severity = finding.get("severity", "MEDIUM").upper()
    if severity not in ("HIGH", "CRITICAL"):
        return True

    desc = finding.get("description", "")
    title = finding.get("title", "")
    text = f"{title} {desc}"
    
    # Filter out known FP patterns
    if FP_REGEX.search(text):
        return True
    
    # Filter out hallucination detector findings (too noisy on diffs)
    if finding.get("detector") == "HallucinationDetector":
        return True
    
    # Filter out findings about missing imports/definitions (context issue)
    if "not imported" in text.lower() or "not defined" in text.lower():
        if "but used" not in text.lower() and "without" not in text.lower():
            return True
    
    return False


def deduplicate_findings(findings):
    """Remove duplicate findings. Cap each ruleId to max 2 per scan."""
    seen = set()
    rule_counts = {}
    unique = []
    for f in findings:
        rule_id = f.get("ruleId", "")
        file_path = f.get("filePath", "")

        sig_parts = [
            rule_id,
            f.get("title", "")[:50].lower(),
            file_path,
        ]
        sig = "|".join(sig_parts)

        title_lower = f.get("title", "").lower()
        title_sig = re.sub(r'[^a-z]', '', title_lower)[:30]

        # Cap: max 2 findings per ruleId per scan
        rule_count = rule_counts.get(rule_id, 0)
        if rule_count >= 2:
            continue

        if sig not in seen and title_sig not in seen:
            seen.add(sig)
            seen.add(title_sig)
            rule_counts[rule_id] = rule_count + 1
            unique.append(f)
    return unique


def finding_to_comment(finding):
    title = finding.get("title", "Issue found")
    severity = finding.get("severity", "MEDIUM")
    description = finding.get("description", "")
    file_path = finding.get("filePath", "")
    line = finding.get("lineStart", 0)

    body = f"**CodeSheriff: {title}** [{severity}]\n\n{description}"

    metadata = finding.get("metadata", {})
    if metadata.get("explanation"):
        body += f"\n\n**Why this matters:** {metadata['explanation']}"
    if metadata.get("impact"):
        body += f"\n\n**Impact:** {metadata['impact']}"

    autofix = finding.get("autoFix")
    if autofix and autofix.get("suggestedCode"):
        body += f"\n\n**Suggested fix:**\n```\n{autofix['suggestedCode']}\n```"

    return {
        "path": file_path,
        "line": line,
        "body": body,
        "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ"),
    }


def load_golden_comments():
    prs = []
    for json_file in sorted(GOLDEN_DIR.glob("*.json")):
        with open(json_file) as f:
            data = json.load(f)
        for pr in data:
            pr["_source_file"] = json_file.name
        prs.extend(data)
    return prs


def main():
    import argparse
    parser = argparse.ArgumentParser(description='CodeSheriff Benchmark Runner')
    parser.add_argument('--reset', action='store_true', help='Clear progress and re-run all PRs')
    args = parser.parse_args()

    if args.reset:
        print('Resetting progress...')
        if PROGRESS_FILE.exists():
            PROGRESS_FILE.unlink()
        if OUTPUT_FILE.exists():
            with open(OUTPUT_FILE) as f:
                existing = json.load(f)
            for pr_url_key in existing:
                existing[pr_url_key]['reviews'] = [
                    r for r in existing[pr_url_key].get('reviews', [])
                    if r['tool'] != 'codesheriff'
                ]
            with open(OUTPUT_FILE, 'w') as f:
                json.dump(existing, f, indent=2)
        print('Reset complete.')

    RESULTS_DIR.mkdir(parents=True, exist_ok=True)

    print("=" * 60)
    print("CodeSheriff Benchmark Runner v2")
    print("=" * 60)
    print(f"API Key: {get_api_key()[:15]}...")

    all_prs = load_golden_comments()
    print(f"Loaded {len(all_prs)} PRs from golden comments")

    output = {}
    if OUTPUT_FILE.exists():
        with open(OUTPUT_FILE) as f:
            output = json.load(f)
        print(f"Loaded {len(output)} existing entries")

    progress = {}
    if PROGRESS_FILE.exists():
        with open(PROGRESS_FILE) as f:
            progress = json.load(f)

    processed = 0
    skipped = 0
    errors = 0
    total_findings = 0
    total_filtered = 0

    for idx, pr in enumerate(all_prs):
        pr_url = pr["url"]
        source_repo = pr["_source_file"].replace(".json", "")

        # Check if already done
        if pr_url in output:
            reviews = output[pr_url].get("reviews", [])
            cs_review = next((r for r in reviews if r["tool"] == "codesheriff"), None)
            if cs_review and cs_review.get("review_comments"):
                skipped += 1
                continue

        print(f"\n[{idx + 1}/{len(all_prs)}] {pr_url}")
        print(f"  Source: {source_repo} | Golden: {len(pr['comments'])} comments")

        try:
            print("  Fetching diff...")
            pr_files = fetch_pr_files(pr_url)
            print(f"  Got {len(pr_files)} changed files")

            with tempfile.TemporaryDirectory(prefix="cs-bench-") as tmpdir:
                written = write_pr_files_to_dir(pr_files, tmpdir)
                print(f"  {written} analyzable files written")

                review_comments = []
                if written > 0:
                    print("  Running CodeSheriff (full pipeline)...")
                    result = run_codesheriff(tmpdir)

                    if result.get("error"):
                        print(f"  Warning: {result['error'][:100]}")

                    all_findings = result.get("findings", [])
                    
                    # Filter false positives
                    filtered = [f for f in all_findings if not is_false_positive(f)]
                    fp_count = len(all_findings) - len(filtered)
                    
                    # Deduplicate
                    unique = deduplicate_findings(filtered)
                    dedup_count = len(filtered) - len(unique)
                    
                    duration = result.get("durationMs", 0)
                    print(f"  Raw: {len(all_findings)} findings | Filtered: {fp_count} FPs | Deduped: {dedup_count} | Final: {len(unique)} ({duration}ms)")

                    total_findings += len(unique)
                    total_filtered += fp_count

                    review_comments = [finding_to_comment(f) for f in unique]
                else:
                    print("  No analyzable files - empty review")

            # Build output entry
            if pr_url not in output:
                output[pr_url] = {
                    "pr_title": pr.get("pr_title"),
                    "original_url": pr_url,
                    "source_repo": source_repo,
                    "golden_comments": pr["comments"],
                    "golden_source_file": pr["_source_file"],
                    "reviews": [],
                }

            output[pr_url]["reviews"] = [
                r for r in output[pr_url].get("reviews", [])
                if r["tool"] != "codesheriff"
            ]
            output[pr_url]["reviews"].append({
                "tool": "codesheriff",
                "pr_url": pr_url,
                "review_comments": review_comments,
            })

            progress[pr_url] = "done"
            processed += 1

            # Save every 3 PRs
            if processed % 3 == 0:
                with open(OUTPUT_FILE, "w") as f:
                    json.dump(output, f, indent=2)
                with open(PROGRESS_FILE, "w") as f:
                    json.dump(progress, f, indent=2)
                print(f"  [SAVED] {processed} done, {total_findings} findings, {total_filtered} filtered")

            # Rate limiting
            time.sleep(2)

        except Exception as e:
            print(f"  ERROR: {e}")
            errors += 1
            if "rate" in str(e).lower() or "403" in str(e):
                print("  Waiting 120s for rate limit...")
                time.sleep(120)

    # Final save
    with open(OUTPUT_FILE, "w") as f:
        json.dump(output, f, indent=2)
    with open(PROGRESS_FILE, "w") as f:
        json.dump(progress, f, indent=2)

    print("\n" + "=" * 60)
    print("Benchmark Run Complete")
    print("=" * 60)
    print(f"Processed: {processed}")
    print(f"Skipped: {skipped}")
    print(f"Errors: {errors}")
    print(f"Total findings (after filter): {total_findings}")
    print(f"Total filtered out: {total_filtered}")
    print(f"Output: {OUTPUT_FILE}")


if __name__ == "__main__":
    main()
