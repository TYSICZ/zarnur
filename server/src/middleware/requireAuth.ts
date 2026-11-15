import type { Request, Response, NextFunction } from 'express';
import { validateSession, type SessionUser } from '../services/auth.js';

const SESSION_COOKIE_NAME = 'zarnur_session';

function cookieToken(req: Request): string | undefined {
  const cookieHeader = req.headers.cookie;
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(';')) {
    const [name, ...value] = part.trim().split('=');
    if (name === SESSION_COOKIE_NAME) {
      try { return decodeURIComponent(value.join('=')); } catch { return undefined; }
    }
  }
  return undefined;
}

function sessionFromRequest(req: Request, allowCookie = true): SessionUser | null {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '')
    ?? (req.headers['x-dashboard-token'] as string | undefined);
  const session = validateSession(token);
  if (session || !allowCookie) return session;
  return validateSession(cookieToken(req));
}

export function requireUser(req: Request, res: Response, next: NextFunction): void {
  const session = sessionFromRequest(req);
  if (!session) {
    res.status(401).json({ error: { message: 'Authentication required', type: 'authentication_error' } });
    return;
  }
  (req as Request & { user?: SessionUser }).user = session;
  next();
}

// Gate the /api/* admin surface behind a dashboard session (#35, item #2).
// The token is the opaque session token issued by /api/auth/login|setup, sent
// as `Authorization: Bearer <token>`. The /v1 proxy is NOT gated by this — it
// keeps its own unified-API-key auth for app clients.
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const session = sessionFromRequest(req, false);
  if (!session) {
    res.status(401).json({ error: { message: 'Authentication required', type: 'authentication_error' } });
    return;
  }
  if (session.role !== 'admin') {
    res.status(403).json({ error: { message: 'Administrator access required', type: 'authorization_error' } });
    return;
  }
  (req as Request & { user?: SessionUser }).user = session;
  next();
}
