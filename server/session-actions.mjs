import { assertReady } from './workflow.mjs';
import { randomUUID } from 'node:crypto';
export function sessionActions(db, user, ctx) {
  const {
    transaction,
    clock,
    now,
    taskById,
    penalty,
    fail,
    text,
    integer,
    choice,
  } = ctx;
  const running = (id) =>
    db
      .prepare(
        "SELECT * FROM focus_sessions WHERE id=? AND phase IN ('preparation','work','break')",
      )
      .get(text(id)) || fail('Сессия уже завершена.');
  function reconcile() {
    transaction(() => {
      for (const s of db
        .prepare(
          "SELECT * FROM focus_sessions WHERE phase IN ('preparation','work','break') AND paused_at IS NULL",
        )
        .all()) {
        let phase = s.phase,
          end = Date.parse(s.phase_ends_at),
          success = s.is_successful;
        while (clock() >= end && phase !== 'completed') {
          if (phase === 'preparation') {
            phase = 'work';
            end += s.work_duration * 60000;
          } else if (phase === 'work') {
            phase = 'break';
            success = 1;
            end += s.break_duration * 60000;
          } else phase = 'completed';
        }
        if (phase === s.phase) continue;
        db.prepare(
          'UPDATE focus_sessions SET phase=?,phase_ends_at=?,is_successful=?,ended_at=? WHERE id=?',
        ).run(
          phase,
          new Date(end).toISOString(),
          success,
          phase === 'completed' ? new Date(end).toISOString() : null,
          s.id,
        );
        if (phase === 'completed')
          db.prepare(
            "UPDATE tasks SET status='pending' WHERE id=? AND status='active'",
          ).run(s.task_id);
      }
      for (const task of db
        .prepare(
          "SELECT * FROM tasks WHERE user_id=? AND status IN ('pending','active') AND deleted_at IS NULL AND deadline IS NOT NULL AND deadline<=? AND deadline_notified_at IS NULL",
        )
        .all(user.id, now())) {
        db.prepare('UPDATE tasks SET deadline_notified_at=? WHERE id=?').run(
          now(),
          task.id,
        );
        penalty(task, null, 'Пропущен срок', task.deadline);
      }
    });
  }

  function action(input) {
    switch (input.action) {
      case 'session.pause': {
        const s = running(input.id);
        if (s.paused_at) fail('Сессия уже на паузе.');
        db.prepare('UPDATE focus_sessions SET paused_at=? WHERE id=?').run(
          now(),
          s.id,
        );
        return true;
      }
      case 'session.resume': {
        const s = running(input.id);
        if (!s.paused_at) fail('Сессия не на паузе.');
        const elapsed = Math.max(0, clock() - Date.parse(s.paused_at));
        const pauses = JSON.parse(s.pauses_json);
        pauses.push({ start: s.paused_at, end: now(), phase: s.phase });
        db.prepare(
          'UPDATE focus_sessions SET paused_at=NULL,pauses_json=?,phase_ends_at=? WHERE id=?',
        ).run(
          JSON.stringify(pauses),
          new Date(Date.parse(s.phase_ends_at) + elapsed).toISOString(),
          s.id,
        );
        return true;
      }
      case 'session.start': {
        if (
          db
            .prepare(
              "SELECT id FROM focus_sessions WHERE phase IN ('preparation','work','break')",
            )
            .get()
        )
          fail('Сначала завершите текущую сессию.');
        const task = taskById(input.task_id);
        assertReady(db, task, fail);
        if (task.status !== 'pending') fail('Задача недоступна для запуска.');
        const preparation = integer(input.dopamine_debt_duration, 0, 20),
          work = integer(input.work_duration, 1, 120),
          rest = integer(input.break_duration, 1, 60);
        const audio = choice(input.audio_type, [
          'none',
          'binaural',
          'isochronic',
          'baroque',
        ]);
        db.prepare(
          'INSERT INTO focus_sessions(id,task_id,dopamine_debt_duration,work_duration,break_duration,audio_type,phase,started_at,phase_ends_at) VALUES(?,?,?,?,?,?,?,?,?)',
        ).run(
          randomUUID(),
          task.id,
          preparation,
          work,
          rest,
          audio,
          'preparation',
          now(),
          new Date(clock() + preparation * 60000).toISOString(),
        );
        db.prepare(
          "UPDATE tasks SET status='active',board_status='doing' WHERE id=?",
        ).run(task.id);
        return true;
      }
      case 'session.cancel': {
        const s = db
          .prepare(
            "SELECT * FROM focus_sessions WHERE id=? AND phase IN ('preparation','work','break')",
          )
          .get(text(input.id));
        if (!s) fail('Сессия уже завершена.');
        const task = taskById(s.task_id);
        if (s.paused_at) {
          const pauses = JSON.parse(s.pauses_json);
          pauses.push({ start: s.paused_at, end: now(), phase: s.phase });
          db.prepare(
            'UPDATE focus_sessions SET paused_at=NULL,pauses_json=? WHERE id=?',
          ).run(JSON.stringify(pauses), s.id);
        }
        // A completed work stage remains successful when the user ends their break.
        if (s.phase === 'break') {
          db.prepare(
            "UPDATE focus_sessions SET phase='completed',ended_at=? WHERE id=?",
          ).run(now(), s.id);
          db.prepare("UPDATE tasks SET status='pending' WHERE id=?").run(
            task.id,
          );
        } else {
          db.prepare(
            "UPDATE focus_sessions SET phase='cancelled',is_successful=0,ended_at=? WHERE id=?",
          ).run(now(), s.id);
          db.prepare("UPDATE tasks SET status='pending' WHERE id=?").run(
            task.id,
          );
          penalty(task, s.id, 'Прерван фокус', now());
        }
        return true;
      }

      default:
        return false;
    }
  }
  return { reconcile, sessionAction: action };
}
