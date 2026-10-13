import { randomUUID } from 'node:crypto';

export const listJSON = (value) => JSON.parse(value || '[]');
export function validateTaskGraph(tasks, fail) {
  const edges = new Map(
    tasks.map((t) => [
      t.id,
      [
        ...listJSON(t.dependencies_json),
        ...tasks.filter((c) => c.parent_task_id === t.id).map((c) => c.id),
      ],
    ]),
  );
  const done = new Set(),
    visiting = new Set();
  function visit(id) {
    if (visiting.has(id)) fail('Зависимости не должны образовывать круг.');
    if (done.has(id)) return;
    visiting.add(id);
    for (const next of edges.get(id) || []) visit(next);
    visiting.delete(id);
    done.add(id);
  }
  for (const id of edges.keys()) visit(id);
}
export function blockers(db, task) {
  const children = db
    .prepare(
      "SELECT title FROM tasks WHERE parent_task_id=? AND status!='completed' AND deleted_at IS NULL",
    )
    .all(task.id)
    .map((t) => t.title);
  return [
    ...children,
    ...listJSON(task.dependencies_json)
      .map((id) =>
        db
          .prepare('SELECT id,title,status,deleted_at FROM tasks WHERE id=?')
          .get(id),
      )
      .filter((t) => !t || t.status !== 'completed' || t.deleted_at)
      .map((t) =>
        t
          ? `${t.title}${t.deleted_at ? ' (в корзине)' : ''}`
          : 'Удалённая задача',
      ),
  ];
}
export function assertReady(db, task, fail) {
  if (task.deleted_at) fail('Задача в корзине. Сначала восстановите её.');
  if (task.board_status === 'waiting')
    fail('Задача ожидает ответа. Сначала верните её в работу.');
  if (
    db
      .prepare(
        "SELECT id FROM tasks WHERE parent_task_id=? AND status!='completed' AND deleted_at IS NULL",
      )
      .get(task.id)
  )
    fail('Сначала завершите подзадачи.');
  const blocked = blockers(db, task);
  if (blocked.length) fail('Сначала завершите: ' + blocked.join(', '));
}
const dateKey = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export function nextOccurrence(rule, planned, completed) {
  const today = dateKey(new Date(completed));
  const base = rule.mode === 'after' ? today : planned || today;
  const d = new Date(base + 'T12:00:00');
  if (rule.mode === 'monthly') {
    const day = rule.day || d.getDate();
    do {
      d.setDate(1);
      d.setMonth(d.getMonth() + rule.every);
      d.setDate(
        Math.min(day, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()),
      );
    } while (dateKey(d) <= today);
  } else {
    do {
      d.setDate(d.getDate() + rule.every);
    } while (dateKey(d) <= today);
  }
  return dateKey(d);
}
export function workflowActions(
  db,
  user,
  { taskById, text, integer, choice, dateOnly, now, fail },
) {
  const saveSettings = (fn) => {
    const s = JSON.parse(
      db.prepare('SELECT json FROM user_settings WHERE user_id=?').get(user.id)
        ?.json || '{}',
    );
    fn(s);
    db.prepare('INSERT OR REPLACE INTO user_settings VALUES(?,?)').run(
      user.id,
      JSON.stringify(s),
    );
  };
  function configure(task, input) {
    if ('tags' in input) {
      const tags = Array.isArray(input.tags)
        ? input.tags
        : String(input.tags)
            .split(',')
            .map((v) => v.trim())
            .filter(Boolean);
      if (tags.length > 12) fail('Не больше 12 меток.');
      db.prepare('UPDATE tasks SET tags_json=? WHERE id=?').run(
        JSON.stringify([...new Set(tags.map((v) => text(v, 40)))]),
        task.id,
      );
    }
    if ('dependencies' in input) {
      if (!Array.isArray(input.dependencies) || input.dependencies.length > 50)
        fail('Не больше 50 зависимостей.');
      const ids = [...new Set(input.dependencies.map((id) => taskById(id).id))];
      const reaches = (id, seen = new Set()) => {
        if (id === task.id) return true;
        if (seen.has(id)) return false;
        seen.add(id);
        const children = db
          .prepare(
            'SELECT id FROM tasks WHERE parent_task_id=? AND deleted_at IS NULL',
          )
          .all(id)
          .map((t) => t.id);
        return [...children, ...listJSON(taskById(id).dependencies_json)].some(
          (next) => reaches(next, seen),
        );
      };
      if (ids.some((id) => reaches(id)))
        fail('Зависимости не должны образовывать круг.');
      if (task.status === 'active') fail('Сначала завершите фокус.');
      db.prepare('UPDATE tasks SET dependencies_json=? WHERE id=?').run(
        JSON.stringify(ids),
        task.id,
      );
    }
    if ('recurrence' in input) {
      let rule = input.recurrence;
      if (rule) {
        rule = {
          mode: choice(rule.mode, ['days', 'monthly', 'after']),
          every: integer(rule.every, 1, rule.mode === 'monthly' ? 24 : 365),
          day: integer(
            rule.day ||
              new Date(
                (task.planned_date || dateKey(new Date(now()))) + 'T12:00:00',
              ).getDate(),
            1,
            31,
          ),
        };
        if (
          task.parent_task_id ||
          db
            .prepare(
              'SELECT id FROM tasks WHERE parent_task_id=? AND deleted_at IS NULL',
            )
            .get(task.id)
        )
          fail('Повторение доступно для задачи без подзадач.');
      }
      db.prepare(
        'UPDATE tasks SET recurrence_json=?,series_key=coalesce(series_key,?) WHERE id=?',
      ).run(rule ? JSON.stringify(rule) : null, task.id, task.id);
    }
  }
  function repeatCompleted() {
    for (const task of db
      .prepare(
        "SELECT * FROM tasks WHERE user_id=? AND status='completed' AND deleted_at IS NULL AND recurrence_json IS NOT NULL AND recurrence_next_id IS NULL",
      )
      .all(user.id)) {
      const id = randomUUID(),
        date = nextOccurrence(
          JSON.parse(task.recurrence_json),
          task.planned_date,
          task.completed_at,
        );
      db.prepare(`INSERT INTO tasks(id,user_id,title,brain_hemisphere,required_energy,penalty_minor,status,created_at,estimated_minutes,planned_date,project_id,tags_json,recurrence_json,series_key)
        VALUES(?,?,?,?,?,?,'pending',?,?,?,?,?,?,?)`).run(
        id,
        user.id,
        task.title,
        task.brain_hemisphere,
        task.required_energy,
        task.penalty_minor,
        now(),
        task.estimated_minutes,
        date,
        task.project_id,
        task.tags_json,
        task.recurrence_json,
        task.series_key || task.id,
      );
      db.prepare('UPDATE tasks SET recurrence_next_id=? WHERE id=?').run(
        id,
        task.id,
      );
    }
  }
  function action(input) {
    switch (input.action) {
      case 'task.configure':
        configure(taskById(input.id), input);
        return true;
      case 'task.stage': {
        const task = taskById(input.id);
        if (task.status === 'active') fail('Сначала завершите фокус.');
        if (task.status === 'completed' && input.reopen !== true)
          fail('Сначала верните задачу в работу.');
        const stage = choice(input.stage, ['planned', 'doing', 'waiting']);
        if (stage === 'doing')
          assertReady(db, { ...task, board_status: 'planned' }, fail);
        const reason = input.waiting_reason
          ? text(input.waiting_reason, 500)
          : '';
        if (task.status === 'completed')
          db.prepare(
            "UPDATE tasks SET status='pending',completed_at=NULL,deadline=NULL WHERE id=?",
          ).run(task.id);
        db.prepare(
          "UPDATE tasks SET board_status=?,waiting_reason=?,is_priority=CASE WHEN ?='waiting' THEN 0 ELSE is_priority END WHERE id=?",
        ).run(stage, reason, stage, task.id);
        return true;
      }
      case 'task.estimate': {
        const task = taskById(input.id);
        if (task.status !== 'pending')
          fail('Оценка доступна для незавершённой задачи.');
        db.prepare(
          'UPDATE tasks SET estimated_minutes=?,estimate_applied_at=? WHERE id=?',
        ).run(integer(input.minutes, 1, 1440), now(), task.id);
        return true;
      }
      case 'task.bulk': {
        if (
          !Array.isArray(input.ids) ||
          !input.ids.length ||
          input.ids.length > 500
        )
          fail('Выберите от 1 до 500 задач.');
        const tasks = [...new Set(input.ids)].map(taskById);
        choice(input.operation, [
          'plan',
          'project',
          'tag',
          'complete',
          'trash',
        ]);
        if (tasks.some((t) => t.status === 'active'))
          fail('В выборе есть задача с активным фокусом.');
        if (input.operation === 'complete') {
          const remaining = tasks.filter((t) => t.status === 'pending');
          while (remaining.length) {
            const index = remaining.findIndex(
              (t) => t.board_status !== 'waiting' && !blockers(db, t).length,
            );
            if (index < 0) {
              assertReady(db, remaining[0], fail);
              fail('Сначала завершите подзадачи.');
            }
            const [task] = remaining.splice(index, 1);
            db.prepare(
              "UPDATE tasks SET status='completed',completed_at=? WHERE id=?",
            ).run(now(), task.id);
          }
          return true;
        }
        for (const task of tasks) {
          if (task.status === 'active')
            fail('В выборе есть задача с активным фокусом.');
          if (input.operation === 'plan')
            db.prepare(
              'UPDATE tasks SET planned_date=?,is_priority=0 WHERE id=?',
            ).run(input.date ? dateOnly(input.date) : null, task.id);
          if (input.operation === 'tag')
            configure(task, {
              tags: [
                ...new Set([...listJSON(task.tags_json), text(input.tag, 40)]),
              ],
            });
          if (input.operation === 'project') {
            if (
              task.parent_task_id &&
              tasks.some((t) => t.id === task.parent_task_id)
            )
              continue;
            const p = input.project_id
              ? db
                  .prepare(
                    'SELECT id FROM projects WHERE id=? AND user_id=? AND deleted_at IS NULL AND archived=0',
                  )
                  .get(text(input.project_id), user.id)
              : null;
            if (input.project_id && !p) fail('Проект не найден.');
            if (task.parent_task_id)
              fail('Переносите подзадачи вместе с основной задачей.');
            db.prepare(
              'UPDATE tasks SET project_id=? WHERE id=? OR parent_task_id=?',
            ).run(p?.id || null, task.id, task.id);
          }
          if (
            input.operation === 'trash' &&
            !(
              task.parent_task_id &&
              tasks.some((t) => t.id === task.parent_task_id)
            )
          )
            action({ action: 'trash.move', kind: 'task', id: task.id });
        }
        return true;
      }
      case 'note.delete':
        return action({ ...input, action: 'trash.move', kind: 'note' });
      case 'trash.move': {
        const table = { task: 'tasks', note: 'notes', project: 'projects' }[
          choice(input.kind, ['task', 'note', 'project'])
        ];
        const row = db
          .prepare(
            `SELECT * FROM ${table} WHERE id=? AND user_id=? AND deleted_at IS NULL`,
          )
          .get(text(input.id), user.id);
        if (!row) fail('Запись не найдена.');
        const batch = randomUUID();
        if (input.kind !== 'note') {
          const items = db
            .prepare(
              input.kind === 'task'
                ? 'SELECT * FROM tasks WHERE (id=? OR parent_task_id=?) AND deleted_at IS NULL'
                : 'SELECT * FROM tasks WHERE project_id=? AND deleted_at IS NULL',
            )
            .all(...(input.kind === 'task' ? [row.id, row.id] : [row.id]));
          if (items.some((t) => t.status === 'active'))
            fail('Сначала завершите фокус.');
          for (const t of items)
            db.prepare(
              'UPDATE tasks SET deleted_at=?,trash_batch=?,is_priority=0 WHERE id=?',
            ).run(now(), batch, t.id);
        }
        db.prepare(
          `UPDATE ${table} SET deleted_at=?,trash_batch=? WHERE id=?`,
        ).run(now(), batch, row.id);
        db.prepare('DELETE FROM calendar_undo WHERE user_id=?').run(user.id);
        return true;
      }
      case 'trash.restore': {
        const batch = text(input.batch);
        // Restore the entire deletion group, preserving project/subtask relationships.
        const tasks = db
          .prepare('SELECT * FROM tasks WHERE trash_batch=? AND user_id=?')
          .all(batch, user.id);
        for (const task of tasks) {
          if (
            task.project_id &&
            db
              .prepare('SELECT deleted_at,trash_batch FROM projects WHERE id=?')
              .get(task.project_id)?.deleted_at
          ) {
            const p = db
              .prepare('SELECT trash_batch FROM projects WHERE id=?')
              .get(task.project_id);
            if (p.trash_batch !== batch) fail('Сначала восстановите проект.');
          }
          if (task.parent_task_id) {
            const parent = db
              .prepare('SELECT deleted_at,trash_batch FROM tasks WHERE id=?')
              .get(task.parent_task_id);
            if (parent?.deleted_at && parent.trash_batch !== batch)
              fail('Сначала восстановите основную задачу.');
          }
        }
        for (const table of ['projects', 'tasks', 'notes'])
          db.prepare(
            `UPDATE ${table} SET deleted_at=NULL,trash_batch=NULL WHERE trash_batch=? AND user_id=?`,
          ).run(batch, user.id);
        return true;
      }
      case 'view.save': {
        const name = text(input.name, 60),
          filter = input.filter;
        if (!filter || typeof filter !== 'object') fail('Некорректный фильтр.');
        const clean = {
          query: String(filter.query || '').slice(0, 160),
          tag: String(filter.tag || '').slice(0, 40),
          project: String(filter.project || '').slice(0, 160),
          status: choice(filter.status || 'open', [
            'open',
            'all',
            'waiting',
            'completed',
            'short',
            'energy',
            'overdue',
          ]),
        };
        saveSettings((s) => {
          s.saved_views ||= [];
          if (s.saved_views.length >= 20) fail('Не больше 20 представлений.');
          s.saved_views.push({ id: randomUUID(), name, filter: clean });
        });
        return true;
      }
      case 'view.delete':
        saveSettings((s) => {
          s.saved_views = (s.saved_views || []).filter(
            (v) => v.id !== input.id,
          );
        });
        return true;
      default:
        return false;
    }
  }
  return { action, configure, repeatCompleted };
}
