import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import type { ChatMessage } from '@freellmapi/shared/types.js';
import { getDb } from '../db/index.js';
import { contentToString, estimateInputTokens } from '../lib/content.js';
import { sanitizeProviderErrorMessage } from '../lib/error-redaction.js';
import { parseModelScope } from '../lib/model-scope.js';
import { logRequest } from '../lib/request-log.js';
import { withKeyProxy } from '../lib/proxy.js';
import { recordMonthlyUsage } from '../services/key-budget.js';
import { getAllProviders } from '../providers/index.js';
import { routePinnedModel, recordRateLimitHit, recordSuccess, failureAttributionFor } from '../services/router.js';
import {
  getCooldownDecisionForLimit,
  recordRequest,
  recordTokens,
  setCooldown,
} from '../services/ratelimit.js';
import { isSecureChatRequest } from './public-chat.js';
import type { SessionUser } from '../services/auth.js';
import { ZARNUR_DEFAULT_TEMPERATURE, ZARNUR_SYSTEM_PROMPT } from '../services/zarnur-chat.js';

export const memberChatRouter = Router();

export const DAILY_MEMBER_LIMIT = 30;

const completionSchema = z.object({
  modelDbId: z.number().int().positive().optional(),
  automatic: z.boolean().optional(),
  messages: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string().min(1).max(6000),
  }).strict()).min(1).max(20),
  maxTokens: z.number().int().min(1).max(1024).optional(),
  temperature: z.number().min(0).max(2).optional(),
}).strict().refine(
  input => input.automatic === true ? input.modelDbId === undefined : input.modelDbId !== undefined,
  { message: 'Choose automatic routing or one shared model.' },
);

interface ModelRow {
  id: number;
  platform: string;
  model_id: string;
  display_name: string;
  key_id: number | null;
}

interface SharedKeyRow {
  id: number;
  model_scope_json: string | null;
}

function getSharedModels() {
  const db = getDb();
  const rows = db.prepare(`
    SELECT id, platform, model_id, display_name, key_id
      FROM models
     WHERE enabled = 1 AND platform != 'custom'
     ORDER BY display_name COLLATE NOCASE
  `).all() as ModelRow[];
  const keys = new Map<string, SharedKeyRow[]>();
  const rowsByPlatform = db.prepare(`
    SELECT id, platform, model_scope_json
      FROM api_keys
     WHERE share_with_members = 1 AND enabled = 1 AND status IN ('healthy', 'unknown')
  `).all() as Array<SharedKeyRow & { platform: string }>;
  for (const key of rowsByPlatform) {
    const list = keys.get(key.platform) ?? [];
    list.push(key);
    keys.set(key.platform, list);
  }
  const providers = getAllProviders();

  return rows.flatMap(model => {
    const provider = providers.find(candidate => candidate.platform === model.platform);
    if (!provider || provider.supportsChat === false) return [];
    const eligible = (keys.get(model.platform) ?? []).some(key => {
      const scope = parseModelScope(key.model_scope_json);
      return (model.key_id === null || key.id === model.key_id) &&
        (!scope || scope.has(model.model_id));
    });
    if (!eligible) return [];
    return [{
      id: model.id,
      platform: model.platform,
      provider: provider.name,
      modelId: model.model_id,
      displayName: model.display_name,
    }];
  });
}

const AUTOMATIC_PLATFORM_ORDER = ['google', 'groq', 'cloudflare', 'openrouter'];
let automaticModelCursor = 0;

function getAutomaticSharedModels() {
  const priority = (platform: string) => {
    const index = AUTOMATIC_PLATFORM_ORDER.indexOf(platform);
    return index === -1 ? AUTOMATIC_PLATFORM_ORDER.length : index;
  };
  const seenPlatforms = new Set<string>();
  const candidates = getSharedModels()
    .sort((a, b) => priority(a.platform) - priority(b.platform) ||
      a.displayName.localeCompare(b.displayName))
    .filter(model => {
      if (seenPlatforms.has(model.platform)) return false;
      seenPlatforms.add(model.platform);
      return true;
    });

  if (candidates.length < 2) return candidates;
  const start = automaticModelCursor % candidates.length;
  automaticModelCursor = (automaticModelCursor + 1) % candidates.length;
  return [...candidates.slice(start), ...candidates.slice(0, start)];
}

export function recordMemberRequest(userId: number): boolean {
  const db = getDb();
  db.prepare("DELETE FROM zarnur_member_chat_usage WHERE day < date('now', '-90 days')").run();
  const result = db.prepare(`
    INSERT INTO zarnur_member_chat_usage (user_id, day, request_count)
    VALUES (?, date('now'), 1)
    ON CONFLICT (user_id, day) DO UPDATE
      SET request_count = request_count + 1
      WHERE request_count < ?
  `).run(userId, DAILY_MEMBER_LIMIT);
  return result.changes > 0;
}

export function markMemberRequestSucceeded(userId: number): void {
  getDb().prepare(`
    UPDATE zarnur_member_chat_usage
       SET success_count = success_count + 1
     WHERE user_id = ? AND day = date('now')
  `).run(userId);
}

function userFromRequest(req: Request): SessionUser | undefined {
  return (req as Request & { user?: SessionUser }).user;
}

memberChatRouter.get('/models', (_req: Request, res: Response) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({ models: getSharedModels() });
});

memberChatRouter.post('/completions', async (req: Request, res: Response) => {
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

  const user = userFromRequest(req);
  if (!user) {
    res.status(401).json({ error: { message: 'Authentication required', type: 'authentication_error' } });
    return;
  }
  const automatic = parsed.data.automatic === true;
  const sharedModels = getSharedModels();
  const selectedModel = automatic
    ? undefined
    : sharedModels.find(item => item.id === parsed.data.modelDbId);
  if (!automatic && !selectedModel) {
    res.status(404).json({
      error: { message: 'This model is not currently shared by the administrator.', type: 'model_not_found' },
    });
    return;
  }
  const candidates = automatic
    ? getAutomaticSharedModels()
    : selectedModel
      ? [selectedModel]
      : [];
  if (candidates.length === 0) {
    res.status(429).json({
      error: { message: 'Administrator ulashgan modellar hozircha mavjud emas. Keyinroq urinib ko‘ring.', type: 'rate_limit_error' },
    });
    return;
  }

  const messages: ChatMessage[] = [
    { role: 'system', content: ZARNUR_SYSTEM_PROMPT },
    ...parsed.data.messages,
  ];
  const estimatedTokens = estimateInputTokens(messages) + (parsed.data.maxTokens ?? 512);
  let requestRecorded = false;
  let routedCount = 0;
  let lastFailure: { rateLimited: boolean; message: string } | undefined;

  for (const model of candidates) {
    const nonSharedKeys = getDb().prepare(`
      SELECT id FROM api_keys
       WHERE platform = ? AND share_with_members = 0
    `).all(model.platform) as Array<{ id: number }>;
    const skipKeys = new Set(nonSharedKeys.map(key => `${model.platform}:${model.modelId}:${key.id}`));
    const route = routePinnedModel(model.id, estimatedTokens, skipKeys);
    if (!route) continue;
    routedCount += 1;

    if (!requestRecorded) {
      if (!recordMemberRequest(user.userId)) {
        route.release?.();
        const tomorrow = new Date();
        tomorrow.setUTCHours(24, 0, 0, 0);
        res.setHeader('Retry-After', String(Math.max(1, Math.ceil((tomorrow.getTime() - Date.now()) / 1000))));
        res.status(429).json({
          error: { message: `Kunlik bepul limit ${DAILY_MEMBER_LIMIT} ta xabar. Ertaga qayta urinib ko‘ring.`, type: 'rate_limit_error' },
        });
        return;
      }
      requestRecorded = true;
    }

    const startedAt = Date.now();
    try {
      const result = await withKeyProxy(route.proxyUrl, () => route.provider.chatCompletion(
        route.apiKey,
        messages,
        route.modelId,
        { max_tokens: parsed.data.maxTokens ?? 512, temperature: parsed.data.temperature ?? ZARNUR_DEFAULT_TEMPERATURE },
      ));
      const choice = result.choices?.[0];
      const answer = contentToString(choice?.message?.content ?? '');
      const outputTokens = result.usage?.completion_tokens ?? Math.ceil(answer.length / 4);
      const inputTokens = result.usage?.prompt_tokens ?? Math.max(0, estimatedTokens - (parsed.data.maxTokens ?? 512));
      const totalTokens = result.usage?.total_tokens ?? inputTokens + outputTokens;
      recordRequest(route.platform, route.modelId, route.keyId);
      recordTokens(route.platform, route.modelId, route.keyId, totalTokens);
      if (!answer.trim()) {
        getDb().transaction(() => {
          recordMonthlyUsage(route.keyId, totalTokens);
          logRequest(route.platform, route.modelId, route.keyId, 'error', inputTokens, outputTokens,
            Date.now() - startedAt, 'empty completion', null, model.modelId, null, 'zarnur-member-chat');
        })();
        lastFailure = { rateLimited: false, message: 'Model bo‘sh javob qaytardi.' };
        continue;
      }

      recordSuccess(route.modelDbId);
      if (!logRequest(route.platform, route.modelId, route.keyId, 'success', inputTokens, outputTokens,
        Date.now() - startedAt, null, null, model.modelId, null, 'zarnur-member-chat')) {
        console.error('[member-chat] Failed to record a successful provider request.');
      }
      markMemberRequestSucceeded(user.userId);
      res.setHeader('Cache-Control', 'no-store');
      res.json(result);
      return;
    } catch (error) {
      const rawMessage = error instanceof Error ? error.message : String(error);
      const details = typeof error === 'object' && error !== null
        ? error as { status?: unknown; retryAfterMs?: unknown }
        : {};
      const status = typeof details.status === 'number' ? details.status : 502;
      const rateLimited = status === 429 || /\b429\b|rate.?limit|daily limit|limit exceeded|quota|too many requests/i.test(rawMessage);
      const safeMessage = sanitizeProviderErrorMessage(rawMessage);
      const attribution = failureAttributionFor(error);
      if (!logRequest(route.platform, route.modelId, route.keyId, 'error', 0, 0,
        Date.now() - startedAt, safeMessage, null, model.modelId, null, 'zarnur-member-chat', attribution)) {
        console.error('[member-chat] Failed to record a provider error.');
      }
      if (rateLimited) {
        const decision = getCooldownDecisionForLimit(
          route.platform,
          route.modelId,
          route.keyId,
          { rpd: route.rpdLimit, tpd: route.tpdLimit },
          typeof details.retryAfterMs === 'number' ? details.retryAfterMs : null,
          { quotaSignal: true },
        );
        setCooldown(route.platform, route.modelId, route.keyId, decision.durationMs, decision.source);
        if (attribution !== 'provider_moment') recordRateLimitHit(route.modelDbId);
      }
      lastFailure = { rateLimited, message: safeMessage };
    } finally {
      route.release?.();
    }
  }

  if (routedCount === 0) {
    res.status(429).json({
      error: { message: 'Ulangan modellar hozir band yoki limitga yetgan. Keyinroq qayta urinib ko‘ring.', type: 'rate_limit_error' },
    });
    return;
  }
  if (lastFailure?.rateLimited) {
    res.status(429).json({
      error: { message: 'Provayder limitlari vaqtincha to‘ldi. Birozdan keyin qayta urinib ko‘ring.', type: 'rate_limit_error' },
    });
    return;
  }
  res.status(502).json({
    error: { message: lastFailure?.message ?? 'Ulangan modellar hozir javob bera olmadi. Keyinroq urinib ko‘ring.', type: 'provider_error' },
  });
});
