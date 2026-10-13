import { assertReady } from './workflow.mjs';
import { randomUUID } from 'node:crypto';

export function dayActions(
  db,
  user,
  { now, clock, text, dateOnly, fail, taskById },
) {
  return (input) => {
    if (input.action !== 'day.finish') return false;
    const date = dateOnly(input.date);
    const today = new Date(clock());
    const local = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    if (date !== local) fail('День изменился. Откройте завершение дня заново.');
    const tomorrow = new Date(`${date}T12:00:00`);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const next = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;
    if (!Array.isArray(input.tasks) || input.tasks.length > 500)
      fail('Некорректный список задач.');
    const seen = new Set();
    for (const item of input.tasks) {
      if (seen.has(item.id)) fail('Задача указана дважды.');
      seen.add(item.id);
      const task = taskById(item.id);
      if (task.status !== 'pending' || task.planned_date !== date)
        fail('Задача изменилась. Обновите список.');
      if (!['tomorrow', 'backlog', 'complete'].includes(item.choice))
        fail('Выберите действие для задачи.');
      if (item.choice === 'complete') {
        assertReady(db, task, fail);
        if (
          db
            .prepare(
              "SELECT id FROM tasks WHERE parent_task_id=? AND status!='completed' AND deleted_at IS NULL",
            )
            .get(task.id)
        )
          fail('Сначала завершите подзадачи.');
        db.prepare(
          "UPDATE tasks SET status='completed',completed_at=? WHERE id=?",
        ).run(now(), task.id);
      } else {
        db.prepare(
          'UPDATE tasks SET planned_date=?,is_priority=0 WHERE id=?',
        ).run(item.choice === 'tomorrow' ? next : null, task.id);
      }
    }
    if (input.first_task_id) {
      const task = taskById(input.first_task_id);
      if (task.status !== 'pending')
        fail('Первое дело должно быть доступно для работы.');
      const count = db
        .prepare(
          "SELECT count(*) n FROM tasks WHERE user_id=? AND planned_date=? AND is_priority=1 AND id!=? AND status!='completed'",
        )
        .get(user.id, next, task.id).n;
      if (count >= 3)
        fail(
          'На завтра уже выбраны три главных дела. Сначала освободите место.',
        );
      db.prepare(
        'UPDATE tasks SET planned_date=?,is_priority=1 WHERE id=?',
      ).run(next, task.id);
      if (input.next_step?.trim())
        db.prepare(
          'INSERT INTO work_checkpoints(id,user_id,task_id,summary,next_step,created_at) VALUES(?,?,?,?,?,?)',
        ).run(
          randomUUID(),
          user.id,
          task.id,
          'Первое дело на завтра',
          text(input.next_step, 10000),
          now(),
        );
    } else if (input.next_step?.trim())
      fail('Выберите задачу для следующего шага.');
    if (input.summary?.trim()) {
      const title = 'Итоги дня';
      const existing = db
        .prepare(
          'SELECT id FROM notes WHERE user_id=? AND note_date=? AND title=? AND deleted_at IS NULL',
        )
        .get(user.id, date, title);
      if (existing)
        db.prepare('UPDATE notes SET body=?,updated_at=? WHERE id=?').run(
          text(input.summary, 10000),
          now(),
          existing.id,
        );
      else
        db.prepare(
          'INSERT INTO notes(id,user_id,title,body,note_date,created_at,updated_at) VALUES(?,?,?,?,?,?,?)',
        ).run(
          randomUUID(),
          user.id,
          title,
          text(input.summary, 10000),
          date,
          now(),
          now(),
        );
    }
    return true;
  };
}
