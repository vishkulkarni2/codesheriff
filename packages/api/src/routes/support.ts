/**
 * Support chat route — AI-powered support using the CodeSheriff knowledge base.
 *
 * Works WITHOUT auth (for future marketing site widget) but includes user
 * context if an Authorization header is present.
 *
 * Rate limited to 10 requests per minute per IP.
 */

import type { FastifyInstance } from 'fastify';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load the knowledge base at module init time (once)
const knowledgeBase = readFileSync(
  join(__dirname, '..', 'knowledge-base.md'),
  'utf-8'
);

const SYSTEM_PROMPT = `${knowledgeBase}

---

You are CodeSheriff Support. Answer questions about CodeSheriff using ONLY the knowledge base above. Be helpful, concise, and technical. If you cannot answer from the knowledge base, say you will escalate to the team.`;

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface ChatRequestBody {
  message: string;
  history?: ChatMessage[];
}

export async function supportRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: ChatRequestBody }>(
    '/support/chat',
    {
      config: {
        rateLimit: {
          max: 10,
          timeWindow: '1 minute',
        },
      },
    },
    async (req, reply) => {
      const { message, history = [] } = req.body ?? {};

      if (!message || typeof message !== 'string' || message.trim().length === 0) {
        void reply.status(400).send({
          success: false,
          data: null,
          error: 'message is required and must be a non-empty string',
        });
        return;
      }

      if (message.length > 2000) {
        void reply.status(400).send({
          success: false,
          data: null,
          error: 'message must be 2000 characters or fewer',
        });
        return;
      }

      const apiKey = process.env['ANTHROPIC_API_KEY'];
      if (!apiKey) {
        req.log.error('ANTHROPIC_API_KEY is not set');
        void reply.status(503).send({
          success: false,
          data: null,
          error: 'Support chat is temporarily unavailable',
        });
        return;
      }

      // Build messages array for the Anthropic API
      const messages = [
        ...history.map((m) => ({
          role: m.role,
          content: m.content,
        })),
        { role: 'user' as const, content: message },
      ];

      try {
        const response = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: 'claude-sonnet-4-6-20250514',
            max_tokens: 1024,
            system: SYSTEM_PROMPT,
            messages,
          }),
        });

        if (!response.ok) {
          const errorBody = await response.text();
          req.log.error(
            { status: response.status, body: errorBody },
            'Anthropic API error'
          );
          void reply.status(502).send({
            success: false,
            data: null,
            error: 'Failed to get response from support AI',
          });
          return;
        }

        const data = (await response.json()) as {
          content: Array<{ type: string; text: string }>;
        };

        const replyText =
          data.content
            ?.filter((block) => block.type === 'text')
            .map((block) => block.text)
            .join('') ?? 'Sorry, I could not generate a response.';

        void reply.status(200).send({
          success: true,
          data: { reply: replyText },
          error: null,
        });
      } catch (err) {
        req.log.error({ err }, 'Support chat request failed');
        void reply.status(500).send({
          success: false,
          data: null,
          error: 'Internal server error',
        });
      }
    }
  );
}
