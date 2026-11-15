import type { Db } from '../types.js';

export function up(db: Db): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS zarnur_visitors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      token_hash TEXT NOT NULL UNIQUE,
      device_type TEXT NOT NULL,
      operating_system TEXT NOT NULL,
      first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
      ai_uses INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS zarnur_support_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      visitor_id INTEGER NOT NULL REFERENCES zarnur_visitors(id) ON DELETE CASCADE,
      sender TEXT NOT NULL CHECK (sender IN ('visitor', 'admin')),
      content TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      read_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_zarnur_support_visitor_message
      ON zarnur_support_messages (visitor_id, id);
    CREATE INDEX IF NOT EXISTS idx_zarnur_support_unread
      ON zarnur_support_messages (sender, read_at);
  `);
}

export function down(db: Db): void {
  db.exec(`
    DROP TABLE IF EXISTS zarnur_support_messages;
    DROP TABLE IF EXISTS zarnur_visitors;
  `);
}
