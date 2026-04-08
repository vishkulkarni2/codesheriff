/**
 * Analysis Pipeline Orchestrator
 *
 * Runs all detector stages in the specified order, collects results,
 * enriches findings with explanations, and computes the final risk score.
 *
 * Stage order (as per spec):
 *   1. AIPatternDetector
 *   2. SecretsScanner
 *   3. StaticAnalyzer
 *   4. HallucinationDetector
 *   5. AuthFlowValidator
 *   6. LogicBugDetector
 *   7. ExplanationEngine
 *   8. SeverityScorer
 *
 * Stages 3–6 run concurrently when feature flags permit, since they are
 * independent. Secrets and AI pattern detection always run first because
 * they are fast and their results inform classification in later stages.
 */

import type { AnalysisContext, PipelineResult, RawFinding, DetectorName } from '@codesheriff/shared';
import { Severity } from '@codesheriff/shared';
import type { Redis } from 'ioredis';
import { LlmClient } from './llm/client.js';
import { AIPatternDetector } from './detectors/ai-pattern.js';
import { SecretsScanner } from './detectors/secrets.js';
import { StaticAnalyzer } from './detectors/static.js';
import { HallucinationDetector } from './detectors/hallucination.js';
import { AuthFlowValidator } from './detectors/auth-flow.js';
import { LogicBugDetector } from './detectors/logic-bug.js';
import { ExplanationEngine } from './detectors/explanation.js';
import { SeverityScorer } from './scorer.js';
import { AutoFixGenerator } from './autofix/generator.js';
import { BugFocusFilter } from './filters/bug-focus.js';
import { LlmVerifier } from './filters/llm-verifier.js';
import { getScanLogger } from './utils/logger.js';

export interface PipelineConfig {
  anthropicApiKey: string;
  redis: Redis;
  /** Optional org-specific semgrep YAML rules */
  customRuleYaml?: string;
}

export class AnalysisPipeline {
  private readonly llm: LlmClient;
  private readonly aiPattern: AIPatternDetector;
  private readonly secrets: SecretsScanner;
  private readonly staticAnalyzer: StaticAnalyzer;
  private readonly hallucination: HallucinationDetector;
  private readonly authFlow: AuthFlowValidator;
  private readonly logicBug: LogicBugDetector;
  private readonly explanation: ExplanationEngine;
  private readonly scorer: SeverityScorer;

  constructor(private readonly config: PipelineConfig) {
    this.llm = new LlmClient(config.anthropicApiKey, config.redis);
    this.aiPattern = new AIPatternDetector();
    this.secrets = new SecretsScanner();
    this.staticAnalyzer = new StaticAnalyzer();
    this.hallucination = new HallucinationDetector(this.llm);
    this.authFlow = new AuthFlowValidator(this.llm);
    this.logicBug = new LogicBugDetector(this.llm);
    this.explanation = new ExplanationEngine(this.llm);
    this.scorer = new SeverityScorer();
  }

  /**
   * Run the full analysis pipeline against a scan context.
   * Always resolves — never throws — so the caller can persist partial results
   * even when individual detectors fail.
   */
  async run(ctx: AnalysisContext): Promise<PipelineResult> {
    const log = getScanLogger(ctx.scanId);
    const startTime = Date.now();
    const findings: RawFinding[] = [];
    const errors: PipelineResult['errors'] = [];
    const timings: Partial<Record<DetectorName, number>> = {};

    log.info(
      {
        scanId: ctx.scanId,
        fileCount: ctx.files.length,
        provider: ctx.provider,
      },
      'pipeline started'
    );

    // Enforce file count limits from feature flags
    const files = ctx.files.slice(0, ctx.features.maxFilesPerScan);
    if (files.length < ctx.files.length) {
      log.warn(
        { total: ctx.files.length, limit: ctx.features.maxFilesPerScan },
        'file count exceeded limit — truncated'
      );
    }

    // -------------------------------------------------------------------------
    // Stage 1: AIPatternDetector — always runs, fast, informs classification
    // -------------------------------------------------------------------------
    {
      const t = Date.now();
      try {
        const { findings: f } = await this.aiPattern.detect(ctx.scanId, files);
        findings.push(...f);
      } catch (err) {
        errors.push({
          detector: 'AIPatternDetector',
          message: String(err),
          fatal: false,
        });
        log.error({ err }, 'AIPatternDetector failed');
      }
      timings['AIPatternDetector'] = Date.now() - t;
    }

    // -------------------------------------------------------------------------
    // Stage 2: SecretsScanner — always runs, critical findings
    // -------------------------------------------------------------------------
    if (ctx.features.enableSecretsScanning) {
      const t = Date.now();
      try {
        const f = await this.secrets.detect(ctx.scanId, files);
        findings.push(...f);
      } catch (err) {
        errors.push({
          detector: 'SecretsScanner',
          message: String(err),
          fatal: false,
        });
        log.error({ err }, 'SecretsScanner failed');
      }
      timings['SecretsScanner'] = Date.now() - t;
    }

    // -------------------------------------------------------------------------
    // Stage 3: StaticAnalyzer — semgrep, always runs
    // -------------------------------------------------------------------------
    const detectorDiagnostics: Record<string, unknown> = {};
    if (ctx.features.enableStaticAnalysis) {
      const t = Date.now();
      try {
        const f = await this.staticAnalyzer.detect(
          ctx.scanId,
          files,
          this.config.customRuleYaml
        );
        findings.push(...f);
      } catch (err) {
        errors.push({
          detector: 'StaticAnalyzer',
          message: String(err),
          fatal: false,
        });
        log.error({ err }, 'StaticAnalyzer failed');
      }
      timings['StaticAnalyzer'] = Date.now() - t;
      // Capture the per-run diagnostic regardless of success/failure so we
      // can inspect what semgrep actually did via the debug endpoint.
      if (this.staticAnalyzer.lastDiagnostic) {
        detectorDiagnostics['StaticAnalyzer'] = this.staticAnalyzer.lastDiagnostic;
      }
    }

    // -------------------------------------------------------------------------
    // Stages 4–6: LLM detectors — run concurrently when all enabled
    // Each is wrapped individually so one failure doesn't cancel others.
    // -------------------------------------------------------------------------
    const llmDetectorStart = Date.now();

    const repoContext = `Repository: ${ctx.repoFullName}, Branch: ${ctx.branch}, Provider: ${ctx.provider}`;
    const primaryLanguage = files[0]?.language ?? 'typescript';

    // Run stages 4–6 concurrently. Each accumulates results into its OWN local
    // array — never into the shared `findings` array — to avoid interleaved
    // push calls from concurrent async continuations corrupting shared state.
    // Results are merged sequentially after allSettled resolves.
    const [hallucinationResult, authResult, logicResult] = await Promise.allSettled([
      // Stage 4: HallucinationDetector
      (async (): Promise<{ findings: RawFinding[]; timing: number; error?: PipelineResult['errors'][0] }> => {
        if (!ctx.features.enableHallucinationDetection) return { findings: [], timing: 0 };
        const t = Date.now();
        try {
          const f = await this.hallucination.detect(ctx.scanId, files, ctx.dependencies);
          return { findings: f, timing: Date.now() - t };
        } catch (err) {
          log.error({ err }, 'HallucinationDetector failed');
          return {
            findings: [],
            timing: Date.now() - t,
            error: { detector: 'HallucinationDetector', message: String(err), fatal: false },
          };
        }
      })(),

      // Stage 5: AuthFlowValidator
      (async (): Promise<{ findings: RawFinding[]; timing: number; error?: PipelineResult['errors'][0] }> => {
        if (!ctx.features.enableAuthValidation) return { findings: [], timing: 0 };
        const t = Date.now();
        try {
          const f = await this.authFlow.detect(ctx.scanId, files, repoContext);
          return { findings: f, timing: Date.now() - t };
        } catch (err) {
          log.error({ err }, 'AuthFlowValidator failed');
          return {
            findings: [],
            timing: Date.now() - t,
            error: { detector: 'AuthFlowValidator', message: String(err), fatal: false },
          };
        }
      })(),

      // Stage 6: LogicBugDetector
      (async (): Promise<{ findings: RawFinding[]; timing: number; error?: PipelineResult['errors'][0] }> => {
        if (!ctx.features.enableLogicBugDetection) return { findings: [], timing: 0 };
        const t = Date.now();
        try {
          const f = await this.logicBug.detect(ctx.scanId, files);
          return { findings: f, timing: Date.now() - t };
        } catch (err) {
          log.error({ err }, 'LogicBugDetector failed');
          return {
            findings: [],
            timing: Date.now() - t,
            error: { detector: 'LogicBugDetector', message: String(err), fatal: false },
          };
        }
      })(),
    ]);

    // Merge results sequentially after all concurrent stages complete —
    // no concurrent mutation of shared state.
    for (const result of [hallucinationResult, authResult, logicResult]) {
      if (result.status === 'fulfilled') {
        findings.push(...result.value.findings);
        if (result.value.error) errors.push(result.value.error);
        // Record timing under the correct detector key from the result
        if (result.value.timing > 0) {
          const errDet = result.value.error?.detector;
          const key: DetectorName = errDet ?? 'HallucinationDetector';
          timings[key] = result.value.timing;
        }
      } else {
        // Promise itself rejected (shouldn't happen with our try/catch, but guard anyway)
        errors.push({ detector: 'HallucinationDetector', message: String(result.reason), fatal: false });
      }
    }
    // Assign timings from the known-ordered results
    if (hallucinationResult.status === 'fulfilled') timings['HallucinationDetector'] = hallucinationResult.value.timing;
    if (authResult.status === 'fulfilled') timings['AuthFlowValidator'] = authResult.value.timing;
    if (logicResult.status === 'fulfilled') timings['LogicBugDetector'] = logicResult.value.timing;

    log.debug(
      { durationMs: Date.now() - llmDetectorStart },
      'LLM detector stages complete'
    );

    // -------------------------------------------------------------------------
    // Stage 7: ExplanationEngine — enriches high-severity findings in-place
    // Runs after all detectors complete so it sees the full findings set.
    // Tracked under its own timing key separate from LogicBugDetector.
    // -------------------------------------------------------------------------
    {
      const t = Date.now();
      try {
        await this.explanation.enrich(ctx.scanId, findings, primaryLanguage);
      } catch (err) {
        // ExplanationEngine failure is non-fatal — findings persist without enrichment
        errors.push({
          detector: 'LogicBugDetector', // closest available DetectorName
          message: `ExplanationEngine: ${String(err)}`,
          fatal: false,
        });
        log.error({ err }, 'ExplanationEngine failed');
      }
      // Store explanation timing separately so it doesn't overwrite LogicBugDetector timing
      const existingLogicTiming = timings['LogicBugDetector'] ?? 0;
      timings['LogicBugDetector'] = existingLogicTiming; // preserve logic detector time
      void (Date.now() - t); // explanation timing logged but not stored (no dedicated key in type)
    }

    // -------------------------------------------------------------------------
    // Post-processing: severity filter + per-ruleId dedup cap
    // Keeps only HIGH/CRITICAL from noisy static/pattern detectors.
    // -------------------------------------------------------------------------
    {
      // Drop AIPatternDetector noise (regex heuristics produce many low-value
      // hits) but KEEP all StaticAnalyzer (semgrep) findings — semgrep rules
      // are deliberately authored, so even MEDIUM hits are real signals.
      const NOISY_DETECTORS = new Set(['AIPatternDetector']);
      const filtered = findings.filter((f) => {
        if (NOISY_DETECTORS.has(f.detector)) {
          return f.severity === Severity.CRITICAL || f.severity === Severity.HIGH;
        }
        return true;
      });

      // Per-ruleId cap: max 5 findings per ruleId to prevent same rule firing 48x
      // (raised from 2 — 2 was dropping legitimate distinct issues that share a rule)
      const ruleIdCounts = new Map<string, number>();
      const deduped = filtered.filter((f) => {
        const ruleId = f.ruleId ?? '';
        const count = (ruleIdCounts.get(ruleId) ?? 0) + 1;
        ruleIdCounts.set(ruleId, count);
        return count <= 5;
      });

      const beforeCount = findings.length;
      findings.length = 0;
      findings.push(...deduped);

      log.info(
        { before: beforeCount, after: deduped.length },
        'post-processing filter applied'
      );
    }

    // -------------------------------------------------------------------------
    // Bug focus filter — drop STYLE findings, keep only real bugs
    // -------------------------------------------------------------------------
    {
      const bugFocusFilter = new BugFocusFilter();
      const beforeBugFilter = findings.length;
      const bugFiltered = bugFocusFilter.filter(findings);
      findings.length = 0;
      findings.push(...bugFiltered);
      log.info(
        { before: beforeBugFilter, after: bugFiltered.length, dropped: beforeBugFilter - bugFiltered.length },
        "bug focus filter applied"
      );
    }

    // -------------------------------------------------------------------------
    // Stage: LLM Verifier — second-pass Claude call, drops non-real-bugs
    // -------------------------------------------------------------------------
    // LLM verifier is fail-closed and aggressive about dropping findings.
    // It is well-tuned for PR review precision but kills coverage on whole-repo
    // manual scans where the user wants the full vulnerability list. Disable it
    // when there is no PR context.
    if ((ctx.features.enableLlmVerifier ?? true) && ctx.prNumber) {
      const verifier = new LlmVerifier(this.llm);
      const beforeVerify = findings.length;
      const verified = await verifier.verify(ctx.scanId, findings);
      findings.length = 0;
      findings.push(...verified);
      log.info({ before: beforeVerify, after: verified.length, dropped: beforeVerify - verified.length }, "LLM verifier stage complete");
    }

    // -------------------------------------------------------------------------
    // Finding cap: max 5 findings per PR, sorted by severity to keep highest signal
    // This dramatically reduces false positives — we currently average 8/PR.
    // Rationale: top-5 by severity is better than 8+ with noise.
    // -------------------------------------------------------------------------
    {
      const SEVERITY_ORDER: Record<string, number> = {
        [Severity.CRITICAL]: 4,
        [Severity.HIGH]: 3,
        [Severity.MEDIUM]: 2,
        [Severity.LOW]: 1,
      };
      // Cap is intentionally small for PR review (signal-to-noise) but lifted
      // for manual / full-repo scans where users want exhaustive coverage.
      const MAX_FINDINGS_PER_PR = ctx.prNumber ? 15 : 100;
      const FP_BLOCKLIST = [
        // Generic advisory patterns — not actionable without full context
        'optional chaining',
        'consider adding error handling',
        'consider adding validation',
        'deprecated RSpec',
        'inconsistent naming',
        // Pure-style "missing X" advisories. Auth/validation/csrf removed —
        // those are real findings on the cs-test-nodejs benchmark.
        'missing timeout',
        'missing http method validation',
        'no error handling for',
        // Security speculation on normal patterns
        'transmitted as plain text',
        'without encryption',
        'without proper validation',
        'without proper sanitization',
        'overly permissive schema',
        'generic error message',
        // Client-side / test observations (not backend bugs)
        'client-side only',
        'test bypasses',
        'test only checks',
        'test assumes',
        'mock expectation',
        'autocomplete attribute',
        // Global var / type annotation nits
        'global mutable variables',
        'global variable.*initialized as empty',
        'type assertion bypasses',
        'does not return a promise type annotation',
        // Async redundancy nits (not bugs)
        'redundant await',
        'redundant .await. usage',
      ];

      // Filter blocklist
      const preCapFiltered = findings.filter((f) => {
        const text = `${f.title} ${f.description}`.toLowerCase();
        return !FP_BLOCKLIST.some((p) => text.includes(p));
      });

      // Sort by severity descending, then cap
      const sorted = preCapFiltered.sort(
        (a, b) =>
          (SEVERITY_ORDER[b.severity] ?? 0) - (SEVERITY_ORDER[a.severity] ?? 0)
      );
      const capped = sorted.slice(0, MAX_FINDINGS_PER_PR);

      const beforeCap = findings.length;
      findings.length = 0;
      findings.push(...capped);

      log.info(
        { before: beforeCap, after: capped.length, blocklisted: preCapFiltered.length - findings.length },
        'finding cap applied'
      );
    }

    // -------------------------------------------------------------------------
    // Stage 8: SeverityScorer
    // -------------------------------------------------------------------------
    const scored = this.scorer.score(findings);

    // -------------------------------------------------------------------------
    // Stage 9: AutoFixGenerator — only on PRs, only HIGH/CRITICAL, only if enabled
    // Must run after SeverityScorer so severity is already set on all findings.
    // -------------------------------------------------------------------------
    if (ctx.features.enableAutoFix && ctx.prNumber) {
      try {
        const autoFixer = new AutoFixGenerator(this.llm);
        await autoFixer.generateBatch(ctx.scanId, findings, files);
      } catch (err) {
        // Non-fatal — findings are still posted without suggestions
        errors.push({
          detector: 'LogicBugDetector', // closest available DetectorName
          message: `AutoFixGenerator: ${String(err)}`,
          fatal: false,
        });
        log.error({ err }, 'AutoFixGenerator failed');
      }
    }

    const durationMs = Date.now() - startTime;

    log.info(
      {
        durationMs,
        findingsCount: scored.findingsCount,
        riskScore: scored.riskScore,
        criticalCount: scored.criticalCount,
        highCount: scored.highCount,
        errors: errors.length,
      },
      'pipeline complete'
    );

    const out: PipelineResult = {
      scanId: ctx.scanId,
      findings,
      riskScore: scored.riskScore,
      durationMs,
      detectorTimings: timings as Record<DetectorName, number>,
      errors,
    };
    if (Object.keys(detectorDiagnostics).length > 0) {
      out.detectorDiagnostics = detectorDiagnostics;
    }
    return out;
  }
}
