import pino from 'pino';

export const logger = pino({
  name: 'codesheriff-worker',
  level: process.env['LOG_LEVEL'] ?? 'info',
  redact: {
    paths: ['*.token', '*.secret', '*.apiKey', '*.privateKey', '*.encryptedToken'],
    censor: '[REDACTED]',
  },
});
