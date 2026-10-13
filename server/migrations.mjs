import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

function migrateV2(db, path) {
  const version = db.prepare('PRAGMA user_version').get().user_version;
  if (version >= 2) return;
  // VACUUM reads committed WAL data, unlike copying a live .sqlite file.
  if (path !== ':memory:' && existsSync(path)) {
    const folder = join(dirname(path), 'backups');
    mkdirSync(folder, { recursive: true });
    const backup = join(folder, `before-v2-${Date.now()}.sqlite`);
    db.prepare('VACUUM INTO ?').run(backup);
  }
  db.exec('PRAGMA foreign_keys=OFF; BEGIN IMMEDIATE;');
  try {
    const columns = db
      .prepare('PRAGMA table_info(tasks)')
      .all()
      .map((c) => c.name);
    for (const [name, definition] of [
      ['planned_date', 'TEXT'],
      ['is_priority', 'INTEGER NOT NULL DEFAULT 0 CHECK(is_priority IN (0,1))'],
      [
        'estimated_minutes',
        'INTEGER NOT NULL DEFAULT 30 CHECK(estimated_minutes BETWEEN 1 AND 1440)',
      ],
    ])
      if (!columns.includes(name))
        db.exec(`ALTER TABLE tasks ADD COLUMN ${name} ${definition}`);
    const old = db
      .prepare("SELECT sql FROM sqlite_master WHERE name='focus_sessions'")
      .get().sql;
    if (/dopamine_debt_duration[\s\S]*?BETWEEN 10 AND 20/.test(old)) {
      db.exec(`CREATE TABLE focus_sessions_v2 (
        id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id),
        dopamine_debt_duration INTEGER NOT NULL CHECK(dopamine_debt_duration BETWEEN 0 AND 20),
        work_duration INTEGER NOT NULL CHECK(work_duration BETWEEN 1 AND 120),
        break_duration INTEGER NOT NULL CHECK(break_duration BETWEEN 1 AND 60),
        audio_type TEXT NOT NULL CHECK(audio_type IN ('baroque','binaural','isochronic','none')),
        is_successful INTEGER CHECK(is_successful IN (0,1)),
        phase TEXT NOT NULL CHECK(phase IN ('preparation','work','break','completed','cancelled')),
        started_at TEXT NOT NULL, phase_ends_at TEXT NOT NULL, ended_at TEXT
      );
      INSERT INTO focus_sessions_v2 SELECT * FROM focus_sessions;
      DROP TABLE focus_sessions;
      ALTER TABLE focus_sessions_v2 RENAME TO focus_sessions;
      CREATE UNIQUE INDEX idx_single_running_session ON focus_sessions((1)) WHERE phase IN ('preparation','work','break');
      CREATE INDEX idx_sessions_task ON focus_sessions(task_id);`);
    }
    db.exec(
      'CREATE INDEX IF NOT EXISTS idx_tasks_user_plan ON tasks(user_id,planned_date);',
    );
    if (db.prepare('PRAGMA foreign_key_check').all().length)
      throw new Error('Ошибка связей при обновлении базы.');
    db.exec('PRAGMA user_version=2; COMMIT;');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  } finally {
    db.exec('PRAGMA foreign_keys=ON;');
  }
}

function migrateV3(db, path) {
  const version = db.prepare('PRAGMA user_version').get().user_version;
  if (version > 6)
    throw new Error('База создана более новой версией приложения.');
  migrateV2(db, path);
  if (version >= 3) return;
  if (path !== ':memory:' && existsSync(path)) {
    const folder = join(dirname(path), 'backups');
    mkdirSync(folder, { recursive: true });
    db.prepare('VACUUM INTO ?').run(
      join(folder, `before-v3-${Date.now()}.sqlite`),
    );
  }
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec(`
      ALTER TABLE tasks ADD COLUMN source_note_id TEXT REFERENCES notes(id) ON DELETE SET NULL;
      ALTER TABLE calendar_events ADD COLUMN series_id TEXT REFERENCES event_series(id);
      ALTER TABLE calendar_events ADD COLUMN series_exception INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE calendar_events ADD COLUMN reminder_minutes INTEGER NOT NULL DEFAULT 0 CHECK(reminder_minutes IN (0,5,15,30));
      ALTER TABLE calendar_events ADD COLUMN snoozed_until TEXT;
      ALTER TABLE calendar_events ADD COLUMN reminder_dismissed_at TEXT;
      CREATE INDEX idx_events_series ON calendar_events(series_id);
      CREATE INDEX idx_tasks_note ON tasks(source_note_id);
      PRAGMA user_version=3;
    `);
    if (db.prepare('PRAGMA foreign_key_check').all().length)
      throw new Error('Ошибка связей при обновлении базы.');
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function migrateV4(db, path) {
  const version = db.prepare('PRAGMA user_version').get().user_version;
  if (version > 6)
    throw new Error('База создана более новой версией приложения.');
  migrateV3(db, path);
  if (version >= 4) return;
  if (path !== ':memory:' && existsSync(path)) {
    const folder = join(dirname(path), 'backups');
    mkdirSync(folder, { recursive: true });
    db.prepare('VACUUM INTO ?').run(
      join(folder, `before-v4-${Date.now()}.sqlite`),
    );
  }
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec(`ALTER TABLE tasks ADD COLUMN project_id TEXT REFERENCES projects(id);
      ALTER TABLE tasks ADD COLUMN parent_task_id TEXT REFERENCES tasks(id);
      ALTER TABLE calendar_events ADD COLUMN is_fixed INTEGER NOT NULL DEFAULT 1 CHECK(is_fixed IN (0,1));
      ALTER TABLE calendar_events ADD COLUMN external_uid TEXT;
      UPDATE calendar_events SET is_fixed=0 WHERE task_id IS NOT NULL;
      ALTER TABLE financial_transactions ADD COLUMN recurring_id TEXT REFERENCES recurring_flows(id);
      CREATE INDEX idx_tasks_project ON tasks(project_id);
      CREATE INDEX idx_tasks_parent ON tasks(parent_task_id);
      CREATE UNIQUE INDEX idx_events_external ON calendar_events(user_id,external_uid) WHERE external_uid IS NOT NULL;
      PRAGMA user_version=4;`);
    if (db.prepare('PRAGMA foreign_key_check').all().length)
      throw new Error('Ошибка связей при обновлении базы.');
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

function migrateV5(db, path) {
  migrateV4(db, path);
  if (db.prepare('PRAGMA user_version').get().user_version >= 5) return;
  if (path !== ':memory:' && existsSync(path)) {
    const folder = join(dirname(path), 'backups');
    mkdirSync(folder, { recursive: true });
    db.prepare('VACUUM INTO ?').run(
      join(folder, 'before-v5-' + Date.now() + '.sqlite'),
    );
  }
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec(`ALTER TABLE focus_sessions ADD COLUMN paused_at TEXT;
      ALTER TABLE focus_sessions ADD COLUMN pauses_json TEXT NOT NULL DEFAULT '[]';
      ALTER TABLE tasks ADD COLUMN deadline_notified_at TEXT;
      UPDATE tasks SET status='pending' WHERE status='failed';
      UPDATE financial_transactions SET actual_date=NULL WHERE type='penalty';
      PRAGMA user_version=5;`);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function migrate(db, path) {
  migrateV5(db, path);
  if (db.prepare('PRAGMA user_version').get().user_version >= 6) return;
  if (path !== ':memory:' && existsSync(path)) {
    const folder = join(dirname(path), 'backups');
    mkdirSync(folder, { recursive: true });
    db.prepare('VACUUM INTO ?').run(
      join(folder, 'before-v6-' + Date.now() + '.sqlite'),
    );
  }
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const table of ['tasks', 'notes', 'projects']) {
      db.exec('ALTER TABLE ' + table + ' ADD COLUMN deleted_at TEXT');
      db.exec('ALTER TABLE ' + table + ' ADD COLUMN trash_batch TEXT');
    }
    db.exec(`ALTER TABLE tasks ADD COLUMN board_status TEXT NOT NULL DEFAULT 'planned' CHECK(board_status IN ('planned','doing','waiting'));
      ALTER TABLE tasks ADD COLUMN waiting_reason TEXT NOT NULL DEFAULT '';
      ALTER TABLE tasks ADD COLUMN tags_json TEXT NOT NULL DEFAULT '[]';
      ALTER TABLE tasks ADD COLUMN dependencies_json TEXT NOT NULL DEFAULT '[]';
      ALTER TABLE tasks ADD COLUMN recurrence_json TEXT;
      ALTER TABLE tasks ADD COLUMN series_key TEXT;
      ALTER TABLE tasks ADD COLUMN recurrence_next_id TEXT;
      ALTER TABLE tasks ADD COLUMN estimate_applied_at TEXT;
      PRAGMA user_version=6;`);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
