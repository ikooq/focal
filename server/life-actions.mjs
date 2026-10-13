import { isAbsolute } from 'node:path';
import { randomUUID } from 'node:crypto';
const COLORS = ['emerald', 'sky', 'violet', 'rose', 'amber'];
export function lifeActions(db, user, ctx) {
  const { text, integer, dateOnly, choice, taskById, now, fail, moneyMinor } =
    ctx;
  const body = (v, max = 10000) =>
    typeof v === 'string' && v.length <= max
      ? v
      : fail('Текст слишком длинный.');
  const row = (table, id) =>
    db
      .prepare(`SELECT * FROM ${table} WHERE id=? AND user_id=?`)
      .get(text(id), user.id) || fail('Запись не найдена.');
  const project = (id) => {
    const p = id ? row('projects', id) : null;
    if (p?.deleted_at) fail('Проект в корзине.');
    return p;
  };
  const session = (id, taskId) => {
    if (!id) return null;
    const s = db
      .prepare(
        'SELECT s.* FROM focus_sessions s JOIN tasks t ON t.id=s.task_id WHERE s.id=? AND t.user_id=?',
      )
      .get(text(id), user.id);
    if (!s || s.task_id !== taskId) fail('Сессия не относится к этой задаче.');
    return s.id;
  };
  return (input) => {
    switch (input.action) {
      case 'project.save': {
        const title = text(input.title),
          description = body(input.description || ''),
          date = input.target_date ? dateOnly(input.target_date) : null,
          color = choice(input.color || 'emerald', COLORS);
        if (input.id) {
          const old = project(input.id);
          db.prepare(
            'UPDATE projects SET title=?,description=?,target_date=?,color=?,updated_at=? WHERE id=?',
          ).run(title, description, date, color, now(), old.id);
        } else
          db.prepare(
            'INSERT INTO projects(id,user_id,title,description,target_date,color,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)',
          ).run(
            randomUUID(),
            user.id,
            title,
            description,
            date,
            color,
            now(),
            now(),
          );
        return true;
      }
      case 'project.archive': {
        const p = project(input.id);
        db.prepare(
          'UPDATE projects SET archived=?,updated_at=? WHERE id=?',
        ).run(input.archived === false ? 0 : 1, now(), p.id);
        return true;
      }
      case 'project.task': {
        const p = project(input.project_id),
          parent = input.parent_task_id ? taskById(input.parent_task_id) : null;
        if (parent?.recurrence_json)
          fail('Повторяющаяся задача не может иметь подзадачи.');
        if (!p || p.archived) fail('Выберите активный проект.');
        if (
          parent &&
          (parent.project_id !== p.id ||
            parent.parent_task_id ||
            !['pending', 'active'].includes(parent.status))
        )
          fail('Выберите незавершённую основную задачу этого проекта.');
        db.prepare(
          "INSERT INTO tasks(id,user_id,title,brain_hemisphere,required_energy,penalty_minor,status,created_at,estimated_minutes,project_id,parent_task_id) VALUES(?,?,?,'analytical',5,0,'pending',?,?,?,?)",
        ).run(
          randomUUID(),
          user.id,
          text(input.title),
          now(),
          integer(input.estimated_minutes ?? 30, 1, 1440),
          p.id,
          parent?.id || null,
        );
        return true;
      }
      case 'task.organize': {
        const task = taskById(input.id),
          p = project(input.project_id),
          parent = input.parent_task_id ? taskById(input.parent_task_id) : null;
        if (parent?.recurrence_json || (task.recurrence_json && parent))
          fail('Повторяющаяся задача не может иметь подзадачи.');
        if (
          parent &&
          (parent.id === task.id ||
            parent.parent_task_id ||
            parent.project_id !== (p?.id || null))
        )
          fail(
            'Подзадача должна относиться к основной задаче того же проекта.',
          );
        if (
          parent &&
          db
            .prepare('SELECT id FROM tasks WHERE parent_task_id=? LIMIT 1')
            .get(task.id)
        )
          fail('У этой задачи уже есть подзадачи.');
        db.prepare(
          'UPDATE tasks SET project_id=?,parent_task_id=? WHERE id=?',
        ).run(p?.id || null, parent?.id || null, task.id);
        db.prepare('UPDATE tasks SET project_id=? WHERE parent_task_id=?').run(
          p?.id || null,
          task.id,
        );
        return true;
      }
      case 'checkpoint.add': {
        const task = taskById(input.task_id);
        db.prepare('INSERT INTO work_checkpoints VALUES(?,?,?,?,?,?,?)').run(
          randomUUID(),
          user.id,
          task.id,
          session(input.session_id, task.id),
          text(input.summary, 5000),
          body(input.next_step || '', 1000),
          now(),
        );
        return true;
      }
      case 'thought.add': {
        const task = input.task_id ? taskById(input.task_id) : null;
        db.prepare(
          'INSERT INTO focus_thoughts(id,user_id,task_id,session_id,body,created_at) VALUES(?,?,?,?,?,?)',
        ).run(
          randomUUID(),
          user.id,
          task?.id || null,
          session(input.session_id, task?.id),
          text(input.body, 5000),
          now(),
        );
        return true;
      }
      case 'thought.convert': {
        const thought = row('focus_thoughts', input.id);
        if (thought.resolved_at) fail('Эта мысль уже разобрана.');
        const id = randomUUID(),
          kind = choice(input.kind, ['note', 'task']);
        if (kind === 'note')
          db.prepare(
            'INSERT INTO notes(id,user_id,title,body,note_date,created_at,updated_at) VALUES(?,?,?,?,?,?,?)',
          ).run(
            id,
            user.id,
            text(input.title || thought.body.slice(0, 120)),
            thought.body,
            dateOnly(input.date),
            now(),
            now(),
          );
        else
          db.prepare(
            "INSERT INTO tasks(id,user_id,title,brain_hemisphere,required_energy,penalty_minor,status,created_at) VALUES(?,?,?,'analytical',5,0,'pending',?)",
          ).run(
            id,
            user.id,
            text(input.title || thought.body.slice(0, 120)),
            now(),
          );
        db.prepare(
          'UPDATE focus_thoughts SET resolved_at=?,destination=? WHERE id=?',
        ).run(now(), `${kind}:${id}`, thought.id);
        return true;
      }
      case 'thought.dismiss': {
        const thought = row('focus_thoughts', input.id);
        db.prepare('UPDATE focus_thoughts SET resolved_at=? WHERE id=?').run(
          now(),
          thought.id,
        );
        return true;
      }
      case 'habit.save': {
        const title = text(input.title),
          target = integer(input.target_per_week, 1, 7),
          color = choice(input.color || 'emerald', COLORS);
        if (input.id) {
          const old = row('habits', input.id);
          db.prepare(
            'UPDATE habits SET title=?,target_per_week=?,color=? WHERE id=?',
          ).run(title, target, color, old.id);
        } else
          db.prepare(
            'INSERT INTO habits(id,user_id,title,target_per_week,color,created_at) VALUES(?,?,?,?,?,?)',
          ).run(randomUUID(), user.id, title, target, color, now());
        return true;
      }
      case 'habit.archive': {
        const old = row('habits', input.id);
        db.prepare('UPDATE habits SET archived=? WHERE id=?').run(
          input.archived === false ? 0 : 1,
          old.id,
        );
        return true;
      }
      case 'habit.check': {
        const habit = row('habits', input.id),
          date = dateOnly(input.date);
        const local = new Date(now());
        const today = `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, '0')}-${String(local.getDate()).padStart(2, '0')}`;
        if (date > today)
          fail('Будущую привычку можно отметить после выполнения.');
        if (input.checked === false)
          db.prepare(
            'DELETE FROM habit_checks WHERE habit_id=? AND check_date=?',
          ).run(habit.id, date);
        else
          db.prepare('INSERT OR IGNORE INTO habit_checks VALUES(?,?,?,?)').run(
            randomUUID(),
            habit.id,
            date,
            now(),
          );
        return true;
      }
      case 'decision.save': {
        const title = text(input.title),
          reasons = body(input.reasons || ''),
          expected = body(input.expected || ''),
          outcome = body(input.outcome || ''),
          date = dateOnly(input.decided_on),
          review = input.review_on ? dateOnly(input.review_on) : null;
        if (review && review < date)
          fail('Дата разбора должна быть не раньше решения.');
        if (input.id) {
          const old = row('decisions', input.id);
          db.prepare(
            'UPDATE decisions SET title=?,reasons=?,expected=?,outcome=?,decided_on=?,review_on=?,reviewed_at=?,updated_at=? WHERE id=?',
          ).run(
            title,
            reasons,
            expected,
            outcome,
            date,
            review,
            outcome ? now() : null,
            now(),
            old.id,
          );
        } else
          db.prepare('INSERT INTO decisions VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(
            randomUUID(),
            user.id,
            title,
            reasons,
            expected,
            outcome,
            date,
            review,
            outcome ? now() : null,
            now(),
            now(),
          );
        return true;
      }
      case 'decision.delete': {
        db.prepare('DELETE FROM decisions WHERE id=?').run(
          row('decisions', input.id).id,
        );
        return true;
      }
      case 'resource.link': {
        const task = input.task_id ? taskById(input.task_id) : null,
          note = input.note_id ? row('notes', input.note_id) : null;
        if (!task && !note) fail('Выберите задачу или заметку.');
        let url;
        try {
          url = new URL(text(input.url, 2000));
        } catch {
          fail('Некорректная ссылка.');
        }
        if (!['https:', 'http:'].includes(url.protocol))
          fail('Поддерживаются ссылки http и https.');
        db.prepare(
          'INSERT INTO resources(id,user_id,task_id,note_id,title,url,created_at) VALUES(?,?,?,?,?,?,?)',
        ).run(
          randomUUID(),
          user.id,
          task?.id || null,
          note?.id || null,
          text(input.title),
          url.href,
          now(),
        );
        return true;
      }
      case 'resource.delete': {
        db.prepare('DELETE FROM resources WHERE id=?').run(
          row('resources', input.id).id,
        );
        return true;
      }
      case 'settings.save': {
        const old = JSON.parse(
          db
            .prepare('SELECT json FROM user_settings WHERE user_id=?')
            .get(user.id)?.json || '{}',
        );
        const next = { ...old };
        if ('auto_backup' in input) {
          if (typeof input.auto_backup !== 'boolean')
            fail('Некорректная настройка копирования.');
          next.auto_backup = input.auto_backup;
        }
        if ('backup_folder' in input) {
          if (
            typeof input.backup_folder !== 'string' ||
            input.backup_folder.length > 1000 ||
            (input.backup_folder && !isAbsolute(input.backup_folder))
          )
            fail('Укажите полный путь папки.');
          next.backup_folder = input.backup_folder;
        }
        for (const [key, allowed] of [
          ['hidden_sections', ['energy', 'finance', 'life', 'studio']],
          ['hidden_life_sections', ['habits', 'decisions']],
        ]) {
          if (key in input) {
            if (
              !Array.isArray(input[key]) ||
              input[key].some((v) => !allowed.includes(v))
            )
              fail('Неизвестный раздел.');
            next[key] = [...new Set(input[key])];
          }
        }
        for (const [key, min, max] of [
          ['day_start', 0, 23],
          ['day_end', 1, 24],
          ['daily_limit', 15, 720],
          ['buffer_minutes', 0, 60],
          ['session_minutes', 5, 120],
        ])
          if (key in input) next[key] = integer(input[key], min, max);
        if ((next.day_start ?? 9) >= (next.day_end ?? 19))
          fail('Конец рабочего дня должен быть позже начала.');
        if ('opening_balance' in input) {
          const value = String(input.opening_balance);
          next.opening_balance_minor =
            (value.startsWith('-') ? -1 : 1) *
            moneyMinor(value.replace(/^-/, '').trim());
        }
        if ('balance_date' in input) {
          const date = dateOnly(input.balance_date),
            d = new Date(now()),
            today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
          if (date > today || date < '2000-01-01')
            fail(
              'Дата остатка должна быть между 2000 годом и сегодняшним днём.',
            );
          next.balance_date = date;
        }
        if ('motion' in input)
          next.motion = choice(input.motion, ['full', 'gentle', 'off']);
        db.prepare('INSERT OR REPLACE INTO user_settings VALUES(?,?)').run(
          user.id,
          JSON.stringify(next),
        );
        return true;
      }
      case 'flow.save': {
        const amount = moneyMinor(input.amount);
        if (!amount) fail('Укажите сумму больше нуля.');
        const start = dateOnly(input.start_date),
          end = input.end_date ? dateOnly(input.end_date) : null;
        if (end && end < start) fail('Окончание должно быть позже начала.');
        const values = [
          text(input.title),
          choice(input.type, ['income', 'expense']),
          amount,
          choice(input.frequency, ['weekly', 'monthly']),
          start,
          end,
        ];
        if (input.id) {
          const old = row('recurring_flows', input.id);
          db.prepare(
            'UPDATE recurring_flows SET title=?,type=?,amount_minor=?,frequency=?,start_date=?,end_date=? WHERE id=?',
          ).run(...values, old.id);
        } else
          db.prepare(
            'INSERT INTO recurring_flows(id,user_id,title,type,amount_minor,frequency,start_date,end_date,created_at) VALUES(?,?,?,?,?,?,?,?,?)',
          ).run(randomUUID(), user.id, ...values, now());
        return true;
      }
      case 'flow.toggle': {
        const flow = row('recurring_flows', input.id);
        db.prepare('UPDATE recurring_flows SET enabled=? WHERE id=?').run(
          input.enabled === false ? 0 : 1,
          flow.id,
        );
        return true;
      }
      case 'flow.settle': {
        const flow = row('recurring_flows', input.id),
          date = dateOnly(input.date);
        if (date < flow.start_date || (flow.end_date && date > flow.end_date))
          fail('Дата вне периода платежа.');
        const d = new Date(date + 'T12:00:00'),
          first = new Date(flow.start_date + 'T12:00:00');
        if (flow.frequency === 'weekly') {
          const days =
            (Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) -
              Date.UTC(
                first.getFullYear(),
                first.getMonth(),
                first.getDate(),
              )) /
            86400000;
          if (days % 7) fail('Дата не совпадает с расписанием платежа.');
        } else if (
          d.getDate() !==
          Math.min(
            first.getDate(),
            new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate(),
          )
        )
          fail('Дата не совпадает с расписанием платежа.');
        const actual = dateOnly(input.actual_date);
        if (
          new Date(actual + 'T23:59:59').getTime() >
          new Date(now()).setHours(23, 59, 59, 999)
        )
          fail('Будущую операцию нельзя отметить проведённой.');
        db.prepare(
          'INSERT OR IGNORE INTO financial_transactions(id,user_id,type,amount_minor,category,planned_date,actual_date,idempotency_key,created_at,recurring_id) VALUES(?,?,?,?,?,?,?,?,?,?)',
        ).run(
          randomUUID(),
          user.id,
          flow.type,
          flow.amount_minor,
          flow.title,
          date,
          actual,
          `flow:${flow.id}:${date}`,
          now(),
          flow.id,
        );
        return true;
      }
      default:
        return false;
    }
  };
}
