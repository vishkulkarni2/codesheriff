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
}
