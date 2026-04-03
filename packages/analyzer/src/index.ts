/**
 * @codesheriff/analyzer — public exports
 */

export { AnalysisPipeline } from './pipeline.js';
export type { PipelineConfig } from './pipeline.js';
export { SeverityScorer } from './scorer.js';
export type { ScorerResult } from './scorer.js';
export { LlmClient } from './llm/client.js';
export { AIPatternDetector } from './detectors/ai-pattern.js';
export { SecretsScanner } from './detectors/secrets.js';
export { StaticAnalyzer } from './detectors/static.js';
export { HallucinationDetector } from './detectors/hallucination.js';
export { AuthFlowValidator } from './detectors/auth-flow.js';
export { LogicBugDetector } from './detectors/logic-bug.js';
export { ExplanationEngine } from './detectors/explanation.js';
export { AutoFixGenerator } from './autofix/generator.js';
export type { AutoFix } from '@codesheriff/shared';
