/**
 * In-memory Redis mock for the CLI.
 *
 * The analyzer's LlmClient requires a Redis instance for caching. In the CLI
 * context we don't want to force users to run Redis, so we provide a no-op
 * implementation that stores responses in-process memory instead.
 *
 * This still gives us within-session caching (same CLI invocation won't call
 * the LLM twice for identical inputs) without any external dependencies.
 */

export class MemoryRedis {
  private store = new Map<string, { value: string; expiresAt: number }>();

  async get(key: string): Promise<string | null> {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return entry.value;
  }

  async setex(key: string, ttlSeconds: number, value: string): Promise<'OK'> {
    this.store.set(key, {
      value,
      expiresAt: Date.now() + ttlSeconds * 1000,
    });
    return 'OK';
  }

  // Stub the remaining methods the ioredis type requires but LlmClient never calls
  async set(_key: string, _value: string): Promise<'OK'> {
    return 'OK';
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  on(_event: string, _handler: (...args: any[]) => void): this {
    return this;
  }
}
