import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { getDb } from '../db/index.js';
import { registerZarnurVisitor, zarnurVisitorId } from '../services/zarnur-visitors.js';

export const publicVisitorRouter = Router();
export const publicSupportRouter = Router();
export const adminSupportRouter = Router();

const noStore = (_req: Request, res: Response, next: () => void) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
};

publicVisitorRouter.use(noStore);
publicVisitorRouter.post('/visit', (req: Request, res: Response) => {
  const parsed = z.object({ consent: z.literal(true) }).strict().safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: { message: 'Tracking consent is required', type: 'consent_required' } });
    return;
  }
  registerZarnurVisitor(req, res);
  res.json({ tracked: true });
});

publicSupportRouter.use(noStore);

publicSupportRouter.get('/messages', (req: Request, res: Response) => {
  const visitorId = zarnurVisitorId(req);
  if (visitorId === null) {
    res.status(401).json({ error: { message: 'Rozilikni tasdiqlab, qayta urinib ko‘ring.', type: 'visitor_session_required' } });
    return;
  }
  const messages = getDb().prepare(`
    SELECT id, sender, content, created_at AS createdAt
    FROM zarnur_support_messages
    WHERE visitor_id = ?
    ORDER BY id DESC
    LIMIT 100
  `).all(visitorId).reverse();
  res.json({ messages });
});

const messageSchema = z.object({
  content: z.string().trim().min(1).max(2000),
}).strict();

publicSupportRouter.post('/messages', (req: Request, res: Response) => {
  const visitorId = zarnurVisitorId(req);
  if (visitorId === null) {
    res.status(401).json({ error: { message: 'Avval maxfiylik roziligini tasdiqlang.', type: 'visitor_session_required' } });
    return;
  }
  const parsed = messageSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: { message: parsed.error.issues.map(issue => issue.message).join(', '), type: 'invalid_request_error' } });
    return;
  }
  getDb().prepare(`
    INSERT INTO zarnur_support_messages (visitor_id, sender, content)
    VALUES (?, 'visitor', ?)
  `).run(visitorId, parsed.data.content);
  getDb().prepare(`
    UPDATE zarnur_visitors SET last_seen_at = datetime('now') WHERE id = ?
  `).run(visitorId);
  res.status(201).json({ sent: true });
});

adminSupportRouter.use(noStore);

adminSupportRouter.get('/overview', (_req: Request, res: Response) => {
  const summary = getDb().prepare(`
    SELECT
      COUNT(*) AS visitors,
      COALESCE(SUM(CASE WHEN ai_uses > 0 THEN 1 ELSE 0 END), 0) AS aiUsers,
      COALESCE(SUM(ai_uses), 0) AS aiUses
    FROM zarnur_visitors
  `).get() as { visitors: number; aiUsers: number; aiUses: number };
  const unread = getDb().prepare(`
    SELECT COUNT(*) AS count
    FROM zarnur_support_messages
    WHERE sender = 'visitor' AND read_at IS NULL
  `).get() as { count: number };
  res.json({ ...summary, unreadMessages: unread.count });
});

adminSupportRouter.get('/threads', (_req: Request, res: Response) => {
  const threads = getDb().prepare(`
    SELECT
      v.id AS visitorId,
      v.device_type AS deviceType,
      v.operating_system AS operatingSystem,
      v.first_seen_at AS firstSeenAt,
      v.last_seen_at AS lastSeenAt,
      v.ai_uses AS aiUses,
      COUNT(m.id) AS messageCount,
      SUM(CASE WHEN m.sender = 'visitor' AND m.read_at IS NULL THEN 1 ELSE 0 END) AS unreadCount,
      MAX(m.created_at) AS latestMessageAt,
      (SELECT recent.content FROM zarnur_support_messages recent
       WHERE recent.visitor_id = v.id ORDER BY recent.id DESC LIMIT 1) AS lastMessage
    FROM zarnur_visitors v
    JOIN zarnur_support_messages m ON m.visitor_id = v.id
    GROUP BY v.id
    ORDER BY MAX(m.id) DESC
    LIMIT 100
  `).all();
  res.json({ threads });
});

adminSupportRouter.get('/visitors', (_req: Request, res: Response) => {
  const visitors = getDb().prepare(`
    SELECT
      v.id AS visitorId,
      v.device_type AS deviceType,
      v.operating_system AS operatingSystem,
      v.first_seen_at AS firstSeenAt,
      v.last_seen_at AS lastSeenAt,
      v.ai_uses AS aiUses,
      COUNT(m.id) AS messageCount
    FROM zarnur_visitors v
    LEFT JOIN zarnur_support_messages m ON m.visitor_id = v.id
    GROUP BY v.id
    ORDER BY v.last_seen_at DESC
    LIMIT 100
  `).all();
  res.json({ visitors });
});

function parseVisitorId(value: string | string[] | undefined): number | null {
  if (Array.isArray(value)) value = value[0];
  if (!value) return null;
  if (!/^[1-9]\d{0,8}$/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) ? id : null;
}

adminSupportRouter.get('/threads/:visitorId/messages', (req: Request, res: Response) => {
  const visitorId = parseVisitorId(req.params.visitorId);
  if (visitorId === null) {
    res.status(400).json({ error: { message: 'Invalid visitor ID', type: 'invalid_request_error' } });
    return;
  }
  const exists = getDb().prepare('SELECT 1 FROM zarnur_visitors WHERE id = ?').get(visitorId);
  if (!exists) {
    res.status(404).json({ error: { message: 'Visitor not found', type: 'not_found' } });
    return;
  }
  getDb().prepare(`
    UPDATE zarnur_support_messages
    SET read_at = datetime('now')
    WHERE visitor_id = ? AND sender = 'visitor' AND read_at IS NULL
  `).run(visitorId);
  const messages = getDb().prepare(`
    SELECT id, sender, content, created_at AS createdAt
    FROM zarnur_support_messages
    WHERE visitor_id = ?
    ORDER BY id DESC
    LIMIT 100
  `).all(visitorId).reverse();
  res.json({ messages });
});

adminSupportRouter.post('/threads/:visitorId/messages', (req: Request, res: Response) => {
  const visitorId = parseVisitorId(req.params.visitorId);
  if (visitorId === null) {
    res.status(400).json({ error: { message: 'Invalid visitor ID', type: 'invalid_request_error' } });
    return;
  }
  const parsed = messageSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: { message: parsed.error.issues.map(issue => issue.message).join(', '), type: 'invalid_request_error' } });
    return;
  }
  const exists = getDb().prepare('SELECT 1 FROM zarnur_visitors WHERE id = ?').get(visitorId);
  if (!exists) {
    res.status(404).json({ error: { message: 'Visitor not found', type: 'not_found' } });
    return;
  }
  getDb().prepare(`
    INSERT INTO zarnur_support_messages (visitor_id, sender, content)
    VALUES (?, 'admin', ?)
  `).run(visitorId, parsed.data.content);
  res.status(201).json({ sent: true });
});

adminSupportRouter.delete('/threads/:visitorId', (req: Request, res: Response) => {
  const visitorId = parseVisitorId(req.params.visitorId);
  if (visitorId === null) {
    res.status(400).json({ error: { message: 'Invalid visitor ID', type: 'invalid_request_error' } });
    return;
  }
  const result = getDb().prepare('DELETE FROM zarnur_visitors WHERE id = ?').run(visitorId);
  if (result.changes === 0) {
    res.status(404).json({ error: { message: 'Visitor not found', type: 'not_found' } });
    return;
  }
  res.json({ deleted: true });
});
