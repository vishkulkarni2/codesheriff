/**
 * Tests for sha256() — the deterministic cache-key hashing utility.
 */

import { describe, it, expect } from 'vitest';
import { sha256 } from '../utils/hash.js';

describe('sha256', () => {
  // -------------------------------------------------------------------------
  // Output format
  // -------------------------------------------------------------------------

  it('returns a 64-character lowercase hex string for a plain string', () => {
    const result = sha256('hello');
    expect(result).toHaveLength(64);
    expect(result).toMatch(/^[0-9a-f]{64}$/);
  });

  it('returns a 64-character lowercase hex string for an object', () => {
    const result = sha256({ model: 'claude', code: 'const x = 1;' });
    expect(result).toHaveLength(64);
    expect(result).toMatch(/^[0-9a-f]{64}$/);
  });

  // -------------------------------------------------------------------------
  // Determinism — same input always produces same output
  // -------------------------------------------------------------------------

  it('is deterministic for plain strings', () => {
    const input = 'const getUserById = async (id: string) => { ... }';
    expect(sha256(input)).toBe(sha256(input));
  });

  it('is deterministic for objects', () => {
    const obj = { model: 'claude-sonnet-4-20250514', prompt: 'analyze', code: 'fn()' };
    expect(sha256(obj)).toBe(sha256({ ...obj }));
  });

  it('is deterministic for arrays', () => {
    const arr = [1, 'hello', true, null];
    expect(sha256(arr)).toBe(sha256([1, 'hello', true, null]));
  });

  // -------------------------------------------------------------------------
  // Key-order stability — the core cache-correctness guarantee
  // -------------------------------------------------------------------------

  it('produces the same hash regardless of object key insertion order', () => {
    const a = sha256({ model: 'claude', code: 'fn()', prompt: 'check' });
    const b = sha256({ prompt: 'check', model: 'claude', code: 'fn()' });
    const c = sha256({ code: 'fn()', prompt: 'check', model: 'claude' });
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  it('produces the same hash for nested objects regardless of key order', () => {
    const a = sha256({ meta: { z: 1, a: 2 }, value: 'x' });
    const b = sha256({ value: 'x', meta: { a: 2, z: 1 } });
    expect(a).toBe(b);
  });

  // -------------------------------------------------------------------------
  // Sensitivity — different inputs produce different hashes
  // -------------------------------------------------------------------------

  it('produces different hashes for different strings', () => {
    expect(sha256('hello')).not.toBe(sha256('world'));
  });

  it('produces different hashes when object values differ', () => {
    expect(sha256({ code: 'a' })).not.toBe(sha256({ code: 'b' }));
  });

  it('produces different hashes when object keys differ', () => {
    expect(sha256({ key1: 'val' })).not.toBe(sha256({ key2: 'val' }));
  });

  it('produces different hashes for string vs object with same content', () => {
    // The plain-string path skips JSON.stringify; result differs from the
    // stringified object path
    const strHash = sha256('test');
    const objHash = sha256({ value: 'test' });
    expect(strHash).not.toBe(objHash);
  });

  // -------------------------------------------------------------------------
  // Known-value test (regression anchor)
  // -------------------------------------------------------------------------

  it('matches the known SHA-256 of the empty string', () => {
    // SHA-256("") === e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
    expect(sha256('')).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
    );
  });

  it('hashes null and undefined without throwing', () => {
    expect(() => sha256(null)).not.toThrow();
    expect(() => sha256(undefined)).not.toThrow();
    expect(sha256(null)).toHaveLength(64);
    expect(sha256(undefined)).toHaveLength(64);
  });

  it('hashes deeply nested structures without throwing', () => {
    const deep = { a: { b: { c: { d: { e: 'leaf' } } } } };
    expect(() => sha256(deep)).not.toThrow();
    expect(sha256(deep)).toHaveLength(64);
  });
});
