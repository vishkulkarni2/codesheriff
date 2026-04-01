/**
 * Token encryption for VcsInstallation secrets — API package copy.
 *
 * Identical algorithm to packages/worker/src/services/token-crypto.ts.
 * Both packages need encryption (API encrypts on PUT) and decryption
 * (worker decrypts on scan). Keeping them separate avoids a cross-package
 * dependency between api and worker.
 *
 * Wire format (hex): IV (12 bytes) || AuthTag (16 bytes) || Ciphertext
 * Key: TOKEN_ENCRYPTION_KEY env var — 64-character hex string (32 bytes)
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const TAG_BYTES = 16;

function loadKey(): Buffer {
  const hex = process.env['TOKEN_ENCRYPTION_KEY'];
  if (!hex || hex.length !== 64) {
    throw new Error(
      'TOKEN_ENCRYPTION_KEY must be a 64-character hex string. ' +
      'Generate: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'
    );
  }
  return Buffer.from(hex, 'hex');
}

export function encryptToken(plaintext: string): string {
  const key = loadKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, encrypted]).toString('hex');
}

export function decryptToken(hex: string): string {
  const key = loadKey();
  const buf = Buffer.from(hex, 'hex');
  if (buf.length < IV_BYTES + TAG_BYTES + 1) {
    throw new Error('Encrypted token is too short — data may be corrupt');
  }
  const iv = buf.subarray(0, IV_BYTES);
  const authTag = buf.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const ciphertext = buf.subarray(IV_BYTES + TAG_BYTES);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  return decipher.update(ciphertext).toString('utf8') + decipher.final('utf8');
}
