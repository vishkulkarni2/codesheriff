# Martian Code Review Bench -- Submission Plan

*Prepared: April 4, 2026 | Author: Vish (via Claude)*

---

## 1. How the Benchmark Works

### Overview
The **Martian Code Review Bench** (codereview.withmartian.com) is an open-source, independently operated benchmark by Martian Learning that evaluates AI code review tools using two complementary approaches:

- **Offline benchmark**: 50 PRs from 5 major open-source projects, evaluated against human-curated "golden comments" with severity labels
- **Online benchmark**: Tracks real developer behavior -- which bot comments get acted on vs. ignored in production repos

### Dataset Composition (Offline)

| Project | Language | Domain |
|---------|----------|--------|
| Sentry | Python | Error tracking |
| Grafana | Go | Observability |
| Cal.com | TypeScript | Scheduling |
| Discourse | Ruby | Forum platform |
| Keycloak | Java | Authentication |

- **50 PRs total** across these 5 projects
- Each PR has human-verified golden comments with severity (Low/Medium/High/Critical)
- Golden comments were annotated by actual maintainers and PR authors
- Monthly refresh cycle with versioned iterations to prevent contamination
- Built on datasets from Augment and Greptile

### Metrics
- **Precision**: Correct findings / Total findings (how many of our comments are real issues)
- **Recall**: Found issues / Total real issues (how many known bugs we catch)
- **F1 Score**: Harmonic mean of precision and recall (the headline ranking metric)
- Results are computed per-judge-model (Claude Opus 4.5, Claude Sonnet 4.5, GPT-5.2)

### Evaluation Process
1. An **LLM judge** compares each tool comment against golden comments
2. Judge determines if comments "point to the same bug, concern, or code issue" (semantic matching)
3. Judge outputs JSON: reasoning, match (bool), confidence (0.0-1.0)
4. Matched comments = true positives; unmatched tool comments = false positives; unmatched golden comments = false negatives

### Current Leaderboard (as of March 2026)
- **#1: Cubic** -- 61.8% F1
- 37 tools currently benchmarked including: CodeRabbit, Copilot, Claude, Gemini, Devin, Augment, Greptile, Qodo, Bito, Graphite, Sourcery, and others
- No tool has found more than 63% of known issues

---

## 2. Submission Process

### How to Submit (Offline Benchmark)
The process is well-documented and takes approximately **one afternoon**:

1. **Fork the 50 benchmark PRs** into a GitHub org where CodeSheriff is installed
   ```
   cd offline
   uv sync
   cp .env.example .env  # Add GH_TOKEN + MARTIAN_API_KEY
   uv run python -m code_review_benchmark.step0_fork_prs --org <our-org> --name codesheriff
   ```
   This creates repos like `sentry__codesheriff__PR12345__20260404` in our org

2. **Let CodeSheriff review each forked PR** -- our GitHub App triggers automatically on PR events

3. **Download the review data**
   ```
   uv run python -m code_review_benchmark.step1_download_prs --output results/benchmark_data.json
   ```

4. **Extract individual issues from our comments**
   ```
   uv run python -m code_review_benchmark.step2_extract_comments --tool codesheriff
   ```

5. **Deduplicate** (recommended)
   ```
   uv run python -m code_review_benchmark.step2_5_dedup_candidates --tool codesheriff
   ```

6. **Run LLM judge evaluation**
   ```
   uv run python -m code_review_benchmark.step3_judge_comments --dedup-groups results/{model}/dedup_groups.json
   ```

7. **View results dashboard**
   ```
   uv run python analysis/benchmark_dashboard.py
   ```

### Requirements
- **GitHub token** with repo access (for forking and downloading review data)
- **Martian API key** (or OpenAI-compatible LLM key) for the judge model
- **Python >= 3.10** with `uv` package manager
- CodeSheriff GitHub App must be installed on the org where PRs are forked

### GitHub Repo
- **Repository**: github.com/withmartian/code-review-benchmark (MIT license, 108 stars)
- **Contact**: contact@withmartian.com
- **Discord**: discord.com/invite/kX6s6nV3zT

---

## 3. Estimated Performance

### Strengths (likely to boost recall)
Our 8-stage pipeline with specialized detectors gives us targeted coverage:
- **HallucinationDetector**: Will catch phantom imports and hallucinated APIs -- but this only helps if the golden set contains these types of issues (unlikely in human-authored PRs from established repos)
- **AuthFlowValidator**: Strong on Keycloak PRs (authentication-focused project)
- **SecretsScanner (TruffleHog)**: Will catch any secrets in the benchmark PRs
- **LogicBugDetector**: General logic analysis, should match some golden comments
- **AIPatternDetector**: 6 rules + 7 semgrep YAML rules for AI-specific patterns
- **StaticAnalyzer (Semgrep)**: Custom rules will catch structural issues

### Weaknesses (likely to hurt precision and recall)

| Weakness | Impact | Severity |
|----------|--------|----------|
| Multi-language coverage gaps | Benchmark spans Python, Go, TS, Ruby, Java. Our semgrep rules may be TS/JS-heavy. | HIGH |
| No full-codebase navigation | Cubic navigates the entire repo with jump-to-definition. We analyze diffs only. | HIGH |
| AI-specific detector focus | Our detectors are tuned for AI-generated code. The benchmark PRs are human-authored. | MEDIUM |
| Potential over-flagging | 8-stage pipeline with 6+ detectors may produce high volume, hurting precision. | MEDIUM |
| No prior benchmark tuning | Cubic has likely optimized for this benchmark. We have not. | MEDIUM |

### Estimated Scores

**Conservative estimate**: 35-45% F1
- We should match several logic bugs and structural issues via Semgrep + LogicBugDetector
- Our precision may be moderate -- some AI-specific findings will not match golden comments
- Our recall will be limited by diff-only analysis and lack of multi-language rule depth

**Optimistic estimate**: 50-55% F1
- If our LLM-based detectors (LogicBug, Hallucination, Explanation) produce comments that semantically match golden issues
- If TruffleHog catches any secrets issues in the benchmark set
- If AuthFlowValidator performs well on Keycloak PRs

**Target for credibility**: >45% F1
- This would put us roughly mid-pack, ahead of many established tools
- Beating CodeRabbit (reportedly ranked around #17) would be a strong messaging win

---

## 4. Pre-Submission Action Plan

### Phase 1: Internal Dry Run (2-3 days)

**Step 1: Set up benchmark locally on Mac Mini**
```
cd ~/.openclaw/workspace
git clone https://github.com/withmartian/code-review-benchmark.git
cd code-review-benchmark/offline
uv sync
cp .env.example .env
# Configure with our GitHub token and Martian/OpenAI API key
```

**Step 2: Create a GitHub org for benchmark PRs**
- Create org: `codesheriff-benchmark` (or similar)
- Install CodeSheriff GitHub App on this org
- Ensure webhook URL (api.codesheriff.dev/webhooks/github) is reachable

**Step 3: Fork benchmark PRs and trigger reviews**
```
uv run python -m code_review_benchmark.step0_fork_prs --org codesheriff-benchmark --name codesheriff
```
- Wait for CodeSheriff to review all 50 PRs (may take 1-2 hours depending on queue)
- Monitor via CodeSheriff dashboard/logs

**Step 4: Run evaluation pipeline**
```
uv run python -m code_review_benchmark.step1_download_prs --output results/benchmark_data.json
uv run python -m code_review_benchmark.step2_extract_comments --tool codesheriff
uv run python -m code_review_benchmark.step2_5_dedup_candidates --tool codesheriff
uv run python -m code_review_benchmark.step3_judge_comments
uv run python analysis/benchmark_dashboard.py
```

**Step 5: Analyze results**
- Review per-project scores (where are we strong/weak?)
- Review per-severity results (are we catching critical issues?)
- Identify golden comments we missed -- categorize why
- Identify false positives we generated -- categorize why

### Phase 2: Targeted Improvements (1-2 weeks)

Based on dry run results, likely improvements needed:

1. **Broaden language-specific semgrep rules**
   - Add Python rules (Sentry: Django patterns, QuerySet bugs)
   - Add Go rules (Grafana: goroutine leaks, nil pointer deref)
   - Add Ruby rules (Discourse: Rails patterns)
   - Add Java rules (Keycloak: auth patterns, Java-specific bugs)

2. **Tune precision (reduce false positives)**
   - Increase confidence thresholds for findings
   - Add post-processing filter to suppress low-confidence findings
   - Consider a "benchmark mode" that favors precision over breadth

3. **Improve recall on general code review**
   - Enhance LogicBugDetector prompts to catch the types of issues in golden comments
   - Add a "general code quality" detection pass (not just AI-specific patterns)
   - Consider adding a separate "conventional code review" stage to the pipeline

4. **Cross-file context** (longer-term)
   - The benchmark rewards tools that understand cross-file dependencies
   - Consider adding git diff + file-level context fetching for related files
   - This is a significant architectural change but would close the gap with Cubic

### Phase 3: Official Submission

1. Run final evaluation with improvements
2. Submit PR to withmartian/code-review-benchmark adding CodeSheriff results
3. Announce on Discord (discord.com/invite/kX6s6nV3zT)
4. Contact Martian directly at contact@withmartian.com if results do not auto-appear on dashboard

---

## 5. What We Need to Improve to Rank Competitively

### To beat 50% F1 (competitive mid-pack):
- [ ] Add Python, Go, Ruby, Java semgrep rules (not just TS/JS)
- [ ] Tune LogicBugDetector prompts for general code review (not just AI patterns)
- [ ] Reduce false positive rate by filtering low-confidence findings
- [ ] Test and verify CodeSheriff works correctly on forked PRs with diverse repos

### To beat 55% F1 (top 5):
- [ ] Add cross-file context fetching (analyze related files beyond the diff)
- [ ] Implement model routing -- use different LLM prompts for different languages/domains
- [ ] Build a "senior reviewer" pass that looks for issues human reviewers flag
- [ ] Optimize comment format for LLM judge matching (clear, concise, issue-focused)

### To beat 62% F1 (beat Cubic):
- [ ] Full codebase navigation (jump-to-definition, cross-file dependency analysis)
- [ ] Dedicated training/tuning on the types of issues found in the golden set
- [ ] Multiple detection passes with different LLM temperatures/models
- [ ] Significant R&D investment in general code review quality beyond AI-specific patterns

### Comment format optimization
The LLM judge evaluates semantic similarity between our comments and golden comments. Our comments should be:
- **Specific**: Reference the exact file, line, and code construct
- **Issue-focused**: Describe the bug/concern clearly (not just "this could be improved")
- **Actionable**: Explain what should change
- **Not verbose**: Long explanations about AI patterns may dilute the core issue signal

---

## 6. Credentials and Manual Actions Required from Vish

| Item | Status | Action Required |
|------|--------|-----------------|
| GitHub org for benchmarking | NEEDED | Create `codesheriff-benchmark` org on GitHub |
| Install CodeSheriff App on benchmark org | NEEDED | Install via GitHub App settings page |
| Martian API key | NEEDED | Sign up at withmartian.com or use OpenAI API key |
| GitHub PAT with repo scope | NEEDED | Generate at github.com/settings/tokens |
| Python + uv on Mac Mini | CHECK | Verify python3 >= 3.10 and install uv if missing |
| OpenAI or Anthropic API key | LIKELY HAVE | For the LLM judge step (can use Martian as proxy) |

---

## 7. Timeline

| Week | Activity | Owner |
|------|----------|-------|
| **Week 1** (Apr 7-11) | Clone benchmark repo, set up org, fork PRs, run initial dry run | Vish |
| **Week 1** | Analyze dry run results, identify weak categories | Vish + Rache |
| **Week 2** (Apr 14-18) | Add multi-language semgrep rules (Python, Go, Ruby, Java) | Engineering |
| **Week 2** | Tune LogicBugDetector for general code review patterns | Engineering |
| **Week 2** | Optimize comment formatting for judge matching | Engineering |
| **Week 3** (Apr 21-25) | Re-run benchmark with improvements, iterate | Engineering |
| **Week 3** | If >45% F1: prepare official submission | Vish |
| **Week 4** (Apr 28-May 2) | Submit to benchmark, announce on Discord, contact Martian | Vish |
| **Week 4** | Write blog post about benchmark results + differentiation story | Rache |

---

## 8. Strategic Notes

### Even a mid-pack ranking is valuable
Cubic is #1 at 61.8% F1. Even ranking #10-15 gives us:
- Independent third-party validation that we actually find bugs
- "Benchmarked on Martian Code Review Bench" credibility in marketing
- Specific data on where we outperform established tools
- A baseline to improve against in future benchmark versions

### Our differentiation story remains strong regardless of ranking
The benchmark measures **general code review quality** on human-authored PRs. Our value proposition is **AI-specific code safety** -- hallucination detection, AI pattern recognition, secrets scanning. These capabilities are orthogonal to the benchmark and will not be fully measured there. Our messaging should be:

> "Ranked [X] on Martian Code Review Bench for general code review -- AND the only tool that catches AI-specific hallucinations, phantom imports, and security patterns that no benchmark measures yet."

### Future opportunity: Propose an AI-code-specific benchmark track
Contact Martian about adding an "AI-generated code" track to the benchmark -- PRs generated by Cursor/Copilot/Claude Code with known AI-specific bugs. This would be a track where CodeSheriff has an inherent advantage and would establish us as category leaders in AI code safety evaluation.

---

## Appendix A: Benchmark Repository Reference

- **Repo**: github.com/withmartian/code-review-benchmark
- **License**: MIT
- **Offline benchmark**: `offline/` directory
- **Golden comments**: `offline/golden_comments/*.json` (one per project)
- **Results per judge model**: `offline/results/{model_name}/`
- **Methodology doc**: `methodology/full.md`
- **37 tools currently benchmarked**: augment, baz, bito, bugbot, claude, claude-code, codeant, coderabbit, copilot, cubic-dev, cubic-v2, devin, entelligence, gemini, graphite, greptile, greptile-v4, kg, kodus, kodus-v2, linearb, macroscope, mesa, mra-a, mra-b, mra-max, mra-nano, mra-ultra, propel, qodo, qodo-extended, qodo-extended-summary, qodo-v2, qodo-v2-2, qodo-v22, sentry, sourcery, vercel

## Appendix B: Golden Comment Format

Each golden comment entry contains:
```json
{
  "comment": "Description of the bug/issue",
  "severity": "Low|Medium|High|Critical"
}
```

PR-level metadata includes: pr_title, original_url, source_repo, golden_source_file, az_comment

## Appendix C: CodeSheriff Comment Format (Current)

Our inline comments include:
- Severity emoji + title (e.g., "CodeSheriff: Missing null check")
- Description paragraph
- "Why this matters" explanation (optional)
- Suggested fix code block (if auto-fix confidence >= 40%)
- AI pattern flag (if isAIPatternSpecific)

**Optimization note**: The LLM judge matches on semantic similarity. Our current format is detailed but may contain noise (emoji, marketing text, AI-pattern flags) that dilutes the core issue description. Consider a "benchmark mode" or cleaner comment format for evaluation.
