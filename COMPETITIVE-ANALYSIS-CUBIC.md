# Competitive Analysis: Cubic vs CodeSheriff
**Prepared:** 2026-04-03 | **Author:** Rache | **Classification:** Internal / Confidential

---

## Executive Summary

Cubic (cubic.dev) is a YC X25-backed AI code review platform founded in early 2025 by Allis Yao and Paul Sanglé-Ferrière, based in London. They are currently the **#1 ranked AI code reviewer on Martian's independent Code Review Bench** with a 61.8% F1 score — 16+ points above the next well-known competitor. Their customers include n8n, Cal.com, Resend, Granola, Better Auth, and the Linux Foundation. They are well-funded (YC), gaining real enterprise traction, and have polished UX.

They are a serious threat. Not because they beat us at everything — they don't — but because they have **benchmark credibility, enterprise logos, and a clear narrative** that CodeSheriff doesn't yet have publicly. The good news: our differentiation lane is genuinely distinct. We have to execute on it.

---

## 1. Cubic — Company Profile

| Attribute | Details |
|---|---|
| **Company** | cubic (lowercase branding) |
| **Website** | cubic.dev |
| **Founded** | Early 2025 |
| **Founders** | Allis Yao (co-founder) + Paul Sanglé-Ferrière (co-founder/CEO) |
| **Team** | 3 employees (as of YC listing), growing |
| **Location** | London, UK |
| **Funding** | YC X25 (Spring 2025 batch) |
| **Stage** | Seed / early post-YC |
| **Paul's background** | Stanford, ex-Tessian (email security ML), ex-Yelp, ex-Workflow, ex-MailWiz |
| **YC description** | "Cursor for code review" |
| **Customers** | cal.com, n8n, Resend, Granola, Better Auth, Linux Foundation, Cartography, Legora, Browser Use |
| **Key metric** | "Ships code 28% faster" (cited as platform headline) |
| **Benchmark** | #1 on Martian Code Review Bench — 61.8% F1 (Mar 2026) |

---

## 2. Cubic — Product Deep Dive

### Core Architecture
Cubic runs a code review agent that navigates the full codebase using developer tools (jump-to-definition, grep, etc.) — not just the diff. This gives it cross-file context that simpler tools miss. Reviews run in short-lived isolated sandboxes; code is never stored.

### Feature Set (Confirmed from Docs + Website)

| Feature | Description |
|---|---|
| **AI PR Review** | Automated review on every new PR. Posts inline comments on GitHub. Auto-triggers on PR open, reviews only incremental diffs on subsequent pushes. |
| **Full codebase context** | Not just diff analysis — agent navigates entire repo using dev tools to understand cross-file dependencies and architecture patterns. |
| **Model routing** | Uses multiple LLMs, routes different review subtasks to the best model for each. Not locked to a single provider. |
| **Background agents (auto-fix)** | When a bug is flagged, user can click "Fix with cubic" or tag `@cubic` to auto-apply a fix. Fix is pushed as a commit or opened as a separate PR. Uses Claude Code in a sandboxed environment. |
| **Memory & adaptive learning** | Learns from thumbs up/down, comment replies, and correction threads. Team-scoped: your feedback trains your instance only. |
| **Senior reviewer learning** | On onboarding, select your best engineers. Cubic analyzes their historical review comments and extracts their unwritten rules as team-specific learnings. |
| **Custom agents** | Natural language or regex rules that enforce team-specific standards. Applied per-repo or across multiple repos. Up to 5 active per repo. Community library of shared agents. |
| **Cursor rules import** | Import Cursor `.cursorrules` directly into Cubic as custom agents. |
| **IDE integration** | Works with Cursor, Claude Code, VS Code, Codex CLI, Gemini CLI, any coding agent. |
| **Local CLI review** | `curl -fsSL https://cubic.dev/install | bash && cubic review` — pre-push review before opening PR. |
| **PR summaries** | Auto-generates PR descriptions: what changed, why, potential impact. |
| **AI wiki** | Automatically generates searchable codebase documentation. Indexed, queryable in plain English. |
| **Devin bot support** | Detects PRs from `devin-ai-integration[bot]` automatically. Separate bot seat pricing. |
| **Incremental reviews** | Only reviews new changes on subsequent pushes. No repeated noise on already-reviewed code. |
| **Up-to-date library knowledge** | Access to current library docs — not stale training data. |
| **SOC 2 Type I** | Certified. |
| **No code storage** | Code deleted from sandbox immediately after review. |
| **Stacked PR management** | Platform manages stacked PRs (like Linear for PRs). |
| **Analytics** | PR analytics dashboard. Bug rate tracking before/after code review changes. |

### What They Don't Do
- ❌ No GitLab support (explicitly stated in FAQ: "Not yet")
- ❌ No Bitbucket support
- ❌ No self-hosting option
- ❌ No secrets scanning (TruffleHog-style)
- ❌ No AI-hallucination-specific detection (hallucinated APIs, phantom imports)
- ❌ No dedicated auth flow validation
- ❌ No Slack notifications (not mentioned in docs)
- ❌ No SARIF export
- ❌ No self-evolving rule engine (their "learning" is feedback-driven, not autonomous)
- ❌ No push-event scanning (only PR review, not push analysis)
- ❌ No per-file risk scoring / risk history / trend charts

---

## 3. Pricing

| Plan | Price | Details |
|---|---|---|
| **Free** | $0 | 20 AI reviews/month, full platform access (analytics, PR management, custom agents, background agents all included) |
| **Paid** | $30/seat/month | Unlimited AI reviews. Seat-based. Only pay for active seats. |
| **Annual** | $24/seat/month | 20% discount off monthly |
| **Open source** | Free | Unlimited reviews for all public repos |
| **Nonprofit/Education** | 50% discount | On request |
| **Free trial** | 14 days | Full access, no credit card |
| **Enterprise** | Custom | Contact sales |

**CodeSheriff comparison:**
- Free: 1 repo, 20 files/scan, static + secrets only
- Team: $29/month flat (not per-seat!) — all AI detectors
- Beta: EARLYSHERIFF promo (3 months free)

**Key gap:** Cubic's free tier is more generous (20 reviews across all repos vs our 1 repo limit). Their paid tier is per-seat ($30) vs our flat fee ($29). For small teams (1-2 devs), we're cheaper. For teams of 5+, we're dramatically cheaper (flat $29 vs $150+). **This is a major pricing advantage we're not communicating.**

---

## 4. Positioning & Messaging

**Cubic's positioning:**
- "Cursor for code review" — developer-first analogy
- "#1 on Martian benchmark" — credibility anchor
- "28% faster code shipping" — concrete outcome
- "Catches hard-to-find bugs in complex codebases" — enterprise quality angle
- Design-forward: Linear/Superhuman aesthetic inspiration
- Enterprise credibility: SOC 2, zero code storage, big name customers

**Target audience:** Engineering teams (5–500 devs) who are already AI-native (Cursor, Claude Code users) and experiencing review bottlenecks as PR volume increases with AI code gen.

**What makes their narrative sharp:** They've correctly identified the core pain — *more code gen = more PRs = review becomes the bottleneck* — and positioned themselves as the fix. Clean, simple, believable.

---

## 5. Feature-by-Feature Comparison

| Feature | Cubic | CodeSheriff | Edge |
|---|---|---|---|
| **AI PR review** | ✅ Full codebase context | ✅ 8-stage analysis pipeline | Cubic (cross-file nav) |
| **Hallucination detection** | ❌ Not featured | ✅ Claude-powered HallucinationDetector | **CodeSheriff** |
| **Auth flow validation** | ❌ Not featured | ✅ AuthDetector | **CodeSheriff** |
| **AI-specific bug patterns** | ❌ Generic LLM review | ✅ AIPatternDetector (6 rules + 7 semgrep YAML) | **CodeSheriff** |
| **Secrets scanning** | ❌ Not listed | ✅ TruffleHog integration | **CodeSheriff** |
| **Static analysis (semgrep)** | ❌ Not listed | ✅ Custom AI-specific rules | **CodeSheriff** |
| **Logic error detection** | ✅ Via LLM review | ✅ LogicDetector | Tie |
| **Self-improving rules** | ✅ Feedback-driven (thumbs/comments) | ✅ Autotune (autonomous evolution loop) | **CodeSheriff** (more automated) |
| **Learns from senior devs** | ✅ Extracts patterns from historical reviews | ❌ Not built | Cubic |
| **Custom rules** | ✅ Natural language + regex, community library | ✅ Custom rules editor (UI may be read-only) | Cubic (more polished) |
| **Background auto-fix** | ✅ Clicks "Fix with cubic" → auto-commit | ❌ Not built | Cubic |
| **CLI local review** | ✅ `cubic review` pre-push | ❌ Not built | Cubic |
| **IDE integration** | ✅ Cursor, Claude Code, VS Code, Codex, Gemini | ❌ Not built | Cubic |
| **PR summaries** | ✅ Auto-generated | ❌ Not built | Cubic |
| **AI wiki / codebase docs** | ✅ Built | ❌ Not built | Cubic |
| **Desktop app** | ✅ Linear-inspired PR management | ❌ Web only | Cubic |
| **Stacked PR management** | ✅ Visual grouping, logical diff display | ❌ Not built | Cubic |
| **GitHub** | ✅ Full support | ✅ Full support | Tie |
| **GitLab** | ❌ "Not yet" | ✅ MR + push support built | **CodeSheriff** |
| **Bitbucket** | ❌ | ❌ (stub) | Tie (neither) |
| **Push-event scanning** | ❌ PR-only | ✅ Push events too | **CodeSheriff** |
| **Risk scoring** | ❌ | ✅ Severity scoring per finding | **CodeSheriff** |
| **Risk history / trends** | ❌ | ✅ Daily snapshots, trend charts | **CodeSheriff** |
| **Email digest** | ❌ | ✅ Weekly digest via Resend | **CodeSheriff** |
| **Slack notifications** | ❌ Not listed | ✅ Post-scan webhook | **CodeSheriff** |
| **SARIF export** | ❌ | ✅ (mentioned in roadmap) | **CodeSheriff** |
| **Benchmark ranking** | ✅ #1 on Martian (61.8% F1) | ❌ Not on benchmark | Cubic |
| **SOC 2** | ✅ Type I | ❌ Not yet | Cubic |
| **Self-hosting** | ❌ | ❌ (not in v1) | Tie |
| **Open source** | ✅ Free for public repos | ✅ Free tier (1 repo) | Tie |
| **Pricing** | $30/seat/month | $29/month flat | **CodeSheriff** (teams 3+) |
| **Free tier** | 20 reviews/month, all repos | 1 repo, limited scans | Cubic (more generous) |
| **14-day trial** | ✅ No credit card | ✅ "14-day trial" (should match) | Tie |
| **Onboarding** | 2-click GitHub App install | Multi-step wizard | Cubic (simpler) |
| **Enterprise** | ✅ SOC 2, contact sales | ❌ Not launched | Cubic |
| **Customer logos** | n8n, Cal.com, Resend, Linux Foundation | None yet (pre-launch) | Cubic |

---

## 6. What Cubic Does That We DON'T — The Gaps

These are features Cubic ships today that CodeSheriff needs to close.

### Critical Gaps (block enterprise sales)
1. **#1 benchmark ranking** — Cubic has independent third-party proof of quality (Martian Code Review Bench, 61.8% F1). We have no benchmark presence. This is the single biggest credibility gap in enterprise conversations.
2. **SOC 2 compliance** — Required for any enterprise customer. Cubic has Type I. We don't have anything.
3. **Background auto-fix** — Cubic can detect a bug and apply a fix commit automatically. We only flag bugs.
4. **Enterprise customer logos** — Cal.com, n8n, Resend, Linux Foundation vs. zero. Not a product gap but a business gap that compounds every week.

### High-Impact Product Gaps
5. **Senior reviewer learning** — Analyzing historical review comments from your best engineers to extract and codify their unwritten rules. This is genuinely smart onboarding differentiation.
6. **Local CLI review** — `cubic review` before pushing. Pre-PR, pre-commit safety net. Devs love this workflow.
7. **IDE integration** — Cubic surfaces findings inside Cursor, Claude Code, VS Code, etc. We're GitHub-web-only.
8. **PR summaries** — Auto-generated PR descriptions. Low complexity, high-value for devs.
9. **Custom agents community library** — Shared rule templates other teams have published. Network effect moat.
10. **Cursor rules import** — Import your team's existing `.cursorrules` as review agents. Clever adoption hook.

### Nice-to-Have Gaps
11. **AI wiki** — Auto-generated codebase documentation. High WOW factor for onboarding demos.
12. **Stacked PR management** — Visual, Linear-style PR grouping. UX moat.
13. **Devin bot seat support** — As agentic coding bots proliferate, this becomes table stakes.
14. **Free for public repos** — We cap free at 1 repo. Cubic gives unlimited for public repos. OSS maintainers choose Cubic.

---

## 7. What We Do That Cubic DOESN'T — Our Advantages

These are real, defensible differentiators. We need to lead with them.

### Core Differentiation (Narrative-Level)
1. **AI-hallucination detection** — We specifically detect hallucinated APIs, phantom imports, and non-existent library methods introduced by AI coding assistants. This is a unique problem that's getting *worse* as AI code gen proliferates. Cubic doesn't have this. Nobody else has this.
2. **AI-specific attack surface** — Our entire 8-stage pipeline was designed around the new class of bugs AI coding assistants introduce. Cubic is a general-purpose code reviewer. We're the specialist.
3. **Auth flow validation** — We detect broken auth patterns that AI tools often introduce (improper session handling, missing middleware, etc.). High-severity, enterprise-relevant.
4. **Secrets scanning (TruffleHog)** — We run secrets detection on every push/PR. Cubic doesn't.

### Technical Differentiators
5. **Autotune evolution loop** — Our rule improvement is *autonomous*: we run experiments, score outcomes, and evolve prompts and semgrep rules automatically. Cubic's "learning" is reactive (thumbs up/down). We're proactive. Better data flywheel story.
6. **Semgrep with custom AI-specific YAML rules** — 7 hand-crafted rules targeting patterns AI code gen tools specifically produce. Not a generic LLM pass.
7. **GitLab support** — Cubic is GitHub-only. We support GitHub + GitLab (MR + push events). Enterprise shops running GitLab cannot use Cubic.
8. **Risk history + trend charts** — We show how your codebase's security posture changes over time. Cubic is PR-centric; we're codebase-health centric.
9. **Push-event scanning** — We scan pushes too, not just PRs. Catches issues before a PR is even opened.
10. **Flat-rate pricing at scale** — $29/month for a team of 10 vs Cubic's $300/month. 10x cheaper. This is a go-to-market weapon, not just a price difference.

### Positioning Opportunity
11. **"Built for the AI coding era" narrative** — Cubic is a better version of existing code review tools. We can credibly claim to be something categorically new: the safety layer for AI-generated code. That's a distinct category.

---

## 8. Competitive Strategy — How to Win

### The One-Line Strategy
**Don't compete with Cubic on general code review. Own the category of "AI code safety" — the security and quality layer specifically built for teams shipping AI-generated code.**

Cubic is "better code review." We are "code review for the era of AI code generation." These are different products serving overlapping but distinct needs. Cubic will win the general code review market (they're well-positioned for it). We can win the *security-and-quality-of-AI-generated-code* market, which is growing faster.

---

### Immediate Actions (Pre-Launch, April 2026)

#### 1. Get on Martian's Code Review Bench
This is the highest-leverage single move. Cubic leads with "We're #1 on the independent benchmark." We need to be on that leaderboard. Submit to [codereview.withmartian.com](https://codereview.withmartian.com). Even ranking #5 gives us credibility. If we rank above CodeRabbit (#17), we can claim "beats CodeRabbit" in our messaging.

**Action:** Submit to the benchmark as soon as we're deployed and stable. Vish does this Week 2.

#### 2. Lead with Hallucination Detection in All Messaging
Every piece of copy should feature the hallucination detector prominently. "The scanner that catches what Cursor and Claude Code leave behind." This is our wedge — it's real, it's unique, it's getting worse as the industry adopts AI code gen tools.

**Action:** Rewrite landing page hero, blog posts, Twitter bio, Show HN post around this frame.

#### 3. Exploit the GitLab Gap Hard
Cubic explicitly says "We only support GitHub." We support GitHub AND GitLab. Any enterprise running GitLab cannot use Cubic. Create a landing page `codesheriff.dev/gitlab` targeting GitLab shops. Run ads or outreach to GitLab communities.

**Action:** Add a GitLab-specific landing page. Target "CodeRabbit GitLab alternative," "AI code review GitLab" search terms.

#### 4. Make the Pricing Story Explicit
Cubic is $30/seat/month. We're $29/month flat. For a team of 5, we're 5x cheaper. For a team of 10, we're 10x cheaper. We're not communicating this at all. The pricing page should have a comparison calculator.

**Action:** Add a "Compare to Cubic" (or just "See how we compare") pricing widget. Show "10 devs × $30 = $300/mo vs CodeSheriff $29/mo."

#### 5. Autotune is a Moat — Tell the Story
Cubic's learning is reactive (user feedback). Ours is autonomous (evolution loop). This is a genuinely better data flywheel story. Write a technical blog post: "How CodeSheriff's rules get smarter without you doing anything." This is a credibility builder for CTO/architect buyers.

**Action:** Write the autotune explainer blog post in Week 3 as planned.

---

### Short-Term Builds (Next 60 Days)

#### Priority 1: Local CLI Review
Cubic has `cubic review`. We need `codesheriff review`. Devs want to run a scan before pushing. This is a low-effort, high-visibility feature that's already partially addressable via our worker. Build a CLI wrapper that calls our API for local scans. Ship it Week 5-6.

#### Priority 2: PR Auto-Fix Suggestions
We don't need to auto-push commits like Cubic. But we should generate "copy-paste fix prompts" — structured prompts users can paste into their coding agent (Cursor, Claude Code) to fix the identified issue. Cubic does full auto-fix; we can ship "fix prompt generation" in days and communicate it as AI-agent-ready output.

#### Priority 3: IDE MCP Integration
Expose CodeSheriff findings as an MCP server. This lets Cursor, Claude Code, and any MCP-compatible tool pull our scan results directly into the IDE. Cubic has built native IDE integrations; we can ship MCP and get to the same outcome faster, with broader compatibility.

#### Priority 4: SOC 2 Initiation
Enterprise customers ask for SOC 2. Cubic has it. Start the process with Vanta ($3K/year). This takes 3-6 months so start now even if we don't need it for beta.

---

### Medium-Term Builds (60–180 Days)

#### Community Agents Library
Cubic's shared rules library is a network effect play. We need our own. Start with 20 curated rule templates targeting AI coding patterns (Next.js auth patterns, async error handling, React hook rules, etc.) and make it discoverable.

#### Historical Review Learning
Cubic's "senior reviewer" feature is clever. We should build the equivalent: analyze your GitHub PR comment history to extract the patterns your best engineers consistently enforce, then seed our autotune corpus with those patterns. This turns onboarding into instant value.

#### PR Summaries
Low-effort, high perceived value. Cubic does it. So does CodeRabbit. It should take 1-2 days to build. Makes the product feel more complete even if it's not our core differentiator.

#### Public Benchmark Presence
Beyond just submitting — blog about our scores, benchmark comparisons, methodology. Establish CodeSheriff as the expert voice on AI code quality measurement.

---

### Messaging Pivots

| Current Message | Replace With |
|---|---|
| "Security scanner for AI-written code" | "The safety layer for AI-generated code" |
| Feature-list positioning | Hallucination detection as the hero, everything else as supporting |
| Generic "learns from feedback" | "Rules that evolve automatically — no manual tuning" |
| Competing with Snyk/Semgrep | "The thing Snyk and Semgrep aren't built for" |
| Pricing is $29/month | "$29/month flat — not $30 per developer" (always anchor to Cubic's pricing) |

---

## 9. Risk Assessment

### What Cubic Could Do to Threaten Us
1. **Build AI hallucination detection** — They have the engineering capability. If they ship this, our primary differentiator is gone. Timeline: 4-6 weeks if they prioritize it.
2. **Add GitLab support** — They've already said "not yet." They could ship it. Our GitLab moat has a shelf life of maybe 6 months.
3. **Acquire a secrets scanner** — Trivial to add TruffleHog/Gitleaks. Could be a weekend project.
4. **Flat-rate pricing tier** — If Cubic introduces a team flat-rate, our pricing advantage disappears.
5. **Raise a Series A** — YC companies raise fast. If they raise $5M+, they can outmarket us significantly.

### Our Durable Advantages (Harder to Copy)
- **Autotune evolution loop** — This is a research-grade system. Hard to replicate in weeks.
- **8-stage AI pipeline specifically tuned for AI code gen bugs** — Not a feature flag; it's architecture. Accumulated knowledge baked into semgrep rules.
- **First-mover in AI hallucination detection category** — If we establish the category and the narrative, copying the feature doesn't take the category.
- **Flat-rate pricing at scale** — Structural, not a feature. Takes a business decision to match.

---

## 10. Summary Table

| Dimension | Cubic Wins | CodeSheriff Wins | Too Close to Call |
|---|---|---|---|
| **Benchmark credibility** | ✅ #1 on Martian | | |
| **Enterprise logos** | ✅ Cal.com, n8n, etc. | | |
| **SOC 2** | ✅ Type I | | |
| **General code review quality** | ✅ Probably | | |
| **Auto-fix** | ✅ Full fix commits | | |
| **IDE integration** | ✅ Native | | |
| **CLI review** | ✅ `cubic review` | | |
| **UX / design polish** | ✅ Linear-inspired | | |
| **PR summaries** | ✅ | | |
| **AI wiki** | ✅ | | |
| **Community agents library** | ✅ | | |
| **Hallucination detection** | | ✅ Only we have this | |
| **AI-specific attack patterns** | | ✅ Built-in pipeline | |
| **Auth flow validation** | | ✅ AuthDetector | |
| **Secrets scanning** | | ✅ TruffleHog | |
| **GitLab support** | | ✅ Explicit gap in Cubic | |
| **Push-event scanning** | | ✅ We do it | |
| **Autotune (autonomous)** | | ✅ More advanced | |
| **Risk history + trends** | | ✅ We have it | |
| **Pricing (teams of 5+)** | | ✅ 5-10x cheaper | |
| **Self-hosting** | | | Both ❌ |
| **Bitbucket** | | | Both ❌ |

---

## 11. Intelligence to Continue Tracking

- Cubic's GitLab timeline — watch their changelog at `docs.cubic.dev/changelog`
- Their Series A raise (monitor Crunchbase + YC company page)
- Whether they add secrets scanning or hallucination detection
- Their pricing changes — any move toward flat-rate team plans
- Martian benchmark updates — our relative position as we grow
- Customer wins — who they're pitching in enterprise (follow their blog/testimonials)

---

*Sources: cubic.dev, docs.cubic.dev (key-features, memory-and-learning, custom-agents, subscription, introduction), ycombinator.com/companies/cubic, Martian Code Review Bench (codereview.withmartian.com), Sifted.eu YC X25 coverage, CodeSheriff LAUNCH-PLAN.md*

*Last researched: April 3, 2026*
