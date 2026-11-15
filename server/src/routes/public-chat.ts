import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { getAllProviders } from '../providers/index.js';
import { sanitizeProviderErrorMessage } from '../lib/error-redaction.js';
import { isLoopbackRequest } from '../lib/loopback.js';
import { recordZarnurAiUse } from '../services/zarnur-visitors.js';

export const publicChatRouter = Router();

const FREE_CHAT_PLATFORM = 'kilo';
// Kilo's anonymous gateway quota is 200 requests/hour per egress IP.
const FREE_CHAT_LIMIT = 180;
const FREE_CHAT_WINDOW_MS = 60 * 60 * 1000;
const KILO_CATALOG_URL = 'https://api.kilo.ai/api/gateway/models';
const KILO_CATALOG_CACHE_MS = 5 * 60 * 1000;
let freeChatWindowStartedAt = Date.now();
let freeChatRequests = 0;

interface FreeChatModel {
  id: string;
  name: string;
  preferredIndex: number;
}

let freeChatModelCache: { expiresAt: number; models: FreeChatModel[] } | undefined;
let freeChatModelRequest: Promise<FreeChatModel[]> | undefined;

const freeChatProvider = () => getAllProviders().find(provider =>
  provider.platform === FREE_CHAT_PLATFORM &&
  provider.keyless &&
  provider.supportsChat !== false,
);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isZeroPrice(value: unknown): boolean {
  return value === 0 || (typeof value === 'string' && /^0+(?:\.0+)?$/.test(value));
}

function parseFreeChatModels(payload: unknown): FreeChatModel[] {
  const entries = Array.isArray(payload)
    ? payload
    : isRecord(payload) && Array.isArray(payload.data)
      ? payload.data
      : isRecord(payload) && Array.isArray(payload.models)
        ? payload.models
        : null;
  if (!entries) throw new Error('Kilo returned an invalid model catalog');

  const now = Date.now();
  return entries.flatMap((entry): FreeChatModel[] => {
    if (!isRecord(entry) || typeof entry.id !== 'string' || typeof entry.name !== 'string') return [];
    if (!entry.id.endsWith(':free') || entry.isFree !== true) return [];
    if (!isRecord(entry.pricing) || !isZeroPrice(entry.pricing.prompt) || !isZeroPrice(entry.pricing.completion)) return [];
    if (!isRecord(entry.architecture) || !Array.isArray(entry.architecture.input_modalities) ||
      !entry.architecture.input_modalities.includes('text') ||
      !Array.isArray(entry.architecture.output_modalities) ||
      !entry.architecture.output_modalities.includes('text')) return [];
    if (typeof entry.expiration_date === 'string') {
      const expiry = Date.parse(entry.expiration_date);
      if (Number.isFinite(expiry) && expiry <= now) return [];
    }

    return [{
      id: entry.id,
      name: entry.name,
      preferredIndex: typeof entry.preferredIndex === 'number' ? entry.preferredIndex : Number.MAX_SAFE_INTEGER,
    }];
  }).sort((a, b) => a.preferredIndex - b.preferredIndex || a.name.localeCompare(b.name));
}

async function getFreeChatModels(): Promise<FreeChatModel[]> {
  if (freeChatModelCache && freeChatModelCache.expiresAt > Date.now()) {
    return freeChatModelCache.models;
  }
  if (freeChatModelRequest) return freeChatModelRequest;

  freeChatModelRequest = (async () => {
    const response = await fetch(KILO_CATALOG_URL, {
      headers: { Accept: 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`Kilo model catalog returned HTTP ${response.status}`);
    const models = parseFreeChatModels(await response.json() as unknown);
    if (models.length === 0) throw new Error('Kilo returned no active free chat models');
    freeChatModelCache = { expiresAt: Date.now() + KILO_CATALOG_CACHE_MS, models };
    return models;
  })();

  try {
    return await freeChatModelRequest;
  } finally {
    freeChatModelRequest = undefined;
  }
}

function consumeFreeChatRequest(): { allowed: boolean; retryAfterSeconds: number } {
  const now = Date.now();
  if (now < freeChatWindowStartedAt || now - freeChatWindowStartedAt >= FREE_CHAT_WINDOW_MS) {
    freeChatWindowStartedAt = now;
    freeChatRequests = 0;
  }

  const retryAfterSeconds = Math.max(
    1,
    Math.ceil((freeChatWindowStartedAt + FREE_CHAT_WINDOW_MS - now) / 1000),
  );
  if (freeChatRequests >= FREE_CHAT_LIMIT) return { allowed: false, retryAfterSeconds };
  freeChatRequests += 1;
  return { allowed: true, retryAfterSeconds };
}

publicChatRouter.get('/models', async (_req: Request, res: Response) => {
  const provider = freeChatProvider();
  res.setHeader('Cache-Control', 'no-store');
  if (!provider) {
    res.status(503).json({
      error: { message: 'Bepul AI hozircha mavjud emas. Keyinroq qayta urinib ko‘ring.', type: 'service_unavailable' },
    });
    return;
  }

  try {
    const models = await getFreeChatModels();
    res.json({
      models: models.map(model => ({
        platform: FREE_CHAT_PLATFORM,
        provider: 'Bepul AI',
        modelId: model.id,
        displayName: model.name,
      })),
    });
  } catch (error) {
    console.error('[public-chat] Failed to load the free-model catalog:', error);
    res.status(503).json({
      error: { message: 'Bepul AI modellari hozircha yuklanmadi. Keyinroq qayta urinib ko‘ring.', type: 'service_unavailable' },
    });
  }
});

const completionSchema = z.object({
  platform: z.literal(FREE_CHAT_PLATFORM),
  modelId: z.string().min(1).max(200),
  messages: z.array(z.object({
    role: z.enum(['user', 'assistant']),
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
      error: { message: 'HTTPS is required before sending a chat message.', type: 'https_required' },
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
  const provider = freeChatProvider();
  if (!provider) {
    res.status(503).json({
      error: { message: 'Bepul AI hozircha mavjud emas. Keyinroq qayta urinib ko‘ring.', type: 'service_unavailable' },
    });
    return;
  }

  let models: FreeChatModel[];
  try {
    models = await getFreeChatModels();
  } catch (error) {
    console.error('[public-chat] Failed to validate the free model:', error);
    res.status(503).json({
      error: { message: 'Bepul AI modellari hozircha yuklanmadi. Keyinroq qayta urinib ko‘ring.', type: 'service_unavailable' },
    });
    return;
  }
  if (!models.some(model => model.id === input.modelId)) {
    res.status(400).json({
      error: { message: 'Bepul ro‘yxatdan model tanlang.', type: 'invalid_request_error' },
    });
    return;
  }

  const quota = consumeFreeChatRequest();
  if (!quota.allowed) {
    res.setHeader('Retry-After', String(quota.retryAfterSeconds));
    res.status(429).json({
      error: {
        message: 'Bepul AI umumiy soatlik limitga yetdi. Biroz kutib, qayta urinib ko‘ring.',
        type: 'rate_limit_error',
      },
    });
    return;
  }

  try {
    const result = await provider.chatCompletion(
      'no-key',
      [
        {
          role: 'system',
          content: 'You are Zarnur, a helpful multilingual AI assistant. Reply in the user’s language. Help with general questions, writing, planning, and jewelry business when relevant. Do not invent product stock, prices, delivery terms, or business promises; be clear when you do not know current details.',
        },
        ...input.messages,
      ],
      input.modelId,
      { max_tokens: input.maxTokens ?? 512, temperature: input.temperature },
    );
    recordZarnurAiUse(req);
    res.setHeader('Cache-Control', 'no-store');
    res.json(result);
  } catch (error) {
    const rawMessage = error instanceof Error ? error.message : String(error);
    if (/\b429\b|rate.?limit|daily limit|limit exceeded|quota|too many requests/i.test(rawMessage)) {
      res.status(429).json({
        error: {
          message: 'Bepul AI provayderining limiti vaqtincha to‘ldi. Boshqa bepul modelni tanlang yoki keyinroq urinib ko‘ring.',
          type: 'rate_limit_error',
        },
      });
      return;
    }
    const message = sanitizeProviderErrorMessage(rawMessage);
    res.status(502).json({ error: { message, type: 'provider_error' } });
  }
});
