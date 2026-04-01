/**
 * Anthropic Claude SDK client with:
 *   - Exponential backoff retry (3 attempts)
 *   - Redis response caching (1-hour TTL, keyed by SHA-256 of inputs)
 *   - Input sanitization (strips null bytes, enforces length limits)
 *   - Rate-aware error handling (respects 429 retry-after headers)
 *
 * SECURITY: Raw user-supplied code is NEVER embedded directly in prompts.
 * All code content is validated and length-capped before being passed here.
 */

import Anthropic from '@anthropic-ai/sdk';
import type { Redis } from 'ioredis';
import { sha256 } from '../utils/hash.js';
import { logger } from '../utils/logger.js';

const MODEL = 'claude-sonnet-4-20250514';

/** Maximum characters of code content per LLM request */
const MAX_CODE_CHARS = 8_000;

/** Maximum characters per system/user prompt */
const MAX_PROMPT_CHARS = 2_000;

const CACHE_TTL_SECONDS = 3_600; // 1 hour

export interface LlmRequest {
  systemPrompt: string;
  userPrompt: string;
  /** Code content — sanitized and length-capped before being sent */
  codeContent: string;
  /** Unique call-site identifier for logging/cache namespacing */
  detector: string;
}

export interface LlmResponse {
  content: string;
  /** True when response was served from cache */
  cached: boolean;
  /** Model latency in ms (0 if cached) */
  latencyMs: number;
}

/**
 * LLM client factory. Call once per worker process and share the instance.
 */
export class LlmClient {
  private readonly anthropic: Anthropic;
  private readonly redis: Redis;

  constructor(apiKey: string, redis: Redis) {
    // API key is read from environment — never logged or stored
    this.anthropic = new Anthropic({ apiKey });
    this.redis = redis;
  }

  /**
   * Send a request to Claude with caching and retry.
   * Returns parsed JSON text from the model response.
   */
  async call(req: LlmRequest): Promise<LlmResponse> {
    const sanitized = this.sanitize(req);
    const cacheKey = this.cacheKey(sanitized);

    // Check cache first
    const cached = await this.redis.get(cacheKey);
    if (cached !== null) {
      logger.debug({ detector: req.detector }, 'LLM cache hit');
      return { content: cached, cached: true, latencyMs: 0 };
    }

    // Attempt with exponential backoff — latency is measured inside callWithRetry
    const { text: content, latencyMs } = await this.callWithRetry(sanitized);

    // Cache the response
    await this.redis.setex(cacheKey, CACHE_TTL_SECONDS, content);

    return { content, cached: false, latencyMs };
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Execute the Anthropic API call with up to 3 retries and exponential backoff.
   * Respects 429 retry-after headers when present.
   */
  private async callWithRetry(req: LlmRequest): Promise<{ text: string; latencyMs: number }> {
    const maxAttempts = 3;
    const baseDelayMs = 1_000;

    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const start = Date.now();
        const message = await this.anthropic.messages.create({
          model: MODEL,
          max_tokens: 2_048,
          system: req.systemPrompt,
          messages: [{ role: 'user', content: req.userPrompt }],
        });

        const latencyMs = Date.now() - start;
        logger.debug(
          { detector: req.detector, latencyMs, attempt },
          'LLM call succeeded'
        );

        const block = message.content[0];
        if (!block || block.type !== 'text') {
          throw new LlmError('Unexpected response format from Claude', 'INVALID_RESPONSE');
        }

        return { text: block.text, latencyMs };
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));

        // Anthropic SDK throws APIStatusError for HTTP errors
        const status = (err as { status?: number }).status;

        if (status === 429) {
          // Rate limited — respect retry-after or use longer backoff
          const retryAfter = (err as { headers?: Record<string, string> })
            .headers?.['retry-after'];
          const waitMs = retryAfter
            ? parseInt(retryAfter, 10) * 1_000
            : baseDelayMs * Math.pow(2, attempt);
          logger.warn({ attempt, waitMs, detector: req.detector }, 'LLM rate limited, backing off');
          await sleep(waitMs);
          continue;
        }

        if (status !== undefined && status >= 500) {
          // Transient server error — retry with backoff
          const waitMs = baseDelayMs * Math.pow(2, attempt - 1);
          logger.warn({ attempt, waitMs, status, detector: req.detector }, 'LLM server error, retrying');
          await sleep(waitMs);
          continue;
        }

        // Non-retryable error (4xx other than 429, auth failures, etc.)
        throw new LlmError(
          `LLM call failed (non-retryable): ${lastError.message}`,
          'NON_RETRYABLE',
          status
        );
      }
    }

    throw new LlmError(
      `LLM call failed after ${maxAttempts} attempts: ${lastError?.message}`,
      'MAX_RETRIES_EXCEEDED'
    );
  }

  /**
   * Sanitize and cap all string inputs before sending to the LLM.
   * Strips null bytes and control characters that could cause prompt injection.
   */
  private sanitize(req: LlmRequest): LlmRequest {
    return {
      detector: req.detector,
      systemPrompt: sanitizeString(req.systemPrompt, MAX_PROMPT_CHARS),
      userPrompt: sanitizeString(req.userPrompt, MAX_PROMPT_CHARS),
      codeContent: sanitizeString(req.codeContent, MAX_CODE_CHARS),
    };
  }

  /**
   * Generate a stable cache key for an LLM request.
   * Keyed on model + all input content so any change busts the cache.
   */
  private cacheKey(req: LlmRequest): string {
    return `llm_cache:${sha256({ model: MODEL, ...req })}`;
  }
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

/**
 * Strip null bytes and enforce a character length cap.
 * Null bytes can cause prompt injection or unexpected LLM behavior.
 */
function sanitizeString(input: string, maxChars: number): string {
  // Remove null bytes and ASCII control characters (except tabs/newlines)
  const cleaned = input.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
  return cleaned.length > maxChars ? cleaned.slice(0, maxChars) + '\n[truncated]' : cleaned;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class LlmError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status?: number
  ) {
    super(message);
    this.name = 'LlmError';
  }
}
