import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { getDb } from '../db/index.js';
import { sanitizeProviderErrorMessage } from '../lib/error-redaction.js';
import { safeHeaderValue } from '../lib/header-value.js';
import { parseModelScope } from '../lib/model-scope.js';
import { runVideoGeneration, MediaError } from '../services/media.js';
import type { SessionUser } from '../services/auth.js';
import { DAILY_MEMBER_LIMIT, markMemberRequestSucceeded, recordMemberRequest } from './member-chat.js';
import { isSecureChatRequest } from './public-chat.js';

export const memberVideoRouter = Router();

const FREE_VIDEO_PLATFORM = 'novai';
const FREE_VIDEO_MODEL = 'cogvideox-flash';

interface VideoModelRow {
  id: number;
  platform: string;
  model_id: string;
  display_name: string;
  quota_label: string | null;
  key_id: number | null;
}

interface SharedVideoModel extends VideoModelRow {
  allowedKeyIds: Set<number>;
}

function getSharedVideoModels(): SharedVideoModel[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT id, platform, model_id, display_name, quota_label, key_id
      FROM media_models
     WHERE modality = 'video' AND enabled = 1
       AND platform = ? AND model_id = ?
     ORDER BY priority, id
  `).all(FREE_VIDEO_PLATFORM, FREE_VIDEO_MODEL) as VideoModelRow[];
  const keys = db.prepare(`
    SELECT id, model_scope_json
      FROM api_keys
     WHERE platform = ? AND share_with_members = 1
       AND enabled = 1 AND status IN ('healthy', 'unknown')
  `).all(FREE_VIDEO_PLATFORM) as Array<{ id: number; model_scope_json: string | null }>;

  return rows.flatMap(row => {
    const allowedKeyIds = new Set<number>();
    for (const key of keys) {
      const scope = parseModelScope(key.model_scope_json);
      if ((row.key_id === null || key.id === row.key_id) && (!scope || scope.has(row.model_id))) {
        allowedKeyIds.add(key.id);
      }
    }
    return allowedKeyIds.size > 0 ? [{ ...row, allowedKeyIds }] : [];
  });
}

const generationSchema = z.object({
  modelDbId: z.number().int().positive(),
  prompt: z.string().trim().min(1).max(2000),
}).strict();

function userFromRequest(req: Request): SessionUser | undefined {
  return (req as Request & { user?: SessionUser }).user;
}

memberVideoRouter.get('/models', (_req: Request, res: Response) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({
    models: getSharedVideoModels().map(model => ({
      id: model.id,
      modelId: model.model_id,
      displayName: model.display_name,
      provider: 'NovAI',
      quotaLabel: model.quota_label,
    })),
  });
});

memberVideoRouter.post('/generations', async (req: Request, res: Response) => {
  if (!isSecureChatRequest(req)) {
    res.status(426).json({
      error: { message: 'HTTPS is required before generating a video.', type: 'https_required' },
    });
    return;
  }
  const parsed = generationSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: { message: 'Prompt and video model are required.', type: 'invalid_request_error' },
    });
    return;
  }

  const user = userFromRequest(req);
  if (!user) {
    res.status(401).json({ error: { message: 'Authentication required', type: 'authentication_error' } });
    return;
  }
  const model = getSharedVideoModels().find(item => item.id === parsed.data.modelDbId);
  if (!model) {
    res.status(404).json({
      error: { message: 'A free video model is not currently shared by the administrator.', type: 'model_not_found' },
    });
    return;
  }

  if (!recordMemberRequest(user.userId)) {
    const tomorrow = new Date();
    tomorrow.setUTCHours(24, 0, 0, 0);
    res.setHeader('Retry-After', String(Math.max(1, Math.ceil((tomorrow.getTime() - Date.now()) / 1000))));
    res.status(429).json({
      error: { message: `Kunlik bepul limit ${DAILY_MEMBER_LIMIT} ta chat/video so‘rovi. Ertaga qayta urinib ko‘ring.`, type: 'rate_limit_error' },
    });
    return;
  }

  const clientAbort = new AbortController();
  res.on('close', () => {
    if (!res.writableEnded) clientAbort.abort();
  });

  try {
    const result = await runVideoGeneration(model.model_id, { prompt: parsed.data.prompt }, clientAbort.signal, {
      allowedPlatforms: new Set([FREE_VIDEO_PLATFORM]),
      allowedKeyIds: model.allowedKeyIds,
    });
    markMemberRequestSucceeded(user.userId);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', result.contentType);
    res.setHeader('X-Provider', safeHeaderValue(result.platform));
    res.setHeader('X-Model', safeHeaderValue(result.modelId));
    res.send(result.video);
  } catch (error) {
    if (clientAbort.signal.aborted || res.writableEnded) return;
    const mediaError = error instanceof MediaError ? error : null;
    const status = mediaError?.status ?? 502;
    if (typeof mediaError?.retryAfterMs === 'number') {
      res.setHeader('Retry-After', String(Math.max(1, Math.ceil(mediaError.retryAfterMs / 1000))));
    }
    res.status(status >= 400 && status < 600 ? status : 502).json({
      error: {
        message: status === 429
          ? 'NovAI bepul video kvotasi hozir tugagan yoki ulashilgan kalit limiti yetgan. Keyinroq qayta urinib ko‘ring.'
          : sanitizeProviderErrorMessage(error instanceof Error ? error.message : String(error)),
        type: status === 429 ? 'rate_limit_error' : 'provider_error',
      },
    });
  }
});
