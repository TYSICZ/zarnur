import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Express } from 'express';
import { createApp } from '../../app.js';
import { initDb, getDb } from '../../db/index.js';
import { encrypt } from '../../lib/crypto.js';
import { createSession, createUser } from '../../services/auth.js';
import * as guard from '../../lib/url-guard.js';

const mp4 = Buffer.alloc(64);
mp4.write('ftyp', 4);
const outputUrl = 'https://aiapi-pro.com/video.mp4?signature=test';

async function call(app: Express, method: string, path: string, body?: unknown, token?: string) {
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
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { response, bytes: Buffer.from(await response.arrayBuffer()) };
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}

function seedVideoModel() {
  return Number(getDb().prepare(`
    INSERT INTO media_models (platform, model_id, display_name, modality, priority, enabled, quota_label)
    VALUES ('novai', 'cogvideox-flash', 'CogVideoX Flash', 'video', 1, 1, 'Daily free quota')
  `).run().lastInsertRowid);
}

function addKey(platform: string, key: string, shared: boolean) {
  const encrypted = encrypt(key);
  return Number(getDb().prepare(`
    INSERT INTO api_keys (platform, label, encrypted_key, iv, auth_tag, status, enabled, share_with_members)
    VALUES (?, 'test', ?, ?, ?, 'healthy', 1, ?)
  `).run(platform, encrypted.encrypted, encrypted.iv, encrypted.authTag, shared ? 1 : 0).lastInsertRowid);
}

function mockProviderFetch(responses: Response[]) {
  const localFetch = globalThis.fetch;
  const providerCalls: Array<{ url: string; init?: RequestInit }> = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    if (new URL(url).hostname === '127.0.0.1') return localFetch(input, init);
    providerCalls.push({ url, init });
    const response = responses.shift();
    if (!response) throw new Error(`Unexpected provider request to ${url}`);
    return response;
  });
  return providerCalls;
}

describe('Zarnur member video generation', () => {
  let app: Express;
  let memberId: number;
  let memberToken: string;

  beforeEach(() => {
    process.env.ENCRYPTION_KEY = '0'.repeat(64);
    initDb(':memory:');
    app = createApp();
    const member = createUser('video-member@example.com', 'member-password', 'user');
    memberId = member.userId;
    memberToken = createSession(member.userId);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    getDb().close();
  });

  it('only lists a free NovAI model when an eligible shared key exists', async () => {
    seedVideoModel();
    addKey('novai', 'private-novai-key', false);
    const { response, bytes } = await call(app, 'GET', '/api/member/video/models', undefined, memberToken);
    expect(response.status).toBe(200);
    expect(JSON.parse(bytes.toString())).toEqual({ models: [] });

    addKey('novai', 'shared-novai-key', true);
    const listed = await call(app, 'GET', '/api/member/video/models', undefined, memberToken);
    expect(listed.response.status).toBe(200);
    expect(JSON.parse(listed.bytes.toString())).toEqual({
      models: [expect.objectContaining({ modelId: 'cogvideox-flash', provider: 'NovAI' })],
    });
    expect(listed.bytes.toString()).not.toContain('shared-novai-key');
  });

  it('requires an authenticated member session', async () => {
    const { response } = await call(app, 'GET', '/api/member/video/models');
    expect(response.status).toBe(401);
  });

  it('returns a real MP4 through shared free NovAI only, never a paid fallback', async () => {
    const modelDbId = seedVideoModel();
    addKey('novai', 'private-novai-key', false);
    addKey('novai', 'shared-novai-key', true);
    addKey('varosity', 'paid-fallback-key', true);
    getDb().prepare(`
      INSERT INTO media_models (platform, model_id, display_name, modality, priority, enabled, quota_label)
      VALUES ('varosity', 'cogvideox-flash', 'Paid fallback', 'video', 2, 1, 'credits')
    `).run();
    vi.spyOn(guard, 'assessProviderUrl').mockResolvedValue({ allowed: true });
    const providerCalls = mockProviderFetch([
      new Response(JSON.stringify({
        id: 'job-1',
        task_status: 'SUCCESS',
        model: 'cogvideox-flash',
        video_result: [{ url: outputUrl }],
      }), { headers: { 'Content-Type': 'application/json' } }),
      new Response(mp4, { headers: { 'Content-Type': 'video/mp4' } }),
    ]);

    const { response, bytes } = await call(app, 'POST', '/api/member/video/generations', {
      modelDbId,
      prompt: 'A slow sunrise above a quiet lake',
    }, memberToken);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('video/mp4');
    expect(response.headers.get('x-provider')).toBe('novai');
    expect(bytes).toEqual(mp4);
    expect(providerCalls).toHaveLength(2);
    expect(providerCalls[0].url).toContain('aiapi-pro.com/v1/video/generations');
    expect(providerCalls.some(call => call.url.includes('aiapi-pro.com'))).toBe(true);
    expect(providerCalls.every(call => !call.url.includes('varosity'))).toBe(true);
    expect(JSON.parse(String(providerCalls[0].init?.body))).toMatchObject({
      prompt: 'A slow sunrise above a quiet lake',
      model: 'cogvideox-flash',
    });
    expect(getDb().prepare(`
      SELECT request_count, success_count
        FROM zarnur_member_chat_usage
       WHERE user_id = ? AND day = date('now')
    `).get(memberId)).toEqual({ request_count: 1, success_count: 1 });
  });

  it('enforces the shared daily member cap before calling a provider', async () => {
    const modelDbId = seedVideoModel();
    addKey('novai', 'shared-novai-key', true);
    getDb().prepare(`
      INSERT INTO zarnur_member_chat_usage (user_id, day, request_count)
      VALUES (?, date('now'), 30)
    `).run(memberId);
    const providerCalls = mockProviderFetch([]);

    const { response } = await call(app, 'POST', '/api/member/video/generations', {
      modelDbId,
      prompt: 'A quiet lake',
    }, memberToken);

    expect(response.status).toBe(429);
    expect(providerCalls).toHaveLength(0);
  });
});
