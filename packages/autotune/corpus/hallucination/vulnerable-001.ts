// @description AI hallucinated nonexistent Node.js crypto methods

import crypto from "crypto";

// AI-generated: crypto.encryptAES, crypto.decryptAES, and crypto.hashPassword
// do not exist in Node.js's built-in crypto module.
// This code will throw "TypeError: crypto.encryptAES is not a function" at runtime.

export function encryptUserData(data: string, key: string): string {
  // BUG: crypto.encryptAES does not exist
  return (crypto as unknown as Record<string, (a: string, b: string) => string>)
    .encryptAES(data, key);
}

export function hashPassword(password: string): string {
  // BUG: crypto.hashPassword does not exist; should use crypto.createHash or bcrypt
  return (crypto as unknown as Record<string, (a: string) => string>)
    .hashPassword(password);
}

export function generateToken(): string {
  // This one is correct — crypto.randomBytes exists
  return crypto.randomBytes(32).toString("hex");
}
