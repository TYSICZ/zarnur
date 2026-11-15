import crypto from 'node:crypto';
import type { Request, Response } from 'express';
import { getDb } from '../db/index.js';

const COOKIE_NAME = 'zarnur_visitor';
const COOKIE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

function visitorToken(req: Request): string | null {
  const cookie = req.headers.cookie;
  if (typeof cookie !== 'string') return null;

  for (const part of cookie.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0 || part.slice(0, separator).trim() !== COOKIE_NAME) continue;
    const token = part.slice(separator + 1).trim();
    return /^[a-f0-9]{64}$/i.test(token) ? token.toLowerCase() : null;
  }
  return null;
}

function tokenHash(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function isHttps(req: Request): boolean {
  const forwardedProto = String(req.headers['x-forwarded-proto'] ?? '')
    .split(',')[0]!.trim().toLowerCase();
  return req.secure || forwardedProto === 'https';
}

export function classifyVisitor(userAgent: string | undefined): {
  deviceType: 'phone' | 'tablet' | 'computer' | 'other';
  operatingSystem: 'Android' | 'iOS' | 'Windows' | 'macOS' | 'Linux' | 'other';
} {
  const ua = userAgent ?? '';
  let deviceType: 'phone' | 'tablet' | 'computer' | 'other' = 'other';
  if (/ipad|tablet|kindle|silk/i.test(ua) || (/android/i.test(ua) && !/mobile/i.test(ua))) {
    deviceType = 'tablet';
  } else if (/mobile|iphone|ipod|android/i.test(ua)) {
    deviceType = 'phone';
  } else if (/windows|macintosh|mac os|linux|x11/i.test(ua)) {
    deviceType = 'computer';
  }

  let operatingSystem: 'Android' | 'iOS' | 'Windows' | 'macOS' | 'Linux' | 'other' = 'other';
  if (/android/i.test(ua)) operatingSystem = 'Android';
  else if (/iphone|ipad|ipod/i.test(ua)) operatingSystem = 'iOS';
  else if (/windows/i.test(ua)) operatingSystem = 'Windows';
  else if (/macintosh|mac os/i.test(ua)) operatingSystem = 'macOS';
  else if (/linux|x11/i.test(ua)) operatingSystem = 'Linux';

  return { deviceType, operatingSystem };
}

export function registerZarnurVisitor(req: Request, res: Response): number {
  let token = visitorToken(req);
  if (!token) {
    token = crypto.randomBytes(32).toString('hex');
    const secure = isHttps(req) ? '; Secure' : '';
    res.append(
      'Set-Cookie',
      `${COOKIE_NAME}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${COOKIE_MAX_AGE_SECONDS}${secure}`,
    );
  }

  const hash = tokenHash(token);
  const device = classifyVisitor(req.headers['user-agent']);
  getDb().prepare(`
    INSERT INTO zarnur_visitors (token_hash, device_type, operating_system)
    VALUES (?, ?, ?)
    ON CONFLICT(token_hash) DO UPDATE SET
      last_seen_at = datetime('now'),
      device_type = excluded.device_type,
      operating_system = excluded.operating_system
  `).run(hash, device.deviceType, device.operatingSystem);

  const visitor = getDb().prepare(
    'SELECT id FROM zarnur_visitors WHERE token_hash = ?',
  ).get(hash) as { id: number };
  return visitor.id;
}

export function zarnurVisitorId(req: Request): number | null {
  const token = visitorToken(req);
  if (!token) return null;
  const visitor = getDb().prepare(
    'SELECT id FROM zarnur_visitors WHERE token_hash = ?',
  ).get(tokenHash(token)) as { id: number } | undefined;
  return visitor?.id ?? null;
}

export function recordZarnurAiUse(req: Request): void {
  const visitorId = zarnurVisitorId(req);
  if (visitorId !== null) {
    getDb().prepare(`
      UPDATE zarnur_visitors
      SET ai_uses = ai_uses + 1, last_seen_at = datetime('now')
      WHERE id = ?
    `).run(visitorId);
  }
}
