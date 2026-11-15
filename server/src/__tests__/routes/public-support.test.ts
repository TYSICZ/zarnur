import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { Express } from 'express';
import type { ChatCompletionResponse } from '@freellmapi/shared/types.js';
import { createApp } from '../../app.js';
import { getDb, initDb } from '../../db/index.js';
import { getAllProviders } from '../../providers/index.js';

async function call(
  app: Express,
  method: string,
  path: string,
  options: { body?: unknown; cookie?: string; token?: string; userAgent?: string } = {},
) {
  const server = app.listen(0, '127.0.0.1');
  if (!server.listening) await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Test server did not bind to a TCP port');
  try {
    const headers: Record<string, string> = {};
    if (options.body !== undefined) headers['Content-Type'] = 'application/json';
    if (options.cookie) headers.Cookie = options.cookie;
    if (options.token) headers.Authorization = `Bearer ${options.token}`;
    if (options.userAgent) headers['User-Agent'] = options.userAgent;
    const response = await fetch(`http://127.0.0.1:${address.port}${path}`, {
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    return {
      status: response.status,
      body: await response.json() as unknown,
      setCookie: response.headers.get('set-cookie'),
    };
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}

describe('Zarnur public visitor support', () => {
  let app: Express;
  let adminToken = '';

  beforeAll(async () => {
    process.env.ENCRYPTION_KEY = '0'.repeat(64);
    initDb(':memory:');
    app = createApp();
    const setup = await call(app, 'POST', '/api/auth/setup', {
      body: { email: 'owner@example.com', password: 'owner-pass-123' },
    });
    adminToken = (setup.body as { token: string }).token;
  });

  it('tracks consented visitors anonymously and lets the owner answer support messages', async () => {
    const denied = await call(app, 'POST', '/api/public/visitors/visit', { body: { consent: false } });
    expect(denied.status).toBe(400);

    const consent = await call(app, 'POST', '/api/public/visitors/visit', {
      body: { consent: true },
      userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8 Pro) AppleWebKit/537.36 Mobile Safari/537.36',
    });
    expect(consent.status).toBe(200);
    expect(consent.setCookie).toContain('zarnur_visitor=');
    expect(consent.setCookie).toContain('HttpOnly');
    const cookie = consent.setCookie?.split(';')[0];
    if (!cookie) throw new Error('Expected the visitor session cookie');

    const visitor = getDb().prepare(`
      SELECT device_type, operating_system FROM zarnur_visitors LIMIT 1
    `).get() as { device_type: string; operating_system: string };
    expect(visitor).toEqual({ device_type: 'phone', operating_system: 'Android' });
    expect(JSON.stringify(visitor)).not.toContain('Pixel');

    const unauthenticated = await call(app, 'GET', '/api/support/overview');
    expect(unauthenticated.status).toBe(401);

    const sent = await call(app, 'POST', '/api/public/support/messages', {
      body: { content: 'Google API kalitini qayerdan olaman?' },
      cookie,
    });
    expect(sent.status).toBe(201);

    const provider = getAllProviders().find(candidate =>
      candidate.platform !== 'custom' &&
      !candidate.keyless &&
      candidate.supportsChat !== false &&
      getDb().prepare('SELECT 1 FROM models WHERE platform = ? AND enabled = 1 LIMIT 1').get(candidate.platform),
    );
    if (!provider) throw new Error('Expected at least one enabled provider');
    const model = getDb().prepare(
      'SELECT model_id FROM models WHERE platform = ? AND enabled = 1 LIMIT 1',
    ).get(provider.platform) as { model_id: string };
    const completion: ChatCompletionResponse = {
      id: 'visitor-completion',
      object: 'chat.completion',
      created: 1,
      model: model.model_id,
      choices: [{ index: 0, message: { role: 'assistant', content: 'Salom' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    };
    vi.spyOn(provider, 'chatCompletion').mockResolvedValue(completion);
    const aiResponse = await call(app, 'POST', '/api/public/chat/completions', {
      body: {
        platform: provider.platform,
        modelId: model.model_id,
        apiKey: 'visitor-key',
        messages: [{ role: 'user', content: 'Salom' }],
      },
      cookie,
    });
    expect(aiResponse.status, JSON.stringify(aiResponse.body)).toBe(200);

    const overview = await call(app, 'GET', '/api/support/overview', { token: adminToken });
    expect(overview.status).toBe(200);
    expect(overview.body).toMatchObject({ visitors: 1, aiUsers: 1, aiUses: 1, unreadMessages: 1 });

    const visitorList = await call(app, 'GET', '/api/support/visitors', { token: adminToken });
    expect(JSON.stringify(visitorList.body)).toContain('"deviceType":"phone"');
    expect(JSON.stringify(visitorList.body)).not.toContain('Pixel');

    const inbox = await call(app, 'GET', '/api/support/threads', { token: adminToken });
    const thread = (inbox.body as { threads: Array<{ visitorId: number; deviceType: string; operatingSystem: string }> }).threads[0];
    expect(thread).toMatchObject({ deviceType: 'phone', operatingSystem: 'Android' });
    expect(JSON.stringify(thread)).not.toContain('Pixel');

    const replied = await call(app, 'POST', `/api/support/threads/${thread.visitorId}/messages`, {
      body: { content: 'Google AI Studio saytida API key yarating.' },
      token: adminToken,
    });
    expect(replied.status).toBe(201);

    const conversation = await call(app, 'GET', '/api/public/support/messages', { cookie });
    expect(conversation.status).toBe(200);
    expect(JSON.stringify(conversation.body)).toContain('Google AI Studio');
  });
});
