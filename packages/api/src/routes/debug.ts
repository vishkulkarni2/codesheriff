// TODO: remove this debug route after the static analyzer issue is resolved
/**
 * Debug routes — TEMPORARY
 *
 * Exposes scan diagnostic blobs that the worker stashes in Redis under
 *   scan_diagnostic:last           — most recent scan
 *   scan_diagnostic:<scanId>       — per-scan stash
 *
 * Used to debug why semgrep returns 0 raw findings in the deployed worker
 * container. Upstash Redis is not reachable from outside the Render network,
 * so we proxy the read through this HTTP endpoint.
 *
 * SECURITY:
 *   - Requires Clerk JWT (preHandler app.authenticate)
 *   - Email allowlist gate — rejects everyone else with 403
 *   - Read-only — only fetches keys with the scan_diagnostic: prefix
 *
 * DELETE THIS FILE (and its registration in server.ts) once the semgrep
 * 0-findings bug is fixed.
 */

import type { FastifyInstance } from 'fastify';
import type { Redis } from 'ioredis';

const ADMIN_EMAIL_ALLOWLIST = new Set<string>([
  'vish.k@buyfrens.com',
  'viskul@gmail.com',
]);

interface DiagnosticResponseBody {
  key: string;
  parsed?: unknown;
  raw?: string;
}

export async function debugRoutes(app: FastifyInstance): Promise<void> {
  const redis = (app as unknown as { redis: Redis }).redis;

  /**
   * Common gate: Clerk auth + email allowlist.
   * Returns true if the request should proceed; sends a response and
   * returns false otherwise.
   */
  const requireAdmin = async (
    req: Parameters<typeof app.authenticate>[0],
    reply: Parameters<typeof app.authenticate>[1]
  ): Promise<boolean> => {
    const email = req.dbUser?.email;
    if (!email || !ADMIN_EMAIL_ALLOWLIST.has(email)) {
      void reply.status(403).send({
        success: false,
        data: null,
        error: 'Forbidden: admin allowlist',
      });
      return false;
    }
    return true;
  };

  /**
   * Fetch a scan_diagnostic:* key from Redis and return its contents.
   * Returns 404 if the key does not exist.
   * If JSON parsing fails, returns the raw string in `raw` so no data is lost.
   */
  const fetchDiagnostic = async (key: string): Promise<DiagnosticResponseBody | null> => {
    const value = await redis.get(key);
    if (value === null) return null;

    try {
      const parsed = JSON.parse(value);
      return { key, parsed };
    } catch {
      return { key, raw: value };
    }
  };

  // ---------------------------------------------------------------------------
  // GET /api/v1/debug/scan-diagnostic/latest
  // ---------------------------------------------------------------------------
  app.get(
    '/debug/scan-diagnostic/latest',
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      if (!(await requireAdmin(req, reply))) return;

      const key = 'scan_diagnostic:last';
      const body = await fetchDiagnostic(key);
      if (!body) {
        return reply.status(404).send({
          success: false,
          data: null,
          error: `No diagnostic found at ${key}`,
        });
      }

      return reply.send({
        success: true,
        data: body,
        error: null,
      });
    }
  );

  // ---------------------------------------------------------------------------
  // GET /api/v1/debug/scan-diagnostic/:scanId
  // ---------------------------------------------------------------------------
  app.get(
    '/debug/scan-diagnostic/:scanId',
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      if (!(await requireAdmin(req, reply))) return;

      const { scanId } = req.params as { scanId: string };

      // Defensive: scanId should be a simple identifier — reject anything that
      // could let a caller poke at unrelated Redis keys.
      if (!/^[A-Za-z0-9_-]+$/.test(scanId)) {
        return reply.status(400).send({
          success: false,
          data: null,
          error: 'Invalid scanId format',
        });
      }

      const key = `scan_diagnostic:${scanId}`;
      const body = await fetchDiagnostic(key);
      if (!body) {
        return reply.status(404).send({
          success: false,
          data: null,
          error: `No diagnostic found at ${key}`,
        });
      }

      return reply.send({
        success: true,
        data: body,
        error: null,
      });
    }
  );

  // ---------------------------------------------------------------------------
  // GET /api/v1/debug/redis-info
  //
  // Lists every key in the API's Redis matching scan_diagnostic:* and bull:*,
  // plus the Redis server INFO header so we can confirm the API and the worker
  // are talking to the SAME Redis instance. Used to diagnose the case where
  // the worker writes to one Redis and the API reads from another (different
  // REDIS_URL on the two services on Render).
  // ---------------------------------------------------------------------------
  app.get(
    '/debug/redis-info',
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      if (!(await requireAdmin(req, reply))) return;

      const result: Record<string, unknown> = {};

      // SCAN for scan_diagnostic:* keys (SCAN is non-blocking, KEYS is not).
      try {
        const diagKeys: string[] = [];
        let cursor = '0';
        do {
          const [next, batch] = await redis.scan(
            cursor,
            'MATCH',
            'scan_diagnostic:*',
            'COUNT',
            '100'
          );
          cursor = next;
          diagKeys.push(...batch);
        } while (cursor !== '0' && diagKeys.length < 200);
        result['scanDiagnosticKeys'] = diagKeys;
        result['scanDiagnosticKeyCount'] = diagKeys.length;
      } catch (err) {
        result['scanDiagnosticScanError'] = String(err).slice(0, 300);
      }

      // SCAN for bull:* (BullMQ queue keys — confirms this is the same Redis
      // the worker uses, since the worker is a BullMQ consumer).
      try {
        const bullKeys: string[] = [];
        let cursor = '0';
        do {
          const [next, batch] = await redis.scan(
            cursor,
            'MATCH',
            'bull:*',
            'COUNT',
            '100'
          );
          cursor = next;
          bullKeys.push(...batch);
        } while (cursor !== '0' && bullKeys.length < 50);
        result['bullKeysSample'] = bullKeys.slice(0, 20);
        result['bullKeyCount'] = bullKeys.length;
      } catch (err) {
        result['bullScanError'] = String(err).slice(0, 300);
      }

      // INFO server section gives us the Redis server identity (Upstash returns
      // a header with the cluster id and version).
      try {
        const info = await redis.info('server');
        result['redisServerInfo'] = info.slice(0, 800);
      } catch (err) {
        result['redisInfoError'] = String(err).slice(0, 300);
      }

      // The URL the API process is using, with credentials redacted, so we
      // can compare it visually against what the worker process is using.
      const apiRedisUrl = process.env['REDIS_URL'] ?? '';
      result['apiRedisUrlRedacted'] = apiRedisUrl.replace(
        /:\/\/[^@]*@/,
        '://REDACTED@'
      );

      return reply.send({
        success: true,
        data: result,
        error: null,
      });
    }
  );
}
