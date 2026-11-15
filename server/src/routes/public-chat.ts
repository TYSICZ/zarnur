import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { getDb } from '../db/index.js';
import { getAllProviders } from '../providers/index.js';
import { sanitizeProviderErrorMessage } from '../lib/error-redaction.js';
import { isLoopbackRequest } from '../lib/loopback.js';
import { recordZarnurAiUse } from '../services/zarnur-visitors.js';

export const publicChatRouter = Router();

const publicProviders = () => getAllProviders().filter(provider =>
  provider.platform !== 'custom' &&
  provider.supportsChat !== false &&
  !provider.keyless,
);

publicChatRouter.get('/models', (_req: Request, res: Response) => {
  const providers = new Map<string, string>();
  for (const provider of publicProviders()) providers.set(provider.platform, provider.name);
  const rows = getDb().prepare(`
    SELECT platform, model_id, display_name
    FROM models
    WHERE enabled = 1 AND platform != 'custom'
    ORDER BY platform, display_name
  `).all() as Array<{ platform: string; model_id: string; display_name: string }>;

  res.setHeader('Cache-Control', 'no-store');
  res.json({
    models: rows.flatMap(row => {
      const provider = providers.get(row.platform);
      return provider
        ? [{ platform: row.platform, provider, modelId: row.model_id, displayName: row.display_name }]
        : [];
    }),
  });
});

const completionSchema = z.object({
  platform: z.string().min(1).max(50),
  modelId: z.string().min(1).max(200),
  apiKey: z.string().trim().min(1).max(4096),
  messages: z.array(z.object({
    role: z.enum(['system', 'user', 'assistant']),
    content: z.string().min(1).max(6000),
  }).strict()).min(1).max(20),
  maxTokens: z.number().int().min(1).max(1024).optional(),
  temperature: z.number().min(0).max(2).optional(),
}).strict();

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

function isSecureChatRequest(req: Request): boolean {
  const origin = req.headers.origin;
  if (typeof origin === 'string') {
    try {
      const parsed = new URL(origin);
      if (parsed.protocol === 'https:') return true;
      return parsed.protocol === 'http:' && LOCAL_HOSTS.has(parsed.hostname.toLowerCase()) &&
        isLoopbackRequest(req);
    } catch {
      return false;
    }
  }

  const forwardedProto = String(req.headers['x-forwarded-proto'] ?? '')
    .split(',')[0]!.trim().toLowerCase();
  if (req.secure || forwardedProto === 'https') return true;

  let hostname = '';
  try {
    hostname = new URL(`http://${req.headers.host ?? ''}`).hostname.toLowerCase();
  } catch {
    return false;
  }
  return LOCAL_HOSTS.has(hostname) && isLoopbackRequest(req);
}

publicChatRouter.post('/completions', async (req: Request, res: Response) => {
  if (!isSecureChatRequest(req)) {
    res.status(426).json({
      error: { message: 'HTTPS is required before sending a provider API key.', type: 'https_required' },
    });
    return;
  }

  const parsed = completionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: { message: parsed.error.issues.map(issue => issue.message).join(', '), type: 'invalid_request_error' },
    });
    return;
  }

  const input = parsed.data;
  const provider = publicProviders().find(candidate => candidate.platform === input.platform);
  if (!provider) {
    res.status(400).json({ error: { message: 'Unsupported provider', type: 'invalid_request_error' } });
    return;
  }

  const modelExists = getDb().prepare(`
    SELECT 1 FROM models
    WHERE platform = ? AND model_id = ? AND enabled = 1
    LIMIT 1
  `).get(input.platform, input.modelId);
  if (!modelExists) {
    res.status(400).json({ error: { message: 'Choose an enabled model from the list', type: 'invalid_request_error' } });
    return;
  }

  try {
    const result = await provider.chatCompletion(
      input.apiKey,
      input.messages,
      input.modelId,
      { max_tokens: input.maxTokens ?? 1024, temperature: input.temperature },
    );
    recordZarnurAiUse(req);
    res.setHeader('Cache-Control', 'no-store');
    res.json(result);
  } catch (error) {
    const message = sanitizeProviderErrorMessage(error instanceof Error ? error.message : error);
    res.status(502).json({ error: { message, type: 'provider_error' } });
  }
});
