import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Express } from 'express';
import type { ChatCompletionResponse } from '@freellmapi/shared/types.js';
import { createApp } from '../../app.js';
import { initDb, getDb } from '../../db/index.js';
import { encrypt } from '../../lib/crypto.js';
import { getAllProviders } from '../../providers/index.js';
import { createSession, createUser } from '../../services/auth.js';

async function call(
  app: Express,
  method: string,
  path: string,
  body?: unknown,
  token?: string,
  extraHeaders: Record<string, string> = {},
) {
  const server = app.listen(0, '127.0.0.1');
  if (!server.listening) await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Test server did not bind to a TCP port');
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}${path}`, {
      method,
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...extraHeaders,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: response.status, body: await response.json() as unknown };
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}

describe('Zarnur member accounts and shared models', () => {
  let app: Express;
  let adminToken: string;

  beforeAll(() => {
    process.env.ENCRYPTION_KEY = '0'.repeat(64);
    initDb(':memory:');
    app = createApp();
    const admin = createUser('zarnur-owner@example.com', 'password123');
    adminToken = createSession(admin.userId);
  });

  afterEach(() => vi.restoreAllMocks());

  it('creates member accounts without granting access to the owner dashboard and supports suspension', async () => {
    const response = await call(app, 'POST', '/api/auth/register', {
      email: 'zarnur-member@example.com',
      password: 'member-password',
    });
    expect(response.status).toBe(201);
    const auth = response.body as { token: string; role: string };
    expect(auth.role).toBe('user');

    expect((await call(app, 'GET', '/api/keys', undefined, auth.token)).status).toBe(403);
    expect((await call(app, 'GET', '/api/keys', undefined, undefined, {
      Cookie: `zarnur_session=${adminToken}`,
    })).status).toBe(401);
    const status = await call(app, 'GET', '/api/auth/status', undefined, auth.token);
    expect(status.body).toMatchObject({ authenticated: true, role: 'user' });
    expect((await call(app, 'GET', '/api/member/chat/models', undefined, undefined, {
      Cookie: `zarnur_session=${auth.token}`,
    })).status).toBe(200);

    const user = getDb().prepare("SELECT id FROM users WHERE email = 'zarnur-member@example.com'").get() as { id: number };
    const disabled = await call(app, 'PATCH', `/api/admin/users/${user.id}`, { disabled: true }, adminToken);
    expect(disabled.status).toBe(200);
    expect((await call(app, 'GET', '/api/auth/status', undefined, auth.token)).body)
      .toMatchObject({ authenticated: false });
    expect((await call(app, 'PATCH', `/api/admin/users/${user.id}`, { disabled: false }, adminToken)).status).toBe(200);
    expect((await call(app, 'GET', '/api/auth/status', undefined, auth.token)).body)
      .toMatchObject({ authenticated: false });
  });

  it('routes member chat only through keys the admin explicitly shared', async () => {
    const user = createUser('zarnur-chat-member@example.com', 'member-password', 'user');
    const token = createSession(user.userId);
    const model = getDb().prepare(`
      SELECT id, platform, model_id
        FROM models
       WHERE enabled = 1 AND platform IN ('groq', 'google', 'gemini')
       ORDER BY platform, id
       LIMIT 1
    `).get() as { id: number; platform: string; model_id: string } | undefined;
    if (!model) throw new Error('Expected at least one enabled Groq or Google chat model');

    getDb().prepare(`
      UPDATE models
         SET rpm_limit = NULL, rpd_limit = NULL, tpm_limit = NULL, tpd_limit = NULL
       WHERE id = ?
    `).run(model.id);
    const provider = getAllProviders().find(candidate => candidate.platform === model.platform);
    if (!provider) throw new Error(`Expected provider ${model.platform} to be registered`);
    const result: ChatCompletionResponse = {
      id: 'member-test',
      object: 'chat.completion',
      created: 1,
      model: model.model_id,
      choices: [{ index: 0, message: { role: 'assistant', content: 'Salom!' }, finish_reason: 'stop' }],
    };
    const completion = vi.spyOn(provider, 'chatCompletion').mockResolvedValue(result);
    const addKey = (label: string, key: string, shared: boolean): number => {
      const encrypted = encrypt(key);
      const inserted = getDb().prepare(`
        INSERT INTO api_keys (platform, label, encrypted_key, iv, auth_tag, status, enabled, share_with_members)
        VALUES (?, ?, ?, ?, ?, 'healthy', 1, ?)
      `).run(model.platform, label, encrypted.encrypted, encrypted.iv, encrypted.authTag, shared ? 1 : 0);
      return Number(inserted.lastInsertRowid);
    };
    const privateKeyId = addKey('private-key', 'private-provider-secret', false);
    addKey('shared-key', 'shared-provider-secret', true);

    const listed = await call(app, 'GET', '/api/member/chat/models', undefined, token);
    expect(listed.status).toBe(200);
    expect(JSON.stringify(listed.body)).not.toContain('shared-provider-secret');
    expect(listed.body).toMatchObject({
      models: expect.arrayContaining([
        expect.objectContaining({ id: model.id, modelId: model.model_id }),
      ]),
    });

    const response = await call(app, 'POST', '/api/member/chat/completions', {
      modelDbId: model.id,
      messages: [{ role: 'user', content: 'Salom' }],
    }, token);
    expect(response.status).toBe(200);
    expect(response.body).toEqual(result);
    expect(completion).toHaveBeenCalledWith(
      'shared-provider-secret',
      [expect.objectContaining({ role: 'system' }), { role: 'user', content: 'Salom' }],
      model.model_id,
      { max_tokens: 512, temperature: undefined },
    );
    expect(JSON.stringify(response.body)).not.toContain('private-provider-secret');
    expect(JSON.stringify(response.body)).not.toContain('shared-provider-secret');

    const shared = await call(app, 'PATCH', `/api/keys/${privateKeyId}`, { shareWithMembers: true }, adminToken);
    expect(shared.body).toMatchObject({ success: true, shareWithMembers: true });
    const keys = await call(app, 'GET', '/api/keys', undefined, adminToken);
    expect(keys.body).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: privateKeyId, shareWithMembers: true }),
    ]));
  });
});
