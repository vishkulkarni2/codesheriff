# CodeSheriff Product Roadmap — 2026–2027

*Last updated: April 3, 2026*

---

## Strategic Thesis

We are making one fundamental bet: **the productivity gains of AI-assisted coding are real, but the security debt being accumulated is catastrophic — and no existing tool is built to contain it.** Veracode's Spring 2026 GenAI Code Security Update confirms this isn't a temporary problem: syntax correctness in AI-generated code has climbed from ~50% to 95% since 2023, yet security pass rates have remained flatly stuck between 45–55% across the same period. LLMs are getting better at making code *run*, while making virtually zero progress on making it *safe*. CodeSheriff exists at that gap.

Our second bet is that **the attack surface is compounding, not leveling**. Karpathy coined "vibe coding" in February 2025 to describe developers who "fully give in to the vibes, embrace exponentials, and forget that the code even exists." By early 2026 he was describing AI agents writing 80% of his code. As AI-generated commits become the majority of production code — Forbes reports this is already Karpathy's reality — the failure modes are no longer individual developer bugs but *systemic, reproducible patterns* baked into every LLM's training. These patterns are a new attack surface that traditional SAST, DAST, and secret scanners were never designed to catch. The USENIX analysis of package hallucinations makes this concrete: even at a tiny hallucination rate, the scale of completions means tens of thousands of fictitious packages being injected into dependency graphs daily.

Our third bet is that **CodeSheriff's moat comes from data, not algorithms**. Cubic can copy any individual detector we ship. What Cubic cannot copy is a proprietary dataset of AI-failure patterns extracted from real codebases at scale — the kind of institutional memory that makes each additional customer improve the product for everyone. This roadmap is structured to aggressively build that data flywheel in Q2–Q3, then deploy it as defensible ML features in Q4–Q1 2027 that require 6–12 months of training data to replicate.

---

## Research Insights

**1. AI code has 2.74× more vulnerabilities than human-written code, and it's not improving**
Veracode's 2025 GenAI Code Security Report tested 100+ LLMs across Java, JavaScript, Python, and C# and found AI-generated code contains 2.74× more vulnerabilities than human-written equivalents. Their Spring 2026 update confirms security pass rates remain stuck at ~55% even as syntax rates hit 95%. *Source: Veracode 2025 GenAI Code Security Report; Spring 2026 GenAI Code Security Update.*

**2. Package hallucinations are a structural, not incidental, vulnerability class**
USENIX analysis (July 2025) established that LLM hallucinations in code generation are "not simply a bug to be patched but a structural consequence of how these systems operate." At scale — tens of millions of completions/day — even a fraction-of-a-percent hallucination rate produces tens of thousands of fictitious package names per day that attackers can squat on and poison. *Source: "We Have a Package for You: Comprehensive Analysis of Package Hallucinations in Code," USENIX Login Online, July 2025.*

**3. Karpathy's "jagged intelligence" framing explains why static tooling keeps failing**
Karpathy's 2025 LLM Year in Review introduced the concept of "jagged intelligence": LLMs spike in verifiable domains (math, code syntax) but remain unreliable in open-ended semantic ones (logic correctness, security). "Benchmarks are almost by construction verifiable environments and are therefore immediately susceptible to RLVR," he wrote — meaning LLMs can ace coding benchmarks while still writing insecure code. This is the fundamental argument for an AI-specific safety layer. *Source: Karpathy, "2025 LLM Year in Review," karpathy.bearblog.dev, December 19, 2025.*

**4. 41% of all code committed in 2025 is AI-generated; secrets leak at 2× baseline rate**
Multiple sources (index.dev, Sonar's 2025 survey) put AI-assisted code at 41–42% of all committed code. The Hacker News / Apiiro analysis found AI-assisted commits leaked secrets at roughly double the baseline rate, and by June 2025, AI-generated code was adding over 10,000 new security findings per month across studied repositories — a 10× increase from December 2024. CVEs from AI-generated code grew from 6 in January 2026 to 35 in March 2026. *Source: Apiiro Research; Infosecurity Magazine, March 2026; The Hacker News Expert Insights, March 2026.*

**5. Formal verification is approaching a tipping point that AI will accelerate**
Martin Kleppmann (December 2025) and the "vericoding" paper (September 2025) both argue that AI is about to make formal verification mainstream by removing the historically prohibitive labor cost. The seL4 microkernel required 20 person-years of proof writing for 8,700 lines of C. LLMs can now generate Lean/F* proof skeletons, dramatically cutting that ratio. This creates an opportunity: **property-based invariant checking** can become a practical product feature, not an academic exercise. *Source: Martin Kleppmann, "AI will make formal verification go mainstream," December 8, 2025; "Vericoding: Using LLMs to Generate Formally Verified Code," arxiv, September 2025.*

**6. AI reviewing AI is the next failure mode nobody is building for**
As Karpathy shifted to a "Software 3.0" framing (prompts as programs), the Sequoia Inference blog (June 2025) noted that AI-generated code is now often reviewed by AI, creating an alignment problem: AI reviewers trained on similar distributions will systematically miss the same failure modes the generator makes. This is a new category of risk that requires out-of-distribution detection, not just pattern matching. *Source: Andrej Karpathy, YC AI Startup School, June 16, 2025; Sequoia Inference Newsletter, June 26, 2025.*

**7. Compliance requirements for AI-generated code are arriving and are unmet**
"Formal Verification for AI-Assisted Code Changes in Regulated Environments" (Computer Fraud and Security, November 2025) established that financial and healthcare regulators are beginning to require audit trails specifically for AI-assisted commits. SOC 2, ISO 27001, and emerging AI-specific frameworks (EU AI Act enforcement begins in 2026) will demand provenance tracking for AI-generated code. No current tool provides this. *Source: "Formal Verification for AI-Assisted Code Changes in Regulated Environments," Computer Fraud and Security, November 2025.*

---

## Q2 2026: Launch & Foundation (April–June)

*Goal: Ship, get 10 paying teams, establish the AI code safety category*

---

### Supply Chain Hallucination Shield

**One-liner:** Detects hallucinated package names in AI-generated import statements before they become dependency-confusion or package-squatting attack vectors.

**Why it matters:** The USENIX package hallucination analysis established that LLMs structurally generate fictitious package names at scale — and attackers actively monitor popular AI tools to register hallucinated names and publish malicious packages under those names. This is the fastest-growing new attack vector in the AI era and no existing tool catches it at the import-analysis stage.

**Research backing:** "We Have a Package for You: Comprehensive Analysis of Package Hallucinations in Code," USENIX Login Online, July 2025: "At the scale of tens of millions of code completions per day, that is still tens of thousands of fictitious packages being generated." ArXiv 2504.20799, "Hallucination by Code Generation LLMs: Taxonomy, Benchmarks, Mitigation, and Challenges," May 2025.

**Effort:** M

**Competitive advantage:** ⭐⭐⭐⭐

**Moat type:** Data flywheel / Technical depth

**Implementation notes:** Cross-reference imported package names against live npm, PyPI, Maven, and crates.io registries; compare against a maintained "hallucinated-but-registered" blocklist seeded from the USENIX dataset. Flag packages that are: (a) not in any registry, (b) registered within the past 90 days with zero dependents, or (c) name-similar to a real package but not identical. Build the proprietary hallucinated-package corpus from production scans — this data flywheel is the moat.

---

### AI-Attribution Commit Fingerprinting

**One-liner:** Detects and labels which code in a PR or push was AI-generated vs. human-written, creating a permanent audit trail per commit.

**Why it matters:** As 41–42% of committed code is now AI-generated (index.dev/Sonar 2025) and AI-generated code leaks secrets at 2× the baseline rate (Apiiro research), enterprises need provenance tracking. This is also the foundation for every downstream risk-weighting feature: you can't apply AI-specific rules to a codebase unless you know which parts are AI-generated.

**Research backing:** Sonar's 2025 State of Code survey: "42% of committed code includes AI assistance. Yet developers spend more time reviewing AI code than writing it." Forbes, March 2026: "AI Agents Wrote 80% Of Karpathy's Code." Apiiro (June 2025): "AI-generated code was adding over 10,000 new security findings per month — a 10× increase from December 2024."

**Effort:** M

**Competitive advantage:** ⭐⭐⭐

**Moat type:** Switching cost / Data flywheel

**Implementation notes:** Use an ensemble of heuristic signals: AST-level stylometric features correlated with known AI generation patterns (excessive optional chaining, over-specific variable naming, phantom comments), git blame + commit message analysis (detecting Claude/Copilot/Cursor agent commit message patterns), and a fine-tuned classifier trained on our labeled corpus. Store attribution per function-level granularity in Postgres. Over time, the accumulated attribution data becomes a unique dataset no competitor can replicate.

---

### Infrastructure-as-Code (IaC) AI Risk Scanner

**One-liner:** Extends CodeSheriff's detection pipeline to Terraform, Pulumi, Bicep, and CloudFormation files generated by AI coding assistants.

**Why it matters:** AI coding assistants are increasingly generating IaC, not just application code. The failure modes are worse: a hallucinated IAM policy grants `*:*` on an S3 bucket; a hallucinated Terraform resource name silently does nothing; an AI-generated security group opens 0.0.0.0/0. These bugs are harder to catch because IaC "works" syntactically while being catastrophically misconfigured. No specialized tool targets AI-generated IaC specifically.

**Research backing:** Karpathy's Software 3.0 framing (YC AI Startup School, June 2025) describes a world where "the focus shifts from the laborious act of writing code to the strategic act of orchestrating AI to produce it" — IaC is the first production domain fully automated by agents. Microsoft CEO Satya Nadella confirmed 20–30% of Microsoft repository code is now AI-generated (April 2025), and IaC repos are disproportionately agent-driven.

**Effort:** M

**Competitive advantage:** ⭐⭐⭐⭐

**Moat type:** Category creation / Technical depth

**Implementation notes:** Add an IaC-specific pipeline stage: parse HCL/YAML into a resource graph, apply AI-pattern heuristics (overly permissive defaults, hallucinated resource types, missing required tags), and cross-reference against cloud provider APIs to detect non-existent resource types or deprecated parameter names. Extend the Autotune loop to evolve IaC rules from production findings. Cubic has no IaC scanner; this is a whitespace win that expands TAM to DevOps/platform teams.

---

### "Why AI?" Explanation Layer (Public Benchmark Edition)

**One-liner:** Every CodeSheriff finding includes a plain-English explanation of *why* an AI tool was likely to generate this specific bug, mapping the finding to known LLM behavioral patterns.

**Why it matters:** Developers using Cursor, Claude Code, and Copilot don't just need to know *what* is wrong — they need to understand *why their AI assistant generated it* so they can prompt better or add pre-commit guards. This positions CodeSheriff as the expert on AI coding behavior, not just a bug detector. It also enables a public benchmark/leaderboard (the "CodeSheriff AI Safety Score") that drives organic SEO and category authority.

**Research backing:** Karpathy's "jagged intelligence" concept (2025 LLM Year in Review): LLMs "spike in verifiable domains but remain unreliable in open-ended semantic ones." The ACM paper "LLM Hallucinations in Practical Code Generation: Phenomena, Mechanism, and Mitigation" (ACM on Software Engineering, published June 2025) provides a taxonomy of hallucination types (method-level, API-level, library-level) that maps directly to explainability categories.

**Effort:** S

**Competitive advantage:** ⭐⭐

**Moat type:** Category creation / Network effect

**Implementation notes:** Extend the existing Explanation stage in the pipeline with a structured "AI behavior attribution" output: which LLM behavioral pattern (over-confident API reference, training-data recency bias, instruction-following without grounding) explains the finding. Build a public dashboard showing per-model safety scores across anonymized scan data. This creates a content moat and drives inbound from the security research community.

---

## Q3 2026: Growth & Adoption (July–September)

*Goal: 100 paying teams, 3 enterprise pilots, benchmark credibility*

---

### Vibe-to-Verified Auto-Fix Suggestions

**One-liner:** For each AI-generated vulnerability found, CodeSheriff generates a verified, drop-in fix with a before/after diff that developers can apply in one click.

**Why it matters:** Detection without remediation creates friction. The GitClear 2025 AI Code Quality report found developers using AI assistants spend more time *reviewing and revising* AI code than they saved generating it — the review burden is the bottleneck. Auto-fix suggestions that are themselves verified (passing the same suite of checks that caught the bug) close this loop and make CodeSheriff a net-positive for developer velocity, not just a blocker.

**Research backing:** Springer "Advancements in Automated Program Repair" (March 2025): hybrid APR systems combining LLMs with static analysis for fix generation consistently outperform either alone. TOSEM 2026 paper "Hybrid Automated Program Repair by Combining Large Language Models and Program Analysis" demonstrates that analysis-constrained LLM repair avoids the common failure mode of fixes that introduce new bugs. GitClear AI Copilot Code Quality 2025: "Downward pressure on code quality" driven by unreviewed AI suggestions.

**Effort:** L

**Competitive advantage:** ⭐⭐⭐

**Moat type:** Data flywheel / Switching cost

**Implementation notes:** Use Claude to generate fix candidates conditioned on: (1) the specific vulnerability pattern, (2) the surrounding code context, (3) CodeSheriff's own rule corpus. Run the candidate through the full 8-stage pipeline to verify it doesn't introduce new issues. Store accepted fixes in a per-org fix history — this becomes an institutional code memory that makes switching away from CodeSheriff expensive. Cubic offers auto-fix but without security re-verification.

---

### Real-Time IDE Extension (VS Code + JetBrains)

**One-liner:** A lightweight CodeSheriff sidebar that flags AI-generated security issues inline as code is accepted from Cursor/Copilot/Claude Code, before it reaches the PR stage.

**Why it matters:** Shift-left has always meant "catch it earlier." The next frontier is catching AI-generated bugs *at acceptance*, not at PR review — before the developer has already moved on mentally. At 82% of developers using AI tools weekly (NetCorps 2026 stats), the IDE is where the most leverage is. This is also the primary distribution channel Cubic is using, so we need parity here to not cede the top-of-funnel.

**Research backing:** GitHub's 2025 Octoverse Report: "Repositories with AI-assisted review had 32% faster merge times and 28% fewer post-merge defects compared to those relying solely on human review." The implication: the earlier the review, the better the outcomes. Veracode Spring 2026: security pass rates haven't improved despite better models — which means the gap must be closed at a different point in the pipeline.

**Effort:** L

**Competitive advantage:** ⭐⭐

**Moat type:** Switching cost / Network effect

**Implementation notes:** Build a VS Code extension that streams accepted Copilot/Claude Code completions to the CodeSheriff API using a debounced background queue. Flag secrets, hallucinated imports, and auth-pattern issues inline with severity-colored gutter icons. Keep the local extension lightweight (just transport + display); all analysis runs server-side. This creates daily active usage and installs switching costs at the IDE layer. Freemium tier gates this at 100 inline checks/month.

---

### Multi-Repo Risk Intelligence Dashboard

**One-liner:** An org-level view that aggregates AI-generated risk scores across all repositories, with cross-repo trend analysis, team-level breakdowns, and CISO-ready export.

**Why it matters:** At 10+ paying teams, the next buyer is the CISO or VP Engineering who manages 20–100 repos. They don't want per-PR feedback — they want strategic risk visibility: "which teams are accumulating AI-generated security debt the fastest?" and "are we improving quarter-over-quarter?" This is the product that drives the jump from $29/team/month to enterprise contract conversations.

**Research backing:** Apiiro research (June 2025): "AI-generated code was adding over 10,000 new security findings per month across studied repositories." The need for aggregated visibility at this scale is explicit. "Formal Verification for AI-Assisted Code Changes in Regulated Environments" (Computer Fraud and Security, November 2025): regulated enterprises need audit-trail views, not just per-PR findings.

**Effort:** M

**Competitive advantage:** ⭐⭐⭐

**Moat type:** Switching cost / Data flywheel

**Implementation notes:** Build on top of existing risk history + trend charts. Add org-level aggregation: risk score per repo, per team, per AI tool (Copilot vs. Claude Code vs. Cursor), and over time. Include a CISO export (PDF + CSV) with executive summary, top-3 risk trends, and remediation velocity. This makes CodeSheriff the system-of-record for AI code risk — enormous switching cost once embedded in quarterly security reviews.

---

### Bitbucket + Azure DevOps Integration

**One-liner:** Extend CodeSheriff's native GitHub + GitLab support to Bitbucket and Azure DevOps, covering the enterprise SCM long tail.

**Why it matters:** Cubic explicitly doesn't support GitLab, Bitbucket, or Azure DevOps. CodeSheriff already has GitLab — adding Bitbucket and Azure DevOps makes the SCM coverage story complete and blocks Cubic from matching it without significant engineering investment. Enterprise pilot conversations almost always involve at least one of these platforms. This is a distribution win disguised as an integration.

**Research backing:** Microsoft's 2026 trend analysis confirmed GitHub merged 43 million PRs per month — a 23% increase year-over-year. The growth is concentrated in enterprise-tier platforms (Azure DevOps in particular for Microsoft shops). Cubic's lack of multi-SCM support is their most commonly cited limitation in the competitive landscape.

**Effort:** M

**Competitive advantage:** ⭐⭐⭐⭐

**Moat type:** Category creation / Switching cost

**Implementation notes:** Bitbucket uses its own webhook format and PR comment API; Azure DevOps uses its own REST API with PAT auth. Build a normalized SCM adapter layer (already architecturally suggested by the existing GitHub + GitLab handlers) so new integrations follow a clear pattern. Timeline: Bitbucket first (higher SMB demand), Azure DevOps second (unlocks enterprise). No new analysis work required — just transport and display adapters.

---

## Q4 2026: Moat & Differentiation (October–December)

*Goal: Features Cubic cannot copy in < 6 months. Technical depth + proprietary data.*

---

### LLM Behavioral Fingerprint Database (The Proprietary Dataset)

**One-liner:** A continuously-updated, proprietary database of per-model failure patterns — which specific LLM versions generate which specific classes of bugs, under which conditions.

**Why it matters:** This is the core data moat. After 6+ months of production scanning across 100+ teams, CodeSheriff will have seen more AI-generated code failures in the wild than any academic dataset. This fingerprint DB — "GPT-4o tends to hallucinate `bcrypt.hash()` returning a sync value in async contexts; Claude 3.5 Sonnet over-trusts user-supplied JWT claims when instructed to 'keep it simple'" — is unique, proprietary, and improves with every scan. Cubic's general-purpose code review cannot generate this.

**Research backing:** Karpathy's "jagged intelligence" framing (2025 LLM Year in Review): different LLMs have different capability shapes — they spike and fail in different domains. The ACM paper on LLM hallucinations in code (arXiv 2409.20550) established that hallucination types cluster by model architecture and training regime. Apiiro's 10,000 security findings/month data (June 2025) shows the volume needed to train meaningful per-model signals exists in production environments.

**Effort:** L

**Competitive advantage:** ⭐⭐⭐⭐⭐

**Moat type:** Data flywheel

**Implementation notes:** Tag every finding at scan time with: LLM tool (inferred from attribution fingerprinting feature), code pattern, language, vulnerability class, and whether it was accepted or dismissed by a human reviewer. Build a Postgres + vector DB schema for similarity search. Train a lightweight per-model failure-predictor on this corpus quarterly. Expose insights in the dashboard as "Your team uses Claude Code heavily — here are the 3 vulnerability classes to watch." This is the self-improving moat.

---

### Property-Based Invariant Checker (Formal Verification Lite)

**One-liner:** Automatically generates and verifies runtime invariants for critical functions using symbolic execution and SMT-solver-backed property testing, specifically targeting logic bugs AI tools introduce.

**Why it matters:** Karpathy's "jagged intelligence" concept and the Kleppmann formal-verification essay (December 2025) converge on the same insight: AI can write code that looks correct and runs correctly on happy paths, but fails on edge cases that a human reviewer would have thought of. Traditional testing misses these because test cases are also often AI-generated. SMT-solver-backed invariant checking finds the holes tests don't cover — and it's now economically viable because AI can generate the property specs.

**Research backing:** Martin Kleppmann, "AI will make formal verification go mainstream," December 8, 2025: "AI is about to make formal verification mainstream by removing the historically prohibitive labor cost [of writing proofs]." The "vericoding" paper (arXiv, September 2025) coins the term for AI-assisted formal verification and shows early benchmark results. "Formal Verification for AI-Assisted Code Changes in Regulated Environments" (Computer Fraud and Security, November 2025): regulated industries will require proof-carrying code for AI-generated changes.

**Effort:** L

**Competitive advantage:** ⭐⭐⭐⭐⭐

**Moat type:** Technical depth / Category creation

**Implementation notes:** Target Python and TypeScript first. Use Claude to generate Hypothesis (Python) and fast-check (TypeScript) property specs from function signatures + docstrings. Run them under coverage with mutation testing. For critical functions (identified by LogicDetector as high-risk), additionally run Z3 SMT solver against the generated invariants for bounded verification. Surface violations as a new finding type: "Invariant violation: function `validatePayment()` can return `true` when `amount < 0` under inputs [...]". This is a 6–12 month engineering investment Cubic cannot shortcut.

---

### AI-on-AI Review Bias Detector

**One-liner:** Detects when a PR has been "reviewed" by an AI tool (Copilot review, Claude Code review, GitHub Copilot Workspace) and applies out-of-distribution checking to find the shared blind spots between the generator and reviewer.

**Why it matters:** The next major failure mode is AI reviewing AI. When Cursor generates code and then Copilot reviews the PR, both models share similar training distributions — they'll both miss the same things. This is a known problem in alignment (Goodhart's Law applied to model evaluation) and an entirely unaddressed product gap. No tool today detects or corrects for this compounding error.

**Research backing:** Karpathy YC AI Startup School (June 16, 2025): describes a world of AI agents collaborating to produce software, where human oversight is minimal. Sequoia Inference Newsletter (June 2025): "As AI-generated code becomes more prevalent... debugging systems where humans didn't write the original code [requires] AI-powered troubleshooting." The structural point is that same-distribution generators and reviewers have correlated failures — a finding backed by the "jagged intelligence" concept.

**Effort:** L

**Competitive advantage:** ⭐⭐⭐⭐⭐

**Moat type:** Technical depth / Category creation

**Implementation notes:** Detect AI review signals in PR comments (look for Copilot/Gemini Code Assist/etc. comment metadata or stylometric fingerprints). When AI-reviewed code is detected, activate an adversarial mode: query a different LLM family than the likely generator (Claude for Copilot-generated code, GPT for Claude-generated code) specifically focused on out-of-distribution failure modes. Log correlated blind spot patterns to the fingerprint database. This becomes a unique data source: "AI-reviewed AI bugs that both missed."

---

### Compliance Audit Pack (SOC 2 / ISO 27001 / HIPAA)

**One-liner:** Generates per-quarter, auditor-ready evidence packages mapping AI-generated code findings to specific SOC 2 Trust Services Criteria, ISO 27001 controls, and HIPAA Technical Safeguards.

**Why it matters:** Enterprise sales at the CISO level require compliance evidence, not just security findings. SOC 2 auditors are now explicitly asking about AI-generated code controls — and no tooling provides the mapping from "this AI-generated bug" to "this CC7.1 control failure." This feature alone can justify a $10,000+/year enterprise contract, and it creates a compliance-driven switching cost: once your auditor has relied on a CodeSheriff report, they'll require it next year.

**Research backing:** "Formal Verification for AI-Assisted Code Changes in Regulated Environments" (Computer Fraud and Security, November 2025): "The possibility of making severe compliance and reliability issues increases in regulated and safety-critical fields like finance and medicine." EU AI Act enforcement begins 2026, adding regulatory pressure specifically around AI-generated code in high-risk applications. Hinton's warning about software engineering job displacement (December 2025) and the 10–20% AI takeover risk narrative is driving board-level risk appetite for AI governance tools.

**Effort:** M

**Competitive advantage:** ⭐⭐⭐⭐

**Moat type:** Switching cost / Category creation

**Implementation notes:** Build a compliance mapping layer: each CodeSheriff finding type maps to a set of control IDs (e.g., "Hallucinated API in auth path" → SOC 2 CC6.1, CC6.6; HIPAA §164.312(a)(1)). Generate quarterly PDF reports with: (1) total AI-generated code findings, (2) trend vs. prior quarter, (3) control coverage evidence, (4) remediation velocity. Offer a Compliance tier at $299/month/org. Get the report reviewed by one Big 4 auditor firm to validate the framework.

---

## Q1 2027: Vision & Expansion (January–March)

*Goal: Category leadership, enterprise ready, adjacent market entry*

---

### CodeSheriff AI Safety Benchmark (Public Leaderboard)

**One-liner:** A publicly-maintained, methodologically rigorous benchmark measuring per-model security safety scores across 500+ test cases — the definitive industry standard for AI code safety.

**Why it matters:** Veracode has a safety report; Cubic is #1 on Martian Code Review Bench. CodeSheriff needs its own authoritative benchmark to own the "AI code safety" category. A public leaderboard drives: (1) organic SEO and press ("CodeSheriff data shows GPT-5 is 40% safer than Claude 4 for auth code"), (2) enterprise legitimacy, (3) model provider partnerships (model providers want their safety scores to improve — they'll work with you to do so), and (4) a self-referential moat (no competitor's data can replicate a benchmark built on CodeSheriff's proprietary corpus).

**Research backing:** Veracode Spring 2026: "Despite the marketing hype and genuine functional improvements, nearly half of all AI-generated code contains known security vulnerabilities when no security guidance is explicitly provided." There is no currently authoritative AI code *security* benchmark — only general capability benchmarks. Karpathy's apathy toward benchmarks (2025 Year in Review) explicitly states existing benchmarks are "susceptible to RLVR" — a safety-specific benchmark that is harder to game is the right response.

**Effort:** M

**Competitive advantage:** ⭐⭐⭐⭐⭐

**Moat type:** Network effect / Category creation

**Implementation notes:** Curate 500+ real-world code generation prompts across 10 vulnerability categories and 6 languages, drawn from production findings. Score each LLM on pass/fail per vulnerability class. Publish monthly updates. Partner with NYU, CMU, or Stanford security labs for academic credibility (reach out to researchers behind arXiv 2504.20799). Offer model providers API access to run their models against the private test set in exchange for public disclosure. This becomes the reference benchmark cited in enterprise security evaluations.

---

### Self-Hosted / On-Prem Deployment (Enterprise Tier)

**One-liner:** A Docker Compose + Helm chart deployment of the full CodeSheriff stack that runs entirely within a customer's VPC, with no data leaving their environment.

**Why it matters:** Cubic does not offer self-hosting. For enterprises in financial services, healthcare, defense contracting, and regulated industries, this is a hard blocker — they cannot send source code to a third-party SaaS. Self-hosting closes deals Cubic structurally can't compete for, and it pairs perfectly with the Compliance Audit Pack to become the enterprise compliance stack.

**Research backing:** "Formal Verification for AI-Assisted Code Changes in Regulated Environments" (Computer Fraud and Security, November 2025): regulated environments require code to never leave the compliance boundary. Geoffrey Hinton's warning (December 2025 CNN interview) about AI capabilities driving accelerating regulatory scrutiny is creating a class of enterprises that require on-prem everything.

**Effort:** L

**Competitive advantage:** ⭐⭐⭐⭐⭐

**Moat type:** Switching cost / Category creation

**Implementation notes:** Package the Fastify API + BullMQ workers + Next.js dashboard + Postgres + Redis into a Helm chart with optional Anthropic-API-compatible local model support (via Ollama for the Claude-dependent stages). Document a bring-your-own-Claude-API-key flow for teams that can reach Anthropic but want code to stay local. Price at $2,000–$5,000/month/org. Requires significant DevOps work to make the deployment reproducible and upgradeable. This is a 3-month engineering effort but unlocks a $50K+ ARR per-customer segment.

---

### LLM-Native SBOM (Software Bill of Materials for AI)

**One-liner:** Generates a structured "AI SBOM" per release — cataloguing which AI tools generated which code, which model versions, which hallucination risks were caught, and the net AI-generated risk score.

**Why it matters:** Traditional SBOMs track open-source dependencies. The AI era creates a new dimension: what AI tools were used, with what model versions, and what risk was introduced? The EU AI Act, emerging NIST AI RMF guidance, and U.S. federal procurement requirements are beginning to mandate AI provenance documentation. Being first to define the "AI SBOM" format is a category-defining move — like Sonatype was for traditional SBOMs in 2012.

**Research backing:** Apiiro (2025): "AI-assisted commits grew exponentially in 2025" with compounding security debt. The Infosecurity Magazine March 2026 report on 35 AI-generated-code CVEs in a single month makes the case for structured AI provenance. "Formal Verification for AI-Assisted Code Changes in Regulated Environments" explicitly calls for "audit trails specifically for AI-assisted commits" in regulated industries.

**Effort:** M

**Competitive advantage:** ⭐⭐⭐⭐⭐

**Moat type:** Category creation / Network effect

**Implementation notes:** Define a JSON schema for the AI SBOM: per-file AI attribution scores, AI tools detected, model version inferences, findings counts by severity, compliance control mappings, and a net risk score. Generate per-tag/release from the accumulated commit fingerprinting data. Export as CycloneDX extension (leverage existing SBOM tooling ecosystem). Submit to OWASP CycloneDX working group for standardization. If the format is adopted as a standard, CodeSheriff becomes the de facto generator.

---

### Continuous Behavioral Drift Monitor

**One-liner:** Tracks when a team's AI-generated code patterns shift over time (new AI tools, new model versions, new prompting patterns) and proactively re-triggers risk assessments when behavioral drift is detected.

**Why it matters:** Model versions change, AI tool configurations change, prompting patterns evolve — and each change can introduce a new class of vulnerability that historical scan data won't surface. When Cursor updates from one Claude version to another, the hallucination profile changes. No tool today monitors for this behavioral drift in production codebases. This is the autonomous, always-on layer that makes CodeSheriff a continuous safety system rather than a point-in-time scanner.

**Research backing:** Karpathy's 2025 LLM Year in Review: "RLVR involves training against objective reward functions which allows for a lot longer optimization... most of the capability progress of 2025 was defined by the LLM labs chewing through the overhang of this new stage." Each new model training run shifts the behavioral profile. The Veracode data showing security pass rates flat despite syntax improvement confirms that behavioral changes don't come with security improvement signals.

**Effort:** M

**Competitive advantage:** ⭐⭐⭐⭐

**Moat type:** Data flywheel / Switching cost

**Implementation notes:** Build a statistical process control layer over the fingerprint database: track rolling distributions of finding types per repo. When distributions shift significantly (KL-divergence threshold), trigger a full-repo re-scan and notify the security team. Expose drift signals in the dashboard as "New risk pattern detected: your team's AI-generated code started showing SQL injection patterns 3 weeks ago — correlates with a new Cursor config." This is the "always-on" story for enterprise renewal conversations.

---

## Feature Index

| Feature | Quarter | Effort | ⭐ | Moat Type |
|---|---|---|---|---|
| Supply Chain Hallucination Shield | Q2 2026 | M | ⭐⭐⭐⭐ | Data flywheel / Technical depth |
| AI-Attribution Commit Fingerprinting | Q2 2026 | M | ⭐⭐⭐ | Switching cost / Data flywheel |
| IaC AI Risk Scanner | Q2 2026 | M | ⭐⭐⭐⭐ | Category creation / Technical depth |
| "Why AI?" Explanation Layer | Q2 2026 | S | ⭐⭐ | Category creation / Network effect |
| Vibe-to-Verified Auto-Fix Suggestions | Q3 2026 | L | ⭐⭐⭐ | Data flywheel / Switching cost |
| Real-Time IDE Extension | Q3 2026 | L | ⭐⭐ | Switching cost / Network effect |
| Multi-Repo Risk Intelligence Dashboard | Q3 2026 | M | ⭐⭐⭐ | Switching cost / Data flywheel |
| Bitbucket + Azure DevOps Integration | Q3 2026 | M | ⭐⭐⭐⭐ | Category creation / Switching cost |
| LLM Behavioral Fingerprint Database | Q4 2026 | L | ⭐⭐⭐⭐⭐ | Data flywheel |
| Property-Based Invariant Checker | Q4 2026 | L | ⭐⭐⭐⭐⭐ | Technical depth / Category creation |
| AI-on-AI Review Bias Detector | Q4 2026 | L | ⭐⭐⭐⭐⭐ | Technical depth / Category creation |
| Compliance Audit Pack | Q4 2026 | M | ⭐⭐⭐⭐ | Switching cost / Category creation |
| CodeSheriff AI Safety Benchmark | Q1 2027 | M | ⭐⭐⭐⭐⭐ | Network effect / Category creation |
| Self-Hosted / On-Prem Deployment | Q1 2027 | L | ⭐⭐⭐⭐⭐ | Switching cost / Category creation |
| LLM-Native SBOM | Q1 2027 | M | ⭐⭐⭐⭐⭐ | Category creation / Network effect |
| Continuous Behavioral Drift Monitor | Q1 2027 | M | ⭐⭐⭐⭐ | Data flywheel / Switching cost |

---

## Competitive Moat Summary

**What Cubic can copy in weeks (⭐⭐):** The Explanation Layer, IDE Extension (they already have one). These are table-stakes features, not moats — ship them to compete, not to differentiate.

**What Cubic can copy in 3–6 months (⭐⭐⭐):** Multi-Repo Dashboard, Auto-Fix, Commit Fingerprinting, IaC Scanner. Ship these to build retention while the real moat features are in development.

**What Cubic cannot copy in 12+ months (⭐⭐⭐⭐⭐):** The LLM Behavioral Fingerprint Database (requires months of production data accumulation), the Property-Based Invariant Checker (6–12 months of engineering depth), the AI-on-AI Review Bias Detector (requires both the data and the technical framework), the AI Safety Benchmark (requires the production dataset and academic partnerships), and Self-Hosting (Cubic's SaaS architecture makes this structurally expensive to add). These are the features that make CodeSheriff a category, not a product.

---

*Document prepared by: CodeSheriff Product — April 2026*
*Next review: July 2026 (Q3 kickoff)*
