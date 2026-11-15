import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { getDb } from '../db/index.js';
import type { SessionUser } from '../services/auth.js';

export const zarnurAdminRouter = Router();

const memberStatusSchema = z.object({ disabled: z.boolean() }).strict();

zarnurAdminRouter.get('/users', (_req: Request, res: Response) => {
  const users = getDb().prepare(`
    SELECT u.id, u.email, u.role, u.disabled_at, u.created_at,
           COALESCE((
             SELECT usage.request_count
               FROM zarnur_member_chat_usage usage
              WHERE usage.user_id = u.id AND usage.day = date('now')
           ), 0) AS requests_today
      FROM users u
     ORDER BY CASE u.role WHEN 'admin' THEN 0 ELSE 1 END, u.created_at DESC
  `).all() as Array<{
    id: number;
    email: string;
    role: 'admin' | 'user';
    disabled_at: string | null;
    created_at: string;
    requests_today: number;
  }>;
  res.json({
    users: users.map(user => ({
      id: user.id,
      email: user.email,
      role: user.role,
      disabled: user.disabled_at !== null,
      createdAt: user.created_at,
      requestsToday: user.requests_today,
    })),
  });
});

zarnurAdminRouter.patch('/users/:id', (req: Request, res: Response) => {
  const id = Number.parseInt(req.params.id as string, 10);
  if (!Number.isSafeInteger(id) || id < 1) {
    res.status(400).json({ error: { message: 'Invalid user ID', type: 'invalid_request_error' } });
    return;
  }
  const parsed = memberStatusSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: { message: parsed.error.issues.map(issue => issue.message).join(', '), type: 'invalid_request_error' },
    });
    return;
  }
  const admin = (req as Request & { user?: SessionUser }).user;
  const db = getDb();
  const user = db.prepare('SELECT id, role FROM users WHERE id = ?').get(id) as
    { id: number; role: 'admin' | 'user' } | undefined;
  if (!user) {
    res.status(404).json({ error: { message: 'User not found', type: 'not_found' } });
    return;
  }
  if (user.role !== 'user' || admin?.userId === id) {
    res.status(400).json({ error: { message: 'Administrator accounts cannot be disabled here.', type: 'invalid_request_error' } });
    return;
  }

  db.transaction(() => {
    db.prepare('UPDATE users SET disabled_at = ? WHERE id = ?')
      .run(parsed.data.disabled ? new Date().toISOString() : null, id);
    if (parsed.data.disabled) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
  })();
  res.json({ success: true, disabled: parsed.data.disabled });
});
