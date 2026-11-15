import type { Db } from '../types.js';

export function up(db: Db): void {
  db.exec(`
    ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'admin'
      CHECK (role IN ('admin', 'user'));
    ALTER TABLE users ADD COLUMN google_subject TEXT;
    ALTER TABLE users ADD COLUMN disabled_at TEXT;
    ALTER TABLE api_keys ADD COLUMN share_with_members INTEGER NOT NULL DEFAULT 0
      CHECK (share_with_members IN (0, 1));
    CREATE UNIQUE INDEX idx_users_google_subject
      ON users (google_subject);

    CREATE TABLE zarnur_member_chat_usage (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      day TEXT NOT NULL,
      request_count INTEGER NOT NULL DEFAULT 0,
      success_count INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (user_id, day)
    );
    CREATE INDEX idx_zarnur_member_chat_user_day
      ON zarnur_member_chat_usage (day);
  `);
}

export function down(db: Db): void {
  db.exec(`
    DROP TABLE IF EXISTS zarnur_member_chat_usage;
    ALTER TABLE api_keys DROP COLUMN share_with_members;
    ALTER TABLE users DROP COLUMN disabled_at;
    DROP INDEX IF EXISTS idx_users_google_subject;
    ALTER TABLE users DROP COLUMN google_subject;
    ALTER TABLE users DROP COLUMN role;
  `);
}
