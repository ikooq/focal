import {
  workflowActions,
  blockers,
  assertReady,
  validateTaskGraph,
} from './workflow.mjs';
import { autoBackups } from './auto-backup.mjs';
import { sessionActions } from './session-actions.mjs';
import { backupRestore } from './backup-restore.mjs';
import { dayActions } from './day-actions.mjs';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { migrate } from './migrations.mjs';
import { plannerActions } from './planner.mjs';
import { lifeActions } from './life-actions.mjs';
import { planDay, importICS } from './studio.mjs';

export const localDate = (date = new Date()) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const fail = (message) => {
  throw new Error(message);
};
const text = (value, max = 160) =>
  typeof value === 'string' &&
  value.trim().length > 0 &&
  value.trim().length <= max
    ? value.trim()
    : fail('Заполните текстовое поле корректно.');
const integer = (v, min, max) =>
  Number.isInteger(v) && v >= min && v <= max
    ? v
    : fail(`Укажите целое число от ${min} до ${max}.`);
const choice = (v, choices) =>
  choices.includes(v) ? v : fail('Недопустимое значение.');
const dateOnly = (v) =>
  typeof v === 'string' &&
  /^\d{4}-\d{2}-\d{2}$/.test(v) &&
  new Date(v).toISOString().slice(0, 10) === v
    ? v
    : fail('Некорректная дата.');
const timestamp = (v) => {
  if (
    typeof v !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,3})?)?Z$/.test(
      v,
    )
  )
    fail('Некорректные дата и время.');
  dateOnly(v.slice(0, 10));
  return new Date(v).toISOString();
};
export function moneyMinor(v) {
  if (typeof v !== 'string' || !/^\d{1,9}([.,]\d{1,2})?$/.test(v))
    fail('Введите сумму с точностью до двух знаков.');
  const [whole, fraction = ''] = v.replace(',', '.').split('.');
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
}

export function createStore(path, clock = () => Date.now()) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  if (db.prepare('PRAGMA user_version').get().user_version > 6) {
    db.close();
    fail('База создана более новой версией приложения.');
  }
  db.exec(
    'PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;',
  );
  db.exec(readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));
  migrate(db, path);
  const now = () => new Date(clock()).toISOString();
  let user = db.prepare('SELECT * FROM users LIMIT 1').get();
  if (!user) {
    db.prepare(
      'INSERT INTO users(id,username,email,created_at) VALUES(?,?,?,?)',
    ).run(randomUUID(), 'Вы', '', now());
    user = db.prepare('SELECT * FROM users LIMIT 1').get();
  }
  function transaction(fn) {
    db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      db.exec('COMMIT');
      return result;
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }
  const taskById = (id) =>
    db
      .prepare(
        'SELECT * FROM tasks WHERE id=? AND user_id=? AND deleted_at IS NULL',
      )
      .get(text(id), user.id) || fail('Задача не найдена.');
  function penalty(task, sessionId, reason, at) {
    if (!task.penalty_minor) return;
    const day = localDate(new Date(at));
    db.prepare(
      'INSERT OR IGNORE INTO financial_transactions(id,user_id,type,amount_minor,category,planned_date,actual_date,task_id,session_id,idempotency_key,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
    ).run(
      randomUUID(),
      user.id,
      'penalty',
      task.penalty_minor,
      `${reason}: ${task.title}`,
      day,
      null,
      task.id,
      sessionId,
      `penalty:${task.id}`,
      at,
    );
  }
  // Getters keep restored user identity current for every action.
  const { reconcile, sessionAction } = sessionActions(
    db,
    {
      get id() {
        return user.id;
      },
    },
    { transaction, clock, now, taskById, penalty, fail, text, integer, choice },
  );
  const dayAction = dayActions(
    db,
    {
      get id() {
        return user.id;
      },
    },
    { now, clock, text, dateOnly, fail, taskById },
  );
  const workflow = workflowActions(
    db,
    {
      get id() {
        return user.id;
      },
    },
    { taskById, text, integer, choice, dateOnly, now, fail },
  );
  const autoBackup = autoBackups(db, path, clock);
  const settings = () =>
    JSON.parse(
      db.prepare('SELECT json FROM user_settings WHERE user_id=?').get(user.id)
        ?.json || '{}',
    );
  const revisionId = randomUUID();
  function revision() {
    reconcile();
    autoBackup.run(settings());
    return `${revisionId}:${String(db.prepare('PRAGMA data_version').get().data_version)}:${String(db.prepare('SELECT total_changes() n').get().n)}:${JSON.stringify(autoBackup.status())}`;
  }
  function snapshot() {
    reconcile();
    autoBackup.run(settings());
    return {
      user,
      server_now: now(),
      app_version: 6,
      auto_backup: autoBackup.status(),
      projects: db
        .prepare(
          'SELECT * FROM projects WHERE user_id=? AND deleted_at IS NULL ORDER BY created_at DESC',
        )
        .all(user.id),
      habits: db
        .prepare('SELECT * FROM habits WHERE user_id=? ORDER BY created_at')
        .all(user.id),
      habit_checks: db
        .prepare(
          'SELECT c.* FROM habit_checks c JOIN habits h ON h.id=c.habit_id WHERE h.user_id=? ORDER BY check_date DESC',
        )
        .all(user.id),
      decisions: db
        .prepare(
          'SELECT * FROM decisions WHERE user_id=? ORDER BY decided_on DESC',
        )
        .all(user.id),
      checkpoints: db
        .prepare(
          'SELECT * FROM work_checkpoints WHERE user_id=? ORDER BY created_at DESC,rowid DESC',
        )
        .all(user.id),
      thoughts: db
        .prepare(
          'SELECT * FROM focus_thoughts WHERE user_id=? ORDER BY created_at DESC',
        )
        .all(user.id),
      resources: db
        .prepare(
          'SELECT id,task_id,note_id,title,url,mime,size,created_at FROM resources WHERE user_id=? ORDER BY created_at DESC',
        )
        .all(user.id),
      flows: db
        .prepare(
          'SELECT * FROM recurring_flows WHERE user_id=? ORDER BY start_date',
        )
        .all(user.id),
      settings: JSON.parse(
        db
          .prepare('SELECT json FROM user_settings WHERE user_id=?')
          .get(user.id)?.json || '{}',
      ),
      templates: db
        .prepare(
          'SELECT * FROM week_templates WHERE user_id=? ORDER BY created_at DESC',
        )
        .all(user.id),
      calendar_undo:
        db
          .prepare('SELECT label,created_at FROM calendar_undo WHERE user_id=?')
          .get(user.id) || null,
      notes: db
        .prepare(
          'SELECT * FROM notes WHERE user_id=? AND deleted_at IS NULL ORDER BY note_date DESC,updated_at DESC',
        )
        .all(user.id),
      events: db
        .prepare(
          'SELECT * FROM calendar_events WHERE user_id=? AND (task_id IS NULL OR task_id IN (SELECT id FROM tasks WHERE deleted_at IS NULL)) ORDER BY start_at',
        )
        .all(user.id),
      tasks: db
        .prepare(
          'SELECT * FROM tasks WHERE user_id=? AND deleted_at IS NULL ORDER BY created_at DESC',
        )
        .all(user.id)
        .map((t) => ({ ...t, blocked_by: blockers(db, t) })),
      trash: ['tasks', 'notes', 'projects'].flatMap((table) =>
        db
          .prepare(
            'SELECT id,title,deleted_at,trash_batch FROM ' +
              table +
              ' WHERE user_id=? AND deleted_at IS NOT NULL ORDER BY deleted_at DESC',
          )
          .all(user.id)
          .map((row) => ({ ...row, kind: table })),
      ),
      energy_logs: db
        .prepare(
          'SELECT * FROM energy_logs WHERE user_id=? ORDER BY logged_at DESC',
        )
        .all(user.id),
      sessions: db
        .prepare('SELECT * FROM focus_sessions ORDER BY started_at DESC')
        .all(),
      transactions: db
        .prepare(
          'SELECT * FROM financial_transactions WHERE user_id=? ORDER BY planned_date DESC,created_at DESC',
        )
        .all(user.id),
    };
  }
  const planAction = (input) =>
    lifeActions(db, user, {
      text,
      integer,
      choice,
      dateOnly,
      taskById,
      now,
      fail,
      moneyMinor,
    })(input) ||
    plannerActions(db, user, {
      text,
      integer,
      choice,
      dateOnly,
      timestamp,
      taskById,
      now,
      fail,
    })(input);
  const eventsJSON = () =>
    JSON.stringify(
      db
        .prepare('SELECT * FROM calendar_events WHERE user_id=? ORDER BY id')
        .all(user.id),
    );
  function action(input) {
    if (!input || typeof input !== 'object') fail('Некорректное действие.');
    if (
      input.request_id &&
      db
        .prepare('SELECT id FROM applied_requests WHERE id=? AND user_id=?')
        .get(text(input.request_id), user.id)
    )
      return snapshot();
    reconcile();
    transaction(() => {
      const tracked = [
        'event.save',
        'event.move',
        'event.resize',
        'event.delete',
        'event.duplicate',
        'event.complete',
        'template.apply',
        'plan.apply',
      ].includes(input.action);
      const before = tracked ? eventsJSON() : null;
      switch (input.action) {
        case 'plan.apply': {
          const p = db
            .prepare('SELECT * FROM plan_previews WHERE id=? AND user_id=?')
            .get(text(input.token), user.id);
          if (!p) fail('Предпросмотр не найден.');
          if (p.applied_at) break;
          if (p.expires_at < now())
            fail('Предпросмотр устарел. Пересчитайте план.');
          if (p.baseline_json !== baseline())
            fail('Данные изменились. Пересчитайте план перед применением.');
          for (const op of JSON.parse(p.payload_json)) {
            if (
              p.kind === 'schedule' &&
              op.action === 'event.save' &&
              Date.parse(op.start_at) < clock()
            )
              fail(
                'Время начала одного из блоков уже прошло. Пересчитайте план.',
              );
            if (op.action === 'quick.task')
              db.prepare(
                "INSERT INTO tasks(id,user_id,title,brain_hemisphere,required_energy,penalty_minor,status,estimated_minutes,planned_date,created_at) VALUES(?,?,?,'analytical',5,0,'pending',?,?,?)",
              ).run(
                randomUUID(),
                user.id,
                text(op.title),
                integer(op.duration, 5, 1440),
                dateOnly(op.date),
                now(),
              );
            else if (op.action === 'transaction.reschedule') {
              const tx = db
                .prepare(
                  'SELECT * FROM financial_transactions WHERE id=? AND user_id=?',
                )
                .get(text(op.id), user.id);
              if (!tx || tx.actual_date || tx.type !== 'expense')
                fail('Перенести можно только плановый расход.');
              db.prepare(
                'UPDATE financial_transactions SET planned_date=? WHERE id=?',
              ).run(dateOnly(op.date), tx.id);
            } else if (op.action === 'event.save') {
              if (
                op.external_uid &&
                db
                  .prepare(
                    'SELECT id FROM calendar_events WHERE user_id=? AND external_uid=?',
                  )
                  .get(user.id, op.external_uid)
              )
                continue;
              planAction(op);
              const id = db
                .prepare(
                  'SELECT id FROM calendar_events WHERE rowid=last_insert_rowid()',
                )
                .get().id;
              db.prepare(
                'UPDATE calendar_events SET is_fixed=?,external_uid=? WHERE id=?',
              ).run(op.is_fixed === 0 ? 0 : 1, op.external_uid || null, id);
            } else if (op.action === 'event.delete') {
              const e = db
                .prepare(
                  'SELECT * FROM calendar_events WHERE id=? AND user_id=?',
                )
                .get(text(op.id), user.id);
              if (!e || e.is_fixed || e.completed_at)
                fail('Закреплённый блок нельзя переносить.');
              planAction(op);
            } else fail('Неподдерживаемое действие плана.');
          }
          db.prepare('UPDATE plan_previews SET applied_at=? WHERE id=?').run(
            now(),
            p.id,
          );
          break;
        }
        case 'event.lock': {
          const result = db
            .prepare(
              'UPDATE calendar_events SET is_fixed=?,updated_at=? WHERE id=? AND user_id=?',
            )
            .run(
              input.is_fixed === false ? 0 : 1,
              now(),
              text(input.id),
              user.id,
            );
          if (!result.changes) fail('Событие не найдено.');
          break;
        }
        case 'calendar.undo': {
          const undo = db
            .prepare('SELECT * FROM calendar_undo WHERE user_id=?')
            .get(user.id);
          if (!undo) fail('Нет действия для отмены.');
          if (eventsJSON() !== undo.after_json)
            fail(
              'Расписание изменилось после этого действия. Обновите страницу.',
            );
          const previous = JSON.parse(undo.before_json);
          db.prepare('DELETE FROM calendar_events WHERE user_id=?').run(
            user.id,
          );
          for (const event of previous) {
            const keys = Object.keys(event);
            db.prepare(
              `INSERT INTO calendar_events (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`,
            ).run(...keys.map((k) => event[k]));
          }
          db.prepare('DELETE FROM calendar_undo WHERE user_id=?').run(user.id);
          break;
        }
        case 'energy.add': {
          db.prepare(
            'INSERT INTO energy_logs(id,user_id,energy_level,logged_at) VALUES(?,?,?,?)',
          ).run(
            randomUUID(),
            user.id,
            integer(input.energy_level, 1, 10),
            now(),
          );
          break;
        }
        case 'task.save': {
          const title = text(input.title),
            kind = choice(input.brain_hemisphere, ['analytical', 'creative']);
          const required = integer(input.required_energy, 1, 10),
            amount = moneyMinor(input.penalty_amount);
          const deadline = input.deadline ? timestamp(input.deadline) : null;
          const estimate = integer(input.estimated_minutes ?? 30, 1, 1440);
          if (
            deadline &&
            Date.parse(deadline) <= clock() &&
            (!input.id || deadline !== taskById(input.id).deadline)
          )
            fail('Срок должен быть в будущем.');
          if (input.id) {
            const old = taskById(input.id);
            if (old.status !== 'pending')
              fail('Редактировать можно только ожидающую задачу.');
            db.prepare(
              'UPDATE tasks SET title=?,brain_hemisphere=?,required_energy=?,penalty_minor=?,deadline=?,deadline_notified_at=CASE WHEN deadline IS ? THEN deadline_notified_at ELSE NULL END WHERE id=?',
            ).run(title, kind, required, amount, deadline, deadline, old.id);
          } else
            db.prepare(
              'INSERT INTO tasks(id,user_id,title,brain_hemisphere,required_energy,penalty_minor,deadline,status,created_at) VALUES(?,?,?,?,?,?,?,?,?)',
            ).run(
              randomUUID(),
              user.id,
              title,
              kind,
              required,
              amount,
              deadline,
              'pending',
              now(),
            );
          const savedId =
            input.id ||
            db
              .prepare('SELECT id FROM tasks WHERE rowid=last_insert_rowid()')
              .get().id;
          db.prepare('UPDATE tasks SET estimated_minutes=? WHERE id=?').run(
            estimate,
            savedId,
          );
          workflow.configure(taskById(savedId), input);
          break;
        }
        case 'task.complete': {
          const task = taskById(input.id);
          assertReady(db, task, fail);
          if (
            db
              .prepare(
                "SELECT id FROM tasks WHERE parent_task_id=? AND status!='completed' AND deleted_at IS NULL LIMIT 1",
              )
              .get(task.id)
          )
            fail('Сначала завершите подзадачи.');
          if (task.status !== 'pending')
            fail('Завершите текущий цикл перед закрытием задачи.');
          db.prepare(
            "UPDATE tasks SET status='completed',completed_at=? WHERE id=?",
          ).run(now(), task.id);
          break;
        }
        case 'transaction.add': {
          const amount = moneyMinor(input.amount);
          if (amount === 0) fail('Сумма должна быть больше нуля.');
          const type = choice(input.type, ['income', 'expense']);
          if (
            input.actual_date &&
            dateOnly(input.actual_date) > localDate(new Date(clock()))
          )
            fail('Проведённая операция не может быть в будущем.');
          db.prepare(
            'INSERT INTO financial_transactions(id,user_id,type,amount_minor,category,planned_date,actual_date,created_at) VALUES(?,?,?,?,?,?,?,?)',
          ).run(
            randomUUID(),
            user.id,
            type,
            amount,
            text(input.category),
            dateOnly(input.planned_date),
            input.actual_date ? dateOnly(input.actual_date) : null,
            now(),
          );
          break;
        }
        case 'penalty.settle': {
          const result = db
            .prepare(
              "UPDATE financial_transactions SET type='expense',actual_date=? WHERE id=? AND user_id=? AND type='penalty'",
            )
            .run(localDate(new Date(clock())), text(input.id), user.id);
          if (!result.changes) fail('Штраф уже проведён или не найден.');
          break;
        }
        case 'transaction.settle': {
          const result = db
            .prepare(
              `UPDATE financial_transactions SET actual_date=? WHERE id=? AND user_id=? AND actual_date IS NULL AND type!='penalty'`,
            )
            .run(localDate(new Date(clock())), text(input.id), user.id);
          if (!result.changes) fail('Операция уже проведена или не найдена.');
          break;
        }
        default:
          if (
            !workflow.action(input) &&
            !sessionAction(input) &&
            !dayAction(input) &&
            !planAction(input)
          )
            fail('Неизвестное действие.');
      }
      if (input.action === 'task.organize')
        validateTaskGraph(
          db.prepare('SELECT * FROM tasks WHERE user_id=?').all(user.id),
          fail,
        );
      workflow.repeatCompleted();
      if (tracked && before !== eventsJSON())
        db.prepare(
          'INSERT OR REPLACE INTO calendar_undo VALUES(?,?,?,?,?)',
        ).run(
          user.id,
          input.action === 'template.apply'
            ? 'Применение шаблона'
            : input.action === 'event.delete'
              ? 'Удаление события'
              : 'Изменение расписания',
          before,
          eventsJSON(),
          now(),
        );
      if (input.request_id)
        db.prepare('INSERT INTO applied_requests VALUES(?,?,?)').run(
          text(input.request_id),
          user.id,
          now(),
        );
    });
    return snapshot();
  }
  function backup() {
    reconcile();
    const folder = join(
      path === ':memory:' ? 'data' : dirname(path),
      'backups',
    );
    mkdirSync(folder, { recursive: true });
    const file = join(
      folder,
      `focal-${new Date(clock()).toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}.sqlite`,
    );
    db.prepare('VACUUM INTO ?').run(file);
    return { name: file.split(/[\\/]/).pop(), bytes: readFileSync(file) };
  }
  const baseline = () =>
    JSON.stringify(
      [
        'tasks',
        'calendar_events',
        'financial_transactions',
        'user_settings',
      ].map((t) =>
        db
          .prepare(`SELECT * FROM ${t} WHERE user_id=? ORDER BY rowid`)
          .all(user.id),
      ),
    );
  function preview(input) {
    const state = snapshot();
    let result;
    if (input.kind === 'schedule') result = planDay(state, input, clock());
    else if (input.kind === 'week') {
      const start = dateOnly(input.date),
        free = integer(input.free_day ?? 5, 0, 6),
        practice = integer(input.practice_minutes ?? 0, 0, 180);
      const virtual = { ...state, events: [...state.events] };
      result = {
        kind: 'schedule',
        summary: `Сценарий недели · свободный день: ${['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'][free]} · практика ${practice} мин./день`,
        operations: [],
        blocks: [],
        removed: [],
        warnings: [],
      };
      // Remove only selected future flexible work for this week, then distribute it again.
      const last = new Date(start + 'T00:00:00');
      last.setDate(last.getDate() + 7);
      const movable = virtual.events.filter(
        (e) =>
          !e.is_fixed &&
          !e.completed_at &&
          e.task_id &&
          state.tasks.some(
            (t) => t.id === e.task_id && t.status === 'pending',
          ) &&
          Date.parse(e.start_at) >=
            Math.max(clock(), Date.parse(start + 'T00:00:00')) &&
          Date.parse(e.start_at) < last.getTime(),
      );
      virtual.events = virtual.events.filter(
        (e) => !movable.some((m) => m.id === e.id),
      );
      result.removed.push(...movable);
      result.operations.push(
        ...movable.map((e) => ({
          action: 'event.delete',
          id: e.id,
          scope: 'single',
        })),
      );
      for (let i = 0; i < 7; i++) {
        const d = new Date(start + 'T12:00:00');
        d.setDate(d.getDate() + i);
        if (d.getDay() === free) continue;
        let practiceTask;
        if (practice) {
          practiceTask = {
            id: 'practice-' + i,
            title: 'Ежедневная практика',
            status: 'pending',
            estimated_minutes: practice,
            brain_hemisphere: 'creative',
            is_priority: 1,
          };
          virtual.tasks = [practiceTask, ...state.tasks];
        }
        const day = planDay(
          virtual,
          { ...input, date: localDate(d), replan: false, kind: 'schedule' },
          clock(),
        );
        for (const b of day.blocks) {
          if (b.task_id === practiceTask?.id) {
            delete b.task_id;
            b.is_fixed = 1;
          }
          virtual.events.push({ ...b, id: randomUUID() });
        }
        result.operations.push(...day.operations);
        result.blocks.push(...day.blocks);
      }
      for (const t of state.tasks.filter(
        (t) =>
          t.status === 'pending' &&
          !state.tasks.some(
            (c) => c.parent_task_id === t.id && c.status !== 'completed',
          ),
      )) {
        const mins = virtual.events
          .filter(
            (e) =>
              e.task_id === t.id &&
              !e.completed_at &&
              Date.parse(e.end_at) > clock(),
          )
          .reduce(
            (n, e) =>
              n +
              (Date.parse(e.end_at) -
                Math.max(clock(), Date.parse(e.start_at))) /
                60000,
            0,
          );
        if (mins < (t.estimated_minutes || 30))
          result.warnings.push(
            `${String(t.title)}: осталось ${Math.ceil((t.estimated_minutes || 30) - mins)} мин. вне плана.`,
          );
      }
      if (
        state.events.some(
          (e) =>
            e.is_fixed &&
            new Date(e.start_at).getDay() === free &&
            e.start_at >= start &&
            Date.parse(e.start_at) < last.getTime(),
        )
      )
        result.warnings.push(
          'В свободный день остаются закреплённые встречи — они сохранены.',
        );
    } else if (input.kind === 'ics')
      result = importICS(
        text(input.source, 2000000),
        dateOnly(input.from),
        dateOnly(input.until),
      );
    else if (input.kind === 'purchase') {
      const tx = state.transactions.find(
        (t) => t.id === input.id && !t.actual_date && t.type === 'expense',
      );
      if (!tx) fail('Выберите плановый расход.');
      result = {
        kind: 'purchase',
        summary: `${String(tx.category)}: ${String(tx.planned_date)} → ${dateOnly(input.date)}`,
        operations: [
          { action: 'transaction.reschedule', id: tx.id, date: input.date },
        ],
        blocks: [],
        removed: [],
        warnings: [],
      };
    } else if (input.kind === 'capture') {
      if (!Array.isArray(input.items) || input.items.length > 100)
        fail('Максимум 100 записей.');
      const operations = input.items.map((item) => {
        const title = text(item.title),
          date = dateOnly(item.date),
          duration = integer(item.duration, 5, 1440);
        if (item.kind === 'task')
          return { action: 'quick.task', title, date, duration };
        choice(item.kind, ['event']);
        if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(item.time || ''))
          fail('Укажите время события.');
        const start = new Date(`${date}T${item.time}:00`);
        return {
          action: 'event.save',
          title,
          start_at: start.toISOString(),
          end_at: new Date(start.getTime() + duration * 60000).toISOString(),
          description: 'Быстрый ввод',
          color: 'violet',
          is_fixed: 1,
          reminder_minutes: 5,
        };
      });
      result = {
        kind: 'capture',
        summary: `Новые записи: ${operations.length}`,
        operations,
        blocks: operations.filter((o) => o.action === 'event.save'),
        removed: [],
        warnings: [],
      };
    } else fail('Неизвестный вид плана.');
    for (const b of result.blocks) {
      if (
        state.events.some(
          (e) =>
            !result.removed.some((r) => r.id === e.id) &&
            e.start_at < b.end_at &&
            e.end_at > b.start_at,
        )
      )
        result.warnings.push(
          `«${b.title}»: пересечение с текущим расписанием.`,
        );
    }
    const token = randomUUID();
    db.prepare(
      'DELETE FROM plan_previews WHERE expires_at<? AND applied_at IS NULL',
    ).run(now());
    db.prepare('INSERT INTO plan_previews VALUES(?,?,?,?,?,?,?,?,NULL)').run(
      token,
      user.id,
      result.kind,
      result.summary,
      JSON.stringify(result.operations),
      baseline(),
      now(),
      new Date(clock() + 15 * 60000).toISOString(),
    );
    return { ...result, token };
  }
  function uploadResource(meta, bytes) {
    const task = meta.task_id ? taskById(meta.task_id) : null,
      note = meta.note_id
        ? db
            .prepare('SELECT id FROM notes WHERE id=? AND user_id=?')
            .get(text(meta.note_id), user.id)
        : null;
    if (!task && !note) fail('Сначала сохраните задачу или заметку.');
    if (!bytes.length || bytes.length > 8 * 1024 * 1024)
      fail('Размер файла — до 8 МБ.');
    if (
      db.prepare('SELECT coalesce(sum(size),0) n FROM resources').get().n +
        bytes.length >
      40 * 1024 * 1024
    )
      fail('Материалы занимают 40 МБ. Удалите ненужные файлы.');
    db.prepare(
      'INSERT INTO resources(id,user_id,task_id,note_id,title,mime,content,size,created_at) VALUES(?,?,?,?,?,?,?,?,?)',
    ).run(
      randomUUID(),
      user.id,
      task?.id || null,
      note?.id || null,
      text(meta.title, 200),
      'application/octet-stream',
      bytes,
      bytes.length,
      now(),
    );
    return snapshot();
  }
  const resource = (id) =>
    db
      .prepare('SELECT * FROM resources WHERE id=? AND user_id=?')
      .get(text(id), user.id) || fail('Материал не найден.');
  function claimReminder(input) {
    const e = db
      .prepare('SELECT * FROM calendar_events WHERE id=? AND user_id=?')
      .get(text(input.id), user.id);
    if (!e || e.completed_at || clock() >= Date.parse(e.end_at))
      return { claimed: false };
    const start = Date.parse(e.start_at),
      trigger = e.snoozed_until
        ? Date.parse(e.snoozed_until)
        : clock() >= start
          ? start
          : start - (e.reminder_minutes || 0) * 60000;
    if (
      input.trigger !== trigger ||
      clock() < trigger ||
      clock() - trigger > 90000 ||
      (e.reminder_dismissed_at &&
        Date.parse(e.reminder_dismissed_at) >= trigger)
    )
      return { claimed: false };
    const key = `reminder:${String(e.id)}:${String(e.start_at)}:${trigger}`;
    return {
      claimed: !!db
        .prepare('INSERT OR IGNORE INTO applied_requests VALUES(?,?,?)')
        .run(key, user.id, now()).changes,
    };
  }
  const { inspectBackup, restoreBackup } = backupRestore({
    db,
    path,
    clock,
    snapshot,
    backup,
    transaction,
    reloadUser: () => {
      user = db.prepare('SELECT * FROM users LIMIT 1').get();
    },
    createStore,
    fail,
    integer,
    dateOnly,
    choice,
  });
  return {
    snapshot,
    revision,
    action,
    backup,
    inspectBackup,
    restoreBackup,
    preview,
    claimReminder,
    uploadResource,
    resource,
    close: () => db.close(),
  };
}
