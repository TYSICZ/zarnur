import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Express } from 'express';
import type { ChatCompletionResponse } from '@freellmapi/shared/types.js';
import { createApp } from '../../app.js';
import { initDb, getDb } from '../../db/index.js';
import { getAllProviders } from '../../providers/index.js';

async function call(
  app: Express,
  method: string,
  path: string,
  body?: unknown,
  extraHeaders: Record<string, string> = {},
) {
  const server = app.listen(0, '127.0.0.1');
  if (!server.listening) await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Test server did not bind to a TCP port');
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}${path}`, {
      method,
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...extraHeaders },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: response.status, body: await response.json() as unknown };
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}

describe('Public BYOK chat API', () => {
  let app: Express;

  beforeAll(() => {
    process.env.ENCRYPTION_KEY = '0'.repeat(64);
    initDb(':memory:');
    app = createApp();
  });

  afterEach(() => vi.restoreAllMocks());

  it('lists only enabled chat models from key-based built-in providers without a dashboard session', async () => {
    const response = await call(app, 'GET', '/api/public/chat/models');
    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('models');
    const models = (response.body as { models: Array<{ platform: string }> }).models;
    expect(models.length).toBeGreaterThan(0);
    expect(models.every(model => model.platform !== 'custom')).toBe(true);
  });

  it('forwards a visitor-supplied key without saving or returning it', async () => {
    const db = getDb();
    const eligibleProvider = getAllProviders().find(provider => {
      if (provider.platform === 'custom' || provider.keyless || provider.supportsChat === false) return false;
      return !!db.prepare('SELECT 1 FROM models WHERE platform = ? AND enabled = 1 LIMIT 1').get(provider.platform);
    });
    if (!eligibleProvider) throw new Error('Expected at least one enabled built-in chat model');
    const model = db.prepare(`
      SELECT model_id FROM models WHERE platform = ? AND enabled = 1 LIMIT 1
    `).get(eligibleProvider.platform) as { model_id: string };
    const apiKey = 'visitor-test-key-not-for-storage';
    const result: ChatCompletionResponse = {
      id: 'public-test',
      object: 'chat.completion',
      created: 1,
      model: model.model_id,
      choices: [{ index: 0, message: { role: 'assistant', content: 'Salom!' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    };
    const completion = vi.spyOn(eligibleProvider, 'chatCompletion').mockResolvedValue(result);
    const keyCountBefore = (db.prepare('SELECT COUNT(*) AS count FROM api_keys').get() as { count: number }).count;

    const response = await call(app, 'POST', '/api/public/chat/completions', {
      platform: eligibleProvider.platform,
      modelId: model.model_id,
      apiKey,
      messages: [{ role: 'user', content: 'Salom' }],
    });

    expect(response.status).toBe(200);
    expect(response.body).toEqual(result);
    expect(JSON.stringify(response.body)).not.toContain(apiKey);
    expect(completion).toHaveBeenCalledWith(
      apiKey,
      [{ role: 'user', content: 'Salom' }],
      model.model_id,
      { max_tokens: 1024, temperature: undefined },
    );
    expect((db.prepare('SELECT COUNT(*) AS count FROM api_keys').get() as { count: number }).count)
      .toBe(keyCountBefore);
  });

  it('rejects custom endpoints and oversized chat payloads', async () => {
    const unsupported = await call(app, 'POST', '/api/public/chat/completions', {
      platform: 'custom',
      modelId: 'private-endpoint-model',
      apiKey: 'visitor-key',
      messages: [{ role: 'user', content: 'Hello' }],
    });
    expect(unsupported.status).toBe(400);

    const oversized = await call(app, 'POST', '/api/public/chat/completions', {
      platform: 'google',
      modelId: 'gemini-test',
      apiKey: 'visitor-key',
      messages: [{ role: 'user', content: 'x'.repeat(140 * 1024) }],
    });
    expect(oversized.status).toBe(413);
  });

  it('requires HTTPS for visitors opening the chat from a non-local HTTP site', async () => {
    const response = await call(app, 'POST', '/api/public/chat/completions', {
      platform: 'google',
      modelId: 'gemini-test',
      apiKey: 'visitor-key',
      messages: [{ role: 'user', content: 'Hello' }],
    }, { Origin: 'http://192.168.0.20:5173' });

    expect(response.status).toBe(426);
    expect(JSON.stringify(response.body)).toContain('https_required');
  });
});
