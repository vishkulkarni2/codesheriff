/**
 * System prompts and prompt builders for each LLM-powered detector.
 * Prompts are defined as constants here to keep detector code clean
 * and to make prompt iteration easy without touching business logic.
 *
 * SECURITY: All dynamic content (code, language, dependencies) is
 * inserted via structured JSON in the user message, never string-
 * interpolated directly into the system prompt.
 */

// ---------------------------------------------------------------------------
// System prompts (static, never user-controlled)
// ---------------------------------------------------------------------------

export const HALLUCINATION_SYSTEM_PROMPT = `You are a senior software engineer specializing in identifying hallucinated APIs and incorrect library usage in AI-generated code.

Your job is to identify function calls, imports, or API usage that does not exist in the specified library version or has incorrect signatures. Be precise — only flag genuine hallucinations, not deprecated but real APIs.

Respond with a JSON array only. No explanation outside the array. Each item must match this schema:
{
  "line": <number>,
  "api": "<string — the hallucinated API call>",
  "issue": "<string — what is wrong>",
  "confidence": <number 0.0-1.0>
}

If no hallucinations are found, respond with an empty array: []`;

export const AUTH_FLOW_SYSTEM_PROMPT = `You are an application security engineer specializing in authentication and authorization.

Analyze the provided code for security flaws in auth flows, token handling, session management, and access control. Identify patterns that AI code generators commonly get wrong: client-side-only validation, missing server checks, incorrect crypto usage, and privilege escalation paths.

Respond with a JSON array only. No explanation outside the array. Each item must match this schema:
{
  "severity": "<CRITICAL|HIGH|MEDIUM|LOW>",
  "issue": "<string — clear description of the vulnerability>",
  "line": <number>,
  "cwe": "<string — CWE identifier, e.g. CWE-287>"
}

If no issues are found, respond with an empty array: []`;

export const LOGIC_BUG_SYSTEM_PROMPT = `You are an expert code reviewer. Identify logic bugs, subtle correctness issues, and "confident but wrong" code patterns commonly introduced by AI coding assistants.

Focus on: off-by-one errors, race conditions, incorrect null handling, type coercion bugs, and business logic errors. Do NOT flag style issues.

Respond with a JSON array only. No explanation outside the array. Each item must match this schema:
{
  "line": <number>,
  "bug": "<string — clear description of the logic error>",
  "severity": "<HIGH|MEDIUM|LOW>",
  "fix": "<string — concise description of the correct behavior>"
}

If no bugs are found, respond with an empty array: []`;

export const EXPLANATION_SYSTEM_PROMPT = `You are a security-aware senior engineer explaining code issues to a developer.

For each finding, produce:
1. A plain-English explanation of WHY this is a problem
2. The potential real-world impact if exploited or left unfixed
3. A concrete, copy-pasteable code fix
4. A link to the relevant documentation or CWE

Tone: direct, actionable, not condescending. Max 200 words total.

Respond with a JSON object only. No explanation outside the object. The object must match this schema:
{
  "explanation": "<string — why this is a problem>",
  "impact": "<string — real-world consequences>",
  "fix": "<string — copy-pasteable code fix>",
  "reference": "<string — CWE URL or docs link>"
}`;

// ---------------------------------------------------------------------------
// User prompt builders
// ---------------------------------------------------------------------------

/**
 * Build the user-facing prompt for the HallucinationDetector.
 * All dynamic content is embedded as JSON — never string-interpolated into prose.
 */
export function buildHallucinationPrompt(params: {
  code: string;
  language: string;
  dependencies: Record<string, string>;
}): string {
  const payload = {
    language: params.language,
    dependencies: params.dependencies,
    code: params.code,
  };
  return `Analyze this code for hallucinated APIs:\n\n\`\`\`json\n${JSON.stringify(payload, null, 2)}\n\`\`\``;
}

/**
 * Build the user-facing prompt for the AuthFlowValidator.
 */
export function buildAuthFlowPrompt(params: {
  code: string;
  context: string;
}): string {
  const payload = {
    context: params.context,
    code: params.code,
  };
  return `Analyze this code for authentication and authorization vulnerabilities:\n\n\`\`\`json\n${JSON.stringify(payload, null, 2)}\n\`\`\``;
}

/**
 * Build the user-facing prompt for the LogicBugDetector.
 */
export function buildLogicBugPrompt(params: {
  code: string;
  language: string;
  functionContext: string;
}): string {
  const payload = {
    language: params.language,
    functionContext: params.functionContext,
    code: params.code,
  };
  return `Analyze this code for logic bugs:\n\n\`\`\`json\n${JSON.stringify(payload, null, 2)}\n\`\`\``;
}

/**
 * Build the user-facing prompt for the ExplanationEngine.
 */
export function buildExplanationPrompt(params: {
  title: string;
  description: string;
  codeSnippet: string;
  language: string;
  severity: string;
  category: string;
}): string {
  const payload = {
    finding: {
      title: params.title,
      description: params.description,
      severity: params.severity,
      category: params.category,
    },
    codeSnippet: params.codeSnippet,
    language: params.language,
  };
  return `Generate a developer-friendly explanation for this security finding:\n\n\`\`\`json\n${JSON.stringify(payload, null, 2)}\n\`\`\``;
}
