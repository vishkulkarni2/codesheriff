/**
 * Structured logger for the analyzer pipeline.
 * Uses pino with request-ID correlation. Intentionally never logs
 * secrets, API keys, or raw code snippets beyond debug level.
 */

import pino from 'pino';

export const logger = pino({
  name: 'codesheriff-analyzer',
  level: process.env['LOG_LEVEL'] ?? 'info',
  redact: {
    // Redact known sensitive field paths before they reach the transport
    paths: [
      'anthropicApiKey',
      'token',
      'secret',
      'password',
      'apiKey',
      'encryptedToken',
      '*.apiKey',
      '*.token',
      '*.secret',
    ],
    censor: '[REDACTED]',
  },
  serializers: {
    // Never serialize raw code content at info level or above
    code: (v: unknown) =>
      process.env['LOG_LEVEL'] === 'debug' ? v : '[code omitted]',
  },
});

/**
 * Create a child logger scoped to a specific scan job.
 * All log lines from this child will include scanId + detector context.
 */
export function getScanLogger(scanId: string, detector?: string): pino.Logger {
  return logger.child({ scanId, detector });
}
