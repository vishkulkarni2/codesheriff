/**
 * Types for the analysis pipeline — inputs, intermediate results,
 * and outputs from each detector stage.
 */

import type { Severity, FindingCategory } from './enums.js';

// ---------------------------------------------------------------------------
// Pipeline input / context
// ---------------------------------------------------------------------------

export interface AnalysisFile {
  path: string;
  content: string;
  language: string;
  /** Line count of the file */
  lineCount: number;
  /** Whether the file was added/modified (vs. deleted) */
  status: 'added' | 'modified' | 'deleted';
  /** Diff patch string from the VCS */
  patch?: string | null;
  /** Number of added lines (from diff stats) */
  additions?: number;
  /** Number of deleted lines (from diff stats) */
  deletions?: number;
}

export interface AnalysisContext {
  /** Unique scan job ID */
  scanId: string;
  repositoryId?: string;
  /** org/repo */
  repoFullName: string;
  provider: 'github' | 'gitlab' | 'bitbucket';
  branch: string;
  commitSha: string;
  prNumber?: number | null;
  files: AnalysisFile[];
  /** package.json / requirements.txt / go.mod parsed deps */
  dependencies: Record<string, string>;
  /** Organization feature flags */
  features: AnalysisFeatureFlags;
}

export interface AnalysisFeatureFlags {
  enableHallucinationDetection: boolean;
  enableAuthValidation: boolean;
  enableLogicBugDetection: boolean;
  enableSecretsScanning: boolean;
  enableStaticAnalysis: boolean;
  enableAutoFix?: boolean;
  /** Enable second-pass LLM verifier that drops non-real-bug findings (default: true) */
  enableLlmVerifier?: boolean;
  maxFilesPerScan: number;
  maxLinesPerFile: number;
}

// ---------------------------------------------------------------------------
// Auto-fix suggestion
// ---------------------------------------------------------------------------

export interface AutoFix {
  /** Replacement lines — raw code, no markdown or backticks */
  suggestedCode: string;
  /** 1-2 sentences describing what changed and why */
  explanation: string;
  /** Self-assessed confidence score 0.0–1.0 */
  confidence: number;
  /** First line this fix replaces (1-indexed) */
  lineStart: number;
  /** Last line this fix replaces (1-indexed) */
  lineEnd: number;
}

// ---------------------------------------------------------------------------
// Pipeline raw finding (pre-persistence)
// ---------------------------------------------------------------------------

export interface RawFinding {
  /** Short unique key like "ai-jwt-client-only" */
  ruleId: string | null;
  title: string;
  description: string;
  severity: Severity;
  category: FindingCategory;
  filePath: string;
  lineStart: number;
  lineEnd: number;
  codeSnippet: string;
  isAIPatternSpecific: boolean;
  /** Source detector that produced this finding */
  detector: DetectorName;
  /** Extra metadata for the explanation engine */
  metadata?: Record<string, unknown>;
  /** AI-generated fix suggestion — populated by AutoFixGenerator (Stage 9) */
  autoFix?: AutoFix;
  /** Confidence score from LlmVerifier (0.0–1.0), if verifier ran */
  verifierConfidence?: number;
}

export type DetectorName =
  | 'AIPatternDetector'
  | 'SecretsScanner'
  | 'StaticAnalyzer'
  | 'HallucinationDetector'
  | 'AuthFlowValidator'
  | 'LogicBugDetector';

// ---------------------------------------------------------------------------
// Detector-specific output types
// ---------------------------------------------------------------------------

/** HallucinationDetector LLM output item */
export interface HallucinationMatch {
  line: number;
  api: string;
  issue: string;
  /** 0.0–1.0 LLM confidence */
  confidence: number;
}

/** AuthFlowValidator LLM output item */
export interface AuthFlowIssue {
  severity: string;
  issue: string;
  line: number;
  /** CWE identifier e.g. "CWE-287" */
  cwe: string;
}

/** LogicBugDetector LLM output item */
export interface LogicBug {
  line: number;
  bug: string;
  severity: string;
  fix: string;
}

/** ExplanationEngine LLM output */
export interface FindingExplanation {
  explanation: string;
  impact: string;
  /** Copy-pasteable code fix */
  fix: string;
  /** CWE or docs URL */
  reference: string;
}

// ---------------------------------------------------------------------------
// AI Pattern signature
// ---------------------------------------------------------------------------

export interface AIPatternSignature {
  name: string;
  description: string;
  confidence: number;
  filePath: string;
  lineStart: number;
  lineEnd: number;
}

// ---------------------------------------------------------------------------
// Semgrep subprocess output
// ---------------------------------------------------------------------------

export interface SemgrepResult {
  results: SemgrepMatch[];
  errors: SemgrepError[];
}

export interface SemgrepMatch {
  check_id: string;
  path: string;
  start: { line: number; col: number; offset: number };
  end: { line: number; col: number; offset: number };
  extra: {
    message: string;
    severity: string;
    metadata: Record<string, unknown>;
    lines: string;
  };
}

export interface SemgrepError {
  code: number;
  type: string;
  message: string;
}

// ---------------------------------------------------------------------------
// TruffleHog subprocess output
// ---------------------------------------------------------------------------

export interface TruffleHogResult {
  /** Raw secret type e.g. "AWS Access Key" */
  detectorType: string;
  /** True = verified live credential */
  verified: boolean;
  raw: string;
  /** Redacted representation for safe logging */
  redacted: string;
  sourceMetadata: TruffleHogSourceMetadata;
}

export interface TruffleHogSourceMetadata {
  file: string;
  line: number;
  link: string | null;
  email: string | null;
  repository: string | null;
}

// ---------------------------------------------------------------------------
// Scan pipeline output
// ---------------------------------------------------------------------------

export interface PipelineResult {
  scanId: string;
  findings: RawFinding[];
  riskScore: number;
  durationMs: number;
  detectorTimings: Record<DetectorName, number>;
  errors: PipelineError[];
}

export interface PipelineError {
  detector: DetectorName;
  message: string;
  /** Whether the error was recoverable (pipeline continued) */
  fatal: boolean;
}
