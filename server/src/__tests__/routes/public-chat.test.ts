import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Express } from 'express';
import type { ChatCompletionResponse } from '@freellmapi/shared/types.js';
import { createApp } from '../../app.js';
import { initDb, getDb } from '../../db/index.js';
import { getAllProviders } from '../../providers/index.js';
import { ZARNUR_DEFAULT_TEMPERATURE, ZARNUR_SYSTEM_PROMPT } from '../../services/zarnur-chat.js';

const FREE_MODEL_ID = 'nvidia/nemotron-3.5-lightning:free';
const kiloCatalog = {
  data: [{
    id: FREE_MODEL_ID,
    name: 'NVIDIA: Nemotron 3.5 Lightning (free)',
    isFree: true,
    pricing: { prompt: '0', completion: '0' },
    architecture: { input_modalities: ['text'], output_modalities: ['text'] },
    preferredIndex: 1,
  }, {
    id: 'legacy/paid-route:free',
    name: 'Legacy paid route',
    isFree: false,
    pricing: { prompt: '0.1', completion: '0.2' },
    architecture: { input_modalities: ['text'], output_modalities: ['text'] },
    preferredIndex: 0,
  }, {
    id: 'images/only-free:free',
    name: 'Image output model',
    isFree: true,
    pricing: { prompt: '0', completion: '0' },
    architecture: { input_modalities: ['image'], output_modalities: ['image'] },
    preferredIndex: 2,
  }],
};

function mockKiloCatalog() {
  const nativeFetch = globalThis.fetch;
  vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
    if (String(input) === 'https://api.kilo.ai/api/gateway/models') {
      return Promise.resolve(new Response(JSON.stringify(kiloCatalog), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }));
    }
    return nativeFetch(input, init);
  });
}

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

describe('Public Zarnur chat API', () => {
  let app: Express;

  beforeAll(() => {
    process.env.ENCRYPTION_KEY = '0'.repeat(64);
    initDb(':memory:');
    app = createApp();
  });

  afterEach(() => vi.restoreAllMocks());

  it('lists only enabled free Kilo models without a dashboard session', async () => {
    mockKiloCatalog();
    const response = await call(app, 'GET', '/api/public/chat/models');
    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('models');
    const models = (response.body as { models: Array<{ platform: string; modelId: string }> }).models;
    expect(models.length).toBeGreaterThan(0);
    expect(models).toEqual([expect.objectContaining({ platform: 'kilo', modelId: FREE_MODEL_ID })]);
  });

  it('uses anonymous free model access without requesting or storing a visitor key', async () => {
    mockKiloCatalog();
    const db = getDb();
    const provider = getAllProviders().find(candidate => candidate.platform === 'kilo');
    if (!provider) throw new Error('Expected the Kilo provider to be registered');
    const result: ChatCompletionResponse = {
      id: 'public-test',
      object: 'chat.completion',
      created: 1,
      model: FREE_MODEL_ID,
      choices: [{ index: 0, message: { role: 'assistant', content: 'Salom!' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    };
    const completion = vi.spyOn(provider, 'chatCompletion').mockResolvedValue(result);
    const keyCountBefore = (db.prepare('SELECT COUNT(*) AS count FROM api_keys').get() as { count: number }).count;

    const response = await call(app, 'POST', '/api/public/chat/completions', {
      platform: 'kilo',
      modelId: FREE_MODEL_ID,
      messages: [{ role: 'user', content: 'Salom' }],
    });

    expect(response.status).toBe(200);
    expect(response.body).toEqual(result);
    expect(completion).toHaveBeenCalledWith(
      'no-key',
      [
        { role: 'system', content: ZARNUR_SYSTEM_PROMPT },
        { role: 'user', content: 'Salom' },
      ],
      FREE_MODEL_ID,
      { max_tokens: 512, temperature: ZARNUR_DEFAULT_TEMPERATURE },
    );
    expect((db.prepare('SELECT COUNT(*) AS count FROM api_keys').get() as { count: number }).count)
      .toBe(keyCountBefore);
  });

  it('rejects visitor-supplied keys, non-Kilo providers, and oversized payloads', async () => {
    mockKiloCatalog();
    const unsupported = await call(app, 'POST', '/api/public/chat/completions', {
      platform: 'custom',
      modelId: 'private-endpoint-model',
      apiKey: 'visitor-key',
      messages: [{ role: 'user', content: 'Hello' }],
    });
    expect(unsupported.status).toBe(400);

    const visitorKey = await call(app, 'POST', '/api/public/chat/completions', {
      platform: 'kilo',
      modelId: FREE_MODEL_ID,
      apiKey: 'must-not-be-accepted',
      messages: [{ role: 'user', content: 'Hello' }],
    });
    expect(visitorKey.status).toBe(400);

    const retiredFreeId = await call(app, 'POST', '/api/public/chat/completions', {
      platform: 'kilo',
      modelId: 'legacy/paid-route:free',
      messages: [{ role: 'user', content: 'Hello' }],
    });
    expect(retiredFreeId.status).toBe(400);

    const oversized = await call(app, 'POST', '/api/public/chat/completions', {
      platform: 'kilo',
      modelId: FREE_MODEL_ID,
      messages: [{ role: 'user', content: 'x'.repeat(140 * 1024) }],
    });
    expect(oversized.status).toBe(413);
  });

  it('requires HTTPS for visitors opening the chat from a non-local HTTP site', async () => {
    const response = await call(app, 'POST', '/api/public/chat/completions', {
      platform: 'kilo',
      modelId: FREE_MODEL_ID,
      messages: [{ role: 'user', content: 'Hello' }],
    }, { Origin: 'http://192.168.0.20:5173' });

    expect(response.status).toBe(426);
    expect(JSON.stringify(response.body)).toContain('https_required');
  });
});
