import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join, isAbsolute } from 'node:path';
import { migrate } from './migrations.mjs';
import { validateTaskGraph } from './workflow.mjs';
export function backupRestore({
  db,
  path,
  clock,
  snapshot,
  backup,
  transaction,
  reloadUser,
  createStore,
  fail,
  integer,
  dateOnly,
  choice,
}) {
  const pendingRestores = new Map();
  const restoredTokens = new Map();
  const tables = [
    'users',
    'notes',
    'projects',
    'habits',
    'habit_checks',
    'decisions',
    'user_settings',
    'recurring_flows',
    'tasks',
    'energy_logs',
    'focus_sessions',
    'work_checkpoints',
    'focus_thoughts',
    'resources',
    'financial_transactions',
    'event_series',
    'calendar_events',
    'week_templates',
    'calendar_undo',
    'applied_requests',
    'plan_previews',
  ];
  function copyRows(target, rows) {
    target.exec('PRAGMA defer_foreign_keys=ON');
    for (const table of [...tables].reverse())
      target.exec(`DELETE FROM ${table}`);
    for (const table of tables) {
      if (
        ['calendar_undo', 'applied_requests', 'plan_previews'].includes(table)
      )
        continue;
      const columns = target
        .prepare(`PRAGMA table_info(${table})`)
        .all()
        .map((c) => c.name);
      const statement = target.prepare(
        `INSERT INTO ${table} (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`,
      );
      for (const row of rows[table])
        statement.run(...columns.map((c) => row[c] ?? null));
    }
    if (target.prepare('PRAGMA foreign_key_check').all().length)
      fail('Восстановление отменено: нарушены связи данных.');
  }
  function inspectBackup(bytes) {
    if (
      !Buffer.isBuffer(bytes) ||
      bytes.length < 100 ||
      bytes.length > 50 * 1024 * 1024 ||
      bytes.subarray(0, 16).toString('binary') !== 'SQLite format 3\0'
    )
      fail('Выберите резервную копию SQLite размером до 50 МБ.');
    const folder = join(
      path === ':memory:' ? 'data' : dirname(path),
      'restore-staging',
    );
    mkdirSync(folder, { recursive: true });
    const token = randomUUID(),
      file = join(folder, `${token}.sqlite`);
    writeFileSync(file, bytes);
    let candidate;
    try {
      candidate = new DatabaseSync(file, { readOnly: true });
      const version = candidate
        .prepare('PRAGMA user_version')
        .get().user_version;
      if (![0, 2, 3, 4, 5, 6].includes(version))
        fail('Эта версия резервной копии не поддерживается.');
      if (
        candidate.prepare('PRAGMA integrity_check').get().integrity_check !==
          'ok' ||
        candidate.prepare('PRAGMA foreign_key_check').all().length
      )
        fail('Файл повреждён: проверка целостности не пройдена.');
      const required = {
        users: ['id', 'username', 'created_at'],
        tasks: [
          'id',
          'user_id',
          'title',
          'status',
          'penalty_minor',
          'created_at',
        ],
        energy_logs: ['id', 'user_id', 'logged_at', 'energy_level'],
        focus_sessions: [
          'id',
          'task_id',
          'phase',
          'started_at',
          'phase_ends_at',
        ],
        financial_transactions: [
          'id',
          'user_id',
          'amount_minor',
          'idempotency_key',
          'created_at',
        ],
      };
      if (version >= 2)
        Object.assign(required, {
          notes: ['id', 'body', 'note_date'],
          calendar_events: ['id', 'start_at', 'end_at'],
        });
      if (version >= 3)
        Object.assign(required, {
          week_templates: ['id', 'blocks_json'],
          event_series: ['id', 'rule_json'],
          calendar_undo: ['user_id'],
          applied_requests: ['id'],
        });
      if (version >= 4)
        Object.assign(required, {
          projects: ['id', 'user_id', 'title'],
          habits: ['id', 'target_per_week'],
          habit_checks: ['id', 'habit_id', 'check_date'],
          decisions: ['id', 'reasons'],
          work_checkpoints: ['id', 'task_id', 'summary'],
          focus_thoughts: ['id', 'body'],
          resources: ['id', 'content', 'size'],
          user_settings: ['user_id', 'json'],
          recurring_flows: ['id', 'amount_minor'],
          plan_previews: ['id', 'baseline_json'],
        });
      for (const [table, columns] of Object.entries(required)) {
        if (
          candidate
            .prepare('SELECT type FROM sqlite_master WHERE name=?')
            .get(table)?.type !== 'table'
        )
          fail('Это не резервная копия focal.');
        const actual = candidate
          .prepare(`PRAGMA table_info(${table})`)
          .all()
          .map((c) => c.name);
        if (columns.some((c) => !actual.includes(c)))
          fail('В резервной копии отсутствуют нужные данные.');
      }
      if (candidate.prepare('SELECT count(*) n FROM users').get().n !== 1)
        fail('Ожидается копия с одним пользователем.');
      candidate.close();
      candidate = null;
      const staged = createStore(file, clock);
      staged.close();
      candidate = new DatabaseSync(file, { readOnly: true });
      // Read only known tables. Uploaded triggers and schema are never installed in the live database.
      const rows = Object.fromEntries(
        tables.map((table) => [
          table,
          candidate.prepare(`SELECT * FROM ${table}`).all(),
        ]),
      );
      const counts = Object.fromEntries(
        [
          'tasks',
          'notes',
          'calendar_events',
          'focus_sessions',
          'financial_transactions',
          'week_templates',
          'projects',
          'habits',
          'decisions',
          'resources',
          'work_checkpoints',
          'focus_thoughts',
          'recurring_flows',
        ].map((t) => [t, rows[t].length]),
      );
      for (const task of rows.tasks) {
        for (const key of ['tags_json', 'dependencies_json']) {
          const values = JSON.parse(task[key]);
          if (
            !Array.isArray(values) ||
            values.length > (key === 'tags_json' ? 12 : 50) ||
            values.some((v) => typeof v !== 'string')
          )
            fail('Повреждены метки или зависимости.');
          if (
            key === 'dependencies_json' &&
            values.some((id) => !rows.tasks.some((t) => t.id === id))
          )
            fail('Не найдена связанная задача.');
        }
        if (task.recurrence_json) {
          const rule = JSON.parse(task.recurrence_json);
          choice(rule.mode, ['days', 'monthly', 'after']);
          integer(rule.every, 1, rule.mode === 'monthly' ? 24 : 365);
          integer(rule.day, 1, 31);
        }
      }
      validateTaskGraph(rows.tasks, fail);
      for (const item of rows.week_templates) {
        const blocks = JSON.parse(item.blocks_json);
        if (
          !Array.isArray(blocks) ||
          blocks.length > 200 ||
          blocks.some(
            (b) =>
              !Number.isInteger(b.day) ||
              b.day < 0 ||
              b.day > 6 ||
              !Number.isFinite(b.duration) ||
              b.duration <= 0 ||
              b.duration > 10080 ||
              !Number.isInteger(b.hour) ||
              b.hour < 0 ||
              b.hour > 23 ||
              !Number.isInteger(b.minute) ||
              b.minute < 0 ||
              b.minute > 59 ||
              typeof b.title !== 'string',
          )
        )
          fail('Повреждён шаблон недели.');
      }
      for (const session of rows.focus_sessions) {
        const pauses = JSON.parse(session.pauses_json);
        if (!Array.isArray(pauses) || pauses.length > 100000)
          fail('Повреждена история пауз.');
        let previous = Date.parse(session.started_at);
        for (const pause of pauses) {
          if (
            !pause ||
            !['preparation', 'work', 'break'].includes(pause.phase) ||
            !Number.isFinite(Date.parse(pause.start)) ||
            !Number.isFinite(Date.parse(pause.end)) ||
            Date.parse(pause.start) < previous ||
            Date.parse(pause.end) < Date.parse(pause.start)
          )
            fail('Повреждена история пауз.');
          previous = Date.parse(pause.end);
        }
        if (
          session.paused_at &&
          (!Number.isFinite(Date.parse(session.paused_at)) ||
            Date.parse(session.paused_at) < previous)
        )
          fail('Повреждена текущая пауза.');
      }
      for (const row of rows.user_settings) {
        const settings = JSON.parse(row.json);
        if (
          !settings ||
          Array.isArray(settings) ||
          typeof settings !== 'object'
        )
          fail('Повреждены настройки.');
        for (const [name, min, max] of [
          ['day_start', 0, 23],
          ['day_end', 1, 24],
          ['daily_limit', 15, 720],
          ['buffer_minutes', 0, 60],
          ['session_minutes', 5, 120],
          ['opening_balance_minor', -99999999999, 99999999999],
        ])
          if (name in settings) integer(settings[name], min, max);
        if ((settings.day_start ?? 9) >= (settings.day_end ?? 19))
          fail('Повреждены часы рабочего дня.');
        if (settings.saved_views) {
          if (
            !Array.isArray(settings.saved_views) ||
            settings.saved_views.length > 20
          )
            fail('Повреждены представления.');
          for (const v of settings.saved_views) {
            if (
              typeof v.id !== 'string' ||
              typeof v.name !== 'string' ||
              v.name.length > 60 ||
              !v.filter
            )
              fail('Повреждено представление.');
            choice(v.filter.status, [
              'open',
              'all',
              'waiting',
              'completed',
              'short',
              'energy',
              'overdue',
            ]);
            for (const k of ['query', 'tag', 'project'])
              if (typeof v.filter[k] !== 'string') fail('Повреждены фильтры.');
          }
        }
        if (settings.balance_date) dateOnly(settings.balance_date);
        if (settings.motion) choice(settings.motion, ['full', 'gentle', 'off']);
        if (
          'auto_backup' in settings &&
          typeof settings.auto_backup !== 'boolean'
        )
          fail('Повреждена настройка резервных копий.');
        if (
          'backup_folder' in settings &&
          (typeof settings.backup_folder !== 'string' ||
            settings.backup_folder.length > 1000 ||
            (settings.backup_folder && !isAbsolute(settings.backup_folder)))
        )
          fail('Повреждён путь резервных копий.');
        for (const [key, allowed] of [
          ['hidden_sections', ['energy', 'finance', 'life', 'studio']],
          ['hidden_life_sections', ['habits', 'decisions']],
        ]) {
          if (
            key in settings &&
            (!Array.isArray(settings[key]) ||
              settings[key].some((v) => !allowed.includes(v)))
          )
            fail('Повреждены настройки разделов.');
        }
      }
      if (
        rows.resources.some(
          (r) =>
            r.size !== (r.content?.byteLength || 0) || r.size > 8 * 1024 * 1024,
        )
      )
        fail('Повреждены вложенные файлы.');
      for (const r of rows.resources)
        if (r.url) {
          let u;
          try {
            u = new URL(r.url);
          } catch {
            fail('Повреждена ссылка материала.');
          }
          if (!['http:', 'https:'].includes(u.protocol))
            fail('Недопустимая ссылка в материале.');
        }
      for (const task of rows.tasks)
        if (task.parent_task_id) {
          const parent = rows.tasks.find((t) => t.id === task.parent_task_id);
          if (
            !parent ||
            parent.parent_task_id ||
            parent.id === task.id ||
            parent.project_id !== task.project_id
          )
            fail('Нарушена структура подзадач.');
        }
      const validator = new DatabaseSync(':memory:');
      try {
        validator.exec('PRAGMA foreign_keys=ON');
        validator.exec(
          readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'),
        );
        migrate(validator, ':memory:');
        validator.exec('BEGIN');
        copyRows(validator, rows);
        validator.exec('COMMIT');
      } finally {
        validator.close();
      }
      pendingRestores.clear();
      pendingRestores.set(token, { rows, expires: clock() + 15 * 60000 });
      return {
        token,
        counts,
        username: rows.users[0].username,
        version,
        expires_at: new Date(clock() + 15 * 60000).toISOString(),
      };
    } finally {
      candidate?.close();
      rmSync(file, { force: true });
      rmSync(`${file}-wal`, { force: true });
      rmSync(`${file}-shm`, { force: true });
    }
  }
  function restoreBackup(token) {
    const completed = restoredTokens.get(token);
    if (completed && completed.expires > clock())
      return { ...snapshot(), restored_backup: completed.name };
    const pending = pendingRestores.get(token);
    if (!pending || pending.expires < clock())
      fail('Проверка копии устарела. Выберите файл заново.');
    const saved = backup();
    transaction(() => {
      copyRows(db, pending.rows);
    });
    reloadUser();
    pendingRestores.clear();
    restoredTokens.set(token, {
      name: saved.name,
      expires: clock() + 15 * 60000,
    });
    return { ...snapshot(), restored_backup: saved.name };
  }

  return { inspectBackup, restoreBackup };
}
