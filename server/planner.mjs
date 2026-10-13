import { randomUUID } from 'node:crypto';
import { calendarActions } from './calendar-actions.mjs';

export function plannerActions(
  db,
  user,
  { text, integer, choice, dateOnly, timestamp, taskById, now, fail },
) {
  const advanced = calendarActions(db, user, {
    text,
    integer,
    choice,
    dateOnly,
    timestamp,
    taskById,
    now,
    fail,
  });
  const noteById = (id) =>
    db
      .prepare(
        'SELECT * FROM notes WHERE id=? AND user_id=? AND deleted_at IS NULL',
      )
      .get(text(id), user.id) || fail('Заметка не найдена.');
  return (input) => {
    if (advanced(input)) return true;
    switch (input.action) {
      case 'note.task': {
        const note = noteById(input.note_id),
          id = randomUUID();
        db.prepare(
          "INSERT INTO tasks(id,user_id,title,brain_hemisphere,required_energy,penalty_minor,status,created_at,estimated_minutes,source_note_id) VALUES(?,?,?,'analytical',5,0,'pending',?,?,?)",
        ).run(
          id,
          user.id,
          text(input.title),
          now(),
          integer(input.estimated_minutes ?? 30, 1, 1440),
          note.id,
        );
        return true;
      }
      case 'note.save': {
        const title = text(input.title, 160),
          body =
            typeof input.body === 'string' && input.body.length <= 50000
              ? input.body
              : fail('Заметка слишком большая.'),
          date = dateOnly(input.note_date);
        if (input.id) {
          const old = noteById(input.id);
          db.prepare(
            'UPDATE notes SET title=?,body=?,note_date=?,updated_at=? WHERE id=?',
          ).run(title, body, date, now(), old.id);
        } else
          db.prepare(
            'INSERT INTO notes(id,user_id,title,body,note_date,created_at,updated_at) VALUES(?,?,?,?,?,?,?)',
          ).run(randomUUID(), user.id, title, body, date, now(), now());
        return true;
      }
      case 'note.delete': {
        const old = noteById(input.id);
        db.prepare('DELETE FROM notes WHERE id=?').run(old.id);
        return true;
      }
      case 'task.plan': {
        const task = taskById(input.id),
          date = input.planned_date ? dateOnly(input.planned_date) : null,
          priority = input.is_priority ? 1 : 0;
        if (
          priority &&
          (task.board_status === 'waiting' || task.status === 'completed')
        )
          fail('Выберите доступную задачу.');
        if (priority && !date) fail('Выберите день для главной задачи.');
        if (
          priority &&
          db
            .prepare(
              'SELECT count(*) AS n FROM tasks WHERE user_id=? AND planned_date=? AND is_priority=1 AND id<>? AND deleted_at IS NULL',
            )
            .get(user.id, date, task.id).n >= 3
        )
          fail('На день можно выбрать до трёх главных задач.');
        db.prepare(
          'UPDATE tasks SET planned_date=?,is_priority=? WHERE id=?',
        ).run(date, priority, task.id);
        return true;
      }
      case 'task.reopen': {
        const task = taskById(input.id);
        if (task.status === 'active') fail('Сначала закончите текущую сессию.');
        db.prepare(
          "UPDATE tasks SET status='pending',completed_at=NULL,deadline=NULL WHERE id=?",
        ).run(task.id);
        return true;
      }
      default:
        return false;
    }
  };
}
