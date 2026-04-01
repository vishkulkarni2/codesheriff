/**
 * Pino logger for the API server.
 * Redacts known sensitive fields before they reach any transport.
 */

import pino from 'pino';

export const logger = pino({
  name: 'codesheriff-api',
  level: process.env['LOG_LEVEL'] ?? 'info',
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'req.headers["x-clerk-secret-key"]',
      '*.password',
      '*.token',
      '*.secret',
      '*.apiKey',
      '*.encryptedToken',
    ],
    censor: '[REDACTED]',
  },
});
