**To:** benchmark@withmartian.com
**Subject:** CodeSheriff submission to Martian Code Review Benchmark (Offline)

---

Hi Martian team,

We have submitted CodeSheriff results to the Martian Code Review Benchmark via PR: [LINK TO PR -- Vish to fill in after creating]

**About CodeSheriff**

CodeSheriff is an AI code safety scanner designed specifically for AI-assisted development workflows. It reviews pull requests with a multi-stage detection pipeline that combines static analysis (semgrep) with LLM-powered reasoning to catch bugs, security issues, and logic errors. A key differentiator is our autotune system -- detection rules and LLM prompts self-improve based on feedback from each review cycle.

**Benchmark Results**

We ran the full official offline evaluation pipeline (steps 2 through 5) on all 50 benchmark PRs:

- Claude Opus 4.5 judge: **64.6% F1** (55.3% precision, 77.6% recall)
- Claude Sonnet 4.5 judge: **64.2% F1** (55.1% precision, 76.9% recall)
- Average: **64.4% F1**

We found CodeSheriff performed particularly well on sentry PRs (88-91% F1) and maintained strong recall (77%+) across all repositories.

**Tech Stack**

- Semgrep static analysis with custom rule sets per language
- Multi-stage LLM pipeline (8 specialized detectors including logic bug, auth flow, and hallucination detection)
- Autotune feedback loop that refines rules and prompts based on review outcomes
- Deployed as a GitHub App

**Note:** We were unable to run the GPT-5.2 judge evaluation as we do not have a Martian API key or OpenAI API key for that model. We would be happy to re-run with GPT-5.2 if you can provide access or run it on your end.

Please let us know if you need any additional information or if there are issues with the submission.

Best,
Vish Kulkarni
CodeSheriff (https://thecodesheriff.com)
