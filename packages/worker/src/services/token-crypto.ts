/**
 * Token encryption/decryption for VcsInstallation secrets.
 *
 * Uses AES-256-GCM (authenticated encryption) so that tampering with the
 * stored ciphertext is detectable at decryption time.
 *
 * Wire format (hex-encoded): IV (12 bytes) || AuthTag (16 bytes) || Ciphertext
 *
 * SECURITY:
 *   - Key sourced from TOKEN_ENCRYPTION_KEY env var — never hardcoded
 *   - A fresh random IV is generated for every encryption call
 *   - GCM authentication tag prevents silent decryption of tampered data
 *   - Key must be exactly 64 hex characters (32 bytes / 256 bits)
 *
 * Key generation:
 *   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;   // 96-bit IV — optimal for GCM
const TAG_BYTES = 16;  // 128-bit authentication tag

function loadKey(): Buffer {
  const hex = process.env['TOKEN_ENCRYPTION_KEY'];
  if (!hex || hex.length !== 64) {
    throw new Error(
      'TOKEN_ENCRYPTION_KEY must be set to a 64-character hex string (32 bytes). ' +
      'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'
    );
  }
  return Buffer.from(hex, 'hex');
}

/**
 * Encrypt a plaintext token string for storage in VcsInstallation.encryptedToken.
 *
 * @returns Hex-encoded string: IV + AuthTag + Ciphertext
 */
export function encryptToken(plaintext: string): string {
  const key = loadKey();
  const iv = randomBytes(IV_BYTES);

  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return Buffer.concat([iv, authTag, encrypted]).toString('hex');
}

/**
 * Decrypt a token previously encrypted by encryptToken().
 *
 * @throws If the key is wrong, the ciphertext is truncated, or the auth tag
 *   does not match (indicating tampering or key rotation).
 */
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

  return (
    decipher.update(ciphertext).toString('utf8') +
    decipher.final('utf8')
  );
}
