import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore } from '../server/store.mjs';
import {
  suggestSlots,
  freeMinutes,
  learnedEstimate,
  weeklyReview,
  previewTemplate,
  focusInRange,
} from '../lib/planning.ts';
import { reminderFor } from '../lib/reminders.ts';

process.env.TZ = 'America/New_York';
const instant = new Date('2026-09-06T09:00:00Z');
const clock = () => instant.getTime();
const iso = (v) => new Date(v).toISOString();
const event = {
  action: 'event.save',
  title: 'Английский',
  description: 'Практика',
  start_at: iso('2026-09-07T09:00:00'),
  end_at: iso('2026-09-07T10:00:00'),
  color: 'violet',
  reminder_minutes: 15,
};
const task = {
  action: 'task.save',
  title: 'Написать текст',
  brain_hemisphere: 'analytical',
  required_energy: 7,
  estimated_minutes: 60,
  penalty_amount: '0',
};
function memory(fn) {
  const s = createStore(':memory:', clock);
  try {
    return fn(s);
  } finally {
    s.close();
  }
}
function temporary(fn) {
  const folder = mkdtempSync(join(tmpdir(), 'focal-advanced-'));
  const s = createStore(join(folder, 'live.sqlite'), clock);
  try {
    return fn(s, folder);
  } finally {
    s.close();
    rmSync(folder, { recursive: true, force: true, maxRetries: 3 });
  }
}

test('weekly recurrence preserves wall time over DST and includes ending date', () =>
  memory((s) => {
    const state = s.action({
      ...event,
      start_at: iso('2026-10-26T09:00:00'),
      end_at: iso('2026-10-26T10:00:00'),
      recurrence: {
        frequency: 'weekly',
        weekdays: [1],
        until: '2026-11-09',
        interval: 1,
      },
    });
    assert.equal(state.events.length, 3);
    assert.ok(state.events.every((e) => new Date(e.start_at).getHours() === 9));
    assert.equal(
      Date.parse(state.events[1].start_at) -
        Date.parse(state.events[0].start_at),
      169 * 3600000,
    );
    assert.ok(
      state.events.every((e) => e.series_id === state.events[0].series_id),
    );
    assert.throws(() =>
      s.action({
        ...event,
        recurrence: { frequency: 'weekly', weekdays: [], until: '2026-10-01' },
      }),
    );
    assert.throws(() =>
      s.action({
        ...event,
        recurrence: { frequency: 'daily', until: '2030-10-01' },
      }),
    );
  }));
test('series edits preserve completed and separately changed occurrences; deleted occurrences stay deleted', () =>
  memory((s) => {
    let state = s.action({
      ...event,
      recurrence: { frequency: 'weekly', weekdays: [1], until: '2026-10-05' },
    });
    const [a, b, c, d, e] = state.events;
    s.action({
      action: 'event.move',
      id: b.id,
      start_at: iso('2026-09-15T12:00:00'),
    });
    s.action({ action: 'event.complete', id: c.id });
    state = s.action({
      ...event,
      id: a.id,
      title: 'Новая тема',
      start_at: iso('2026-09-07T11:00:00'),
      end_at: iso('2026-09-07T12:30:00'),
      scope: 'series',
    });
    assert.equal(
      state.events.find((x) => x.id === b.id).start_at,
      iso('2026-09-15T12:00:00'),
    );
    assert.equal(state.events.find((x) => x.id === c.id).title, c.title);
    assert.equal(state.events.find((x) => x.id === d.id).title, 'Новая тема');
    s.action({ action: 'event.delete', id: e.id });
    assert.equal(s.snapshot().events.length, 4);
    state = s.action({ action: 'event.delete', id: a.id, scope: 'series' });
    assert.deepEqual(
      new Set(state.events.map((x) => x.id)),
      new Set([b.id, c.id]),
    );
  }));
test('idempotent requests prevent repeated series and note tasks', () =>
  memory((s) => {
    const input = {
      ...event,
      request_id: 'same-series',
      recurrence: { frequency: 'daily', until: '2026-09-09' },
    };
    s.action(input);
    assert.equal(s.action(input).events.length, 3);
    const note = s.action({
      action: 'note.save',
      title: 'План',
      body: 'Написать текст',
      note_date: '2026-09-06',
    }).notes[0];
    const convert = {
      action: 'note.task',
      note_id: note.id,
      title: 'Написать текст',
      estimated_minutes: 25,
      request_id: 'convert-one',
    };
    s.action(convert);
    let state = s.action(convert);
    assert.equal(state.tasks.length, 1);
    assert.equal(state.tasks[0].source_note_id, note.id);
    state = s.action({ action: 'note.delete', id: note.id });
    assert.equal(state.tasks[0].source_note_id, note.id);
    assert.equal(state.notes.length, 0);
    assert.equal(state.trash.length, 1);
    assert.equal(state.tasks.length, 1);
  }));
test('calendar undo restores IDs and links without resetting focus or finance', () =>
  memory((s) => {
    const t = s.action(task).tasks[0];
    let state = s.action({ ...event, task_id: t.id });
    const original = state.events[0];
    s.action({
      action: 'event.move',
      id: original.id,
      start_at: iso('2026-09-08T10:00:00'),
    });
    s.action({
      action: 'session.start',
      task_id: t.id,
      dopamine_debt_duration: 0,
      work_duration: 25,
      break_duration: 5,
      audio_type: 'none',
    });
    state = s.action({ action: 'calendar.undo' });
    assert.deepEqual(state.events[0], original);
    assert.equal(state.sessions[0].phase, 'work');
    assert.throws(() => s.action({ action: 'calendar.undo' }));
    s.action({ action: 'event.delete', id: original.id });
    state = s.action({ action: 'calendar.undo' });
    assert.deepEqual(state.events[0], original);
    s.action({
      action: 'event.resize',
      id: original.id,
      end_at: iso('2026-09-07T11:00:00'),
    });
    s.action({ action: 'event.dismiss', id: original.id });
    assert.throws(() => s.action({ action: 'calendar.undo' }), /изменилось/);
  }));
test('duplicate resets completion and series; resize validates bounds and is undoable', () =>
  memory((s) => {
    let state = s.action({
      ...event,
      recurrence: { frequency: 'daily', until: '2026-09-08' },
    });
    const original = state.events[0];
    s.action({ action: 'event.complete', id: original.id });
    state = s.action({
      action: 'event.duplicate',
      id: original.id,
      start_at: iso('2026-09-09T09:00:00'),
    });
    const copy = state.events.find((e) => !e.series_id);
    assert.ok(copy);
    assert.equal(copy.completed_at, null);
    assert.notEqual(copy.id, original.id);
    assert.throws(() =>
      s.action({ action: 'event.resize', id: copy.id, end_at: copy.start_at }),
    );
    state = s.action({
      action: 'event.resize',
      id: copy.id,
      end_at: iso('2026-09-09T11:00:00'),
    });
    assert.equal(
      state.events.find((e) => e.id === copy.id).end_at,
      iso('2026-09-09T11:00:00'),
    );
    state = s.action({ action: 'calendar.undo' });
    assert.equal(
      state.events.find((e) => e.id === copy.id).end_at,
      copy.end_at,
    );
  }));
test('week templates preserve overnight duration, preview conflicts and apply atomically without duplicates', () =>
  memory((s) => {
    const t = s.action(task).tasks[0];
    s.action({
      ...event,
      task_id: t.id,
      start_at: iso('2026-09-13T23:30:00'),
      end_at: iso('2026-09-14T01:00:00'),
    });
    let state = s.action({
      action: 'template.save',
      name: 'Учёба',
      week_start: '2026-09-07',
    });
    const template = state.templates[0];
    assert.equal(JSON.parse(template.blocks_json)[0].day, 6);
    s.action({
      ...event,
      title: 'Занято',
      start_at: iso('2026-09-20T23:30:00'),
      end_at: iso('2026-09-21T00:00:00'),
    });
    const preview = previewTemplate(
      template,
      '2026-09-14',
      s.snapshot().events,
    );
    assert.equal(preview[0].conflict, true);
    assert.throws(() =>
      s.action({
        action: 'template.apply',
        id: template.id,
        week_start: '2026-09-14',
        conflicts: 'skip',
      }),
    );
    state = s.action({
      action: 'template.apply',
      id: template.id,
      week_start: '2026-09-14',
      conflicts: 'allow',
      request_id: 'apply',
    });
    const block = state.events.find(
      (e) => e.title === t.title && e.start_at === iso('2026-09-20T23:30:00'),
    );
    assert.equal(block.end_at, iso('2026-09-21T01:00:00'));
    assert.equal(block.task_id, null);
    assert.equal(block.completed_at, null);
    assert.equal(block.series_id, null);
    assert.equal(
      s.action({
        action: 'template.apply',
        id: template.id,
        week_start: '2026-09-14',
        conflicts: 'allow',
        request_id: 'apply',
      }).events.length,
      3,
    );
    assert.throws(() =>
      s.action({
        action: 'template.apply',
        id: template.id,
        week_start: '2026-09-14',
        conflicts: 'allow',
      }),
    );
    state = s.action({ action: 'calendar.undo' });
    assert.equal(state.events.length, 2);
  }));
test('slot suggestions do not overlap, respect deadline, and count overlapping busy time only once', () =>
  memory((s) => {
    let state = s.action({ ...task, deadline: iso('2026-09-07T15:00:00') });
    const t = state.tasks[0];
    state = s.action({
      ...event,
      start_at: iso('2026-09-07T10:00:00'),
      end_at: iso('2026-09-07T12:00:00'),
    });
    state = s.action({
      ...event,
      start_at: iso('2026-09-07T11:00:00'),
      end_at: iso('2026-09-07T13:00:00'),
    });
    const slots = suggestSlots(
      state,
      t,
      '2026-09-07',
      { start: 9, end: 18 },
      instant,
    );
    assert.equal(slots.length, 3);
    assert.ok(slots.every((v) => v.end <= new Date(t.deadline)));
    assert.equal(
      freeMinutes(state.events, '2026-09-07', { start: 9, end: 18 }),
      360,
    );
    assert.ok(slots.every((v) => v.energy === null));
    assert.equal(
      suggestSlots(state, t, '2026-09-05', { start: 9, end: 18 }, instant)
        .length,
      0,
    );
  }));
test('energy suggestions weight distinct days and learned duration requires observed completed work', () =>
  memory((s) => {
    const state = s.action(task),
      t = state.tasks[0];
    state.energy_logs = [
      { id: '1', energy_level: 9, logged_at: iso('2026-09-04T11:00:00') },
      { id: '2', energy_level: 7, logged_at: iso('2026-09-05T11:00:00') },
      { id: '3', energy_level: 7, logged_at: iso('2026-09-05T11:10:00') },
    ];
    const slots = suggestSlots(
      state,
      t,
      '2026-09-07',
      { start: 9, end: 14 },
      instant,
    );
    assert.equal(slots[0].start.getHours(), 11);
    assert.equal(slots[0].energy, 8);
    assert.equal(slots[0].days, 2);
    for (let i = 0; i < 3; i++) {
      state.tasks.push({
        ...t,
        id: 'done' + i,
        status: 'completed',
        completed_at: iso('2026-09-05T14:00:00'),
        estimated_minutes: 30,
      });
      state.sessions.push({
        id: 'session' + i,
        task_id: 'done' + i,
        started_at: iso('2026-09-05T12:00:00'),
        dopamine_debt_duration: 0,
        work_duration: 60,
        ended_at: iso('2026-09-05T13:00:00'),
        phase: 'completed',
        is_successful: 1,
      });
    }
    assert.equal(learnedEstimate(state, t, instant).minutes, 120);
  }));
test('weekly review apportions partial focus across midnight and keeps task versus block completion separate', () =>
  memory((s) => {
    const state = s.action(task);
    state.sessions = [
      {
        id: 'partial',
        task_id: state.tasks[0].id,
        started_at: iso('2026-09-06T23:40:00'),
        dopamine_debt_duration: 10,
        work_duration: 60,
        ended_at: iso('2026-09-07T00:20:00'),
        phase: 'cancelled',
        is_successful: 0,
      },
    ];
    const now = new Date('2026-09-08T12:00:00');
    assert.equal(
      focusInRange(
        state.sessions,
        new Date('2026-09-07T00:00:00'),
        new Date('2026-09-08T00:00:00'),
        now,
      ),
      20,
    );
    const review = weeklyReview(state, '2026-09-07', now);
    assert.equal(review.days[0].focus, 20);
    assert.equal(review.completed, 0);
  }));
test('reminders handle advance warning, start, snooze, dismiss and completion', () => {
  const e = { ...event, id: 'e', completed_at: null };
  assert.equal(reminderFor(e, new Date('2026-09-07T08:44:59')), null);
  assert.equal(reminderFor(e, new Date('2026-09-07T08:45:00')).minutes, 15);
  const dismissed = { ...e, reminder_dismissed_at: iso('2026-09-07T08:46:00') };
  assert.equal(reminderFor(dismissed, new Date('2026-09-07T08:50:00')), null);
  assert.equal(
    reminderFor(dismissed, new Date('2026-09-07T09:00:00')).upcoming,
    false,
  );
  const snoozed = { ...e, snoozed_until: iso('2026-09-07T09:05:00') };
  assert.equal(reminderFor(snoozed, new Date('2026-09-07T09:04:59')), null);
  assert.ok(reminderFor(snoozed, new Date('2026-09-07T09:05:00')));
  assert.equal(
    reminderFor(
      { ...e, completed_at: iso('2026-09-07T09:20:00') },
      new Date('2026-09-07T09:21:00'),
    ),
    null,
  );
});
test('restore validates first, backs up current data, restores user and remains writable', () =>
  temporary((s, folder) => {
    const source = createStore(join(folder, 'source.sqlite'), clock);
    let bytes, expected;
    try {
      source.action({
        action: 'note.save',
        title: 'Из копии',
        body: 'Текст 💡',
        note_date: '2026-09-01',
      });
      source.action(task);
      source.action(event);
      source.action({
        action: 'template.save',
        name: 'Неделя',
        week_start: '2026-09-07',
      });
      expected = source.snapshot();
      bytes = source.backup().bytes;
    } finally {
      source.close();
    }
    s.action({
      action: 'note.save',
      title: 'Прежние данные',
      body: 'Останутся в backup',
      note_date: '2026-09-06',
    });
    const preview = s.inspectBackup(bytes);
    assert.equal(preview.counts.notes, 1);
    assert.equal(s.snapshot().notes[0].title, 'Прежние данные');
    const state = s.restoreBackup(preview.token);
    assert.equal(state.notes[0].title, 'Из копии');
    assert.equal(state.user.id, expected.user.id);
    assert.equal(state.templates.length, 1);
    assert.equal(state.events.length, 1);
    assert.equal(state.calendar_undo, null);
    assert.ok(state.restored_backup);
    const old = new DatabaseSync(
      join(folder, 'backups', state.restored_backup),
      { readOnly: true },
    );
    try {
      assert.equal(
        old.prepare('SELECT title FROM notes').get().title,
        'Прежние данные',
      );
    } finally {
      old.close();
    }
    assert.equal(
      s.action({ ...task, title: 'После восстановления' }).tasks.length,
      2,
    );
    assert.equal(s.restoreBackup(preview.token).tasks.length, 2);
  }));
test('damaged, foreign and future-version backup files leave live records unchanged', () =>
  temporary((s, folder) => {
    s.action(task);
    const original = s.snapshot().tasks;
    assert.throws(() => s.inspectBackup(Buffer.from('not a sqlite database')));
    const foreign = join(folder, 'foreign.sqlite');
    const other = new DatabaseSync(foreign);
    other.exec('CREATE TABLE unrelated (x TEXT)');
    other.close();
    assert.throws(() => s.inspectBackup(readFileSync(foreign)));
    const future = join(folder, 'future.sqlite');
    writeFileSync(future, s.backup().bytes);
    const newer = new DatabaseSync(future);
    newer.exec('PRAGMA user_version=99');
    newer.close();
    assert.throws(
      () => s.inspectBackup(readFileSync(future)),
      /не поддерживается/,
    );
    assert.deepEqual(s.snapshot().tasks, original);
  }));
test('version 2 backup is migrated in staging and original file stays unchanged', () =>
  temporary((s, folder) => {
    const file = join(folder, 'old-v2.sqlite'),
      old = new DatabaseSync(file);
    old.exec(
      readFileSync(new URL('../server/schema.sql', import.meta.url), 'utf8'),
    );
    old.exec(
      'ALTER TABLE tasks ADD COLUMN planned_date TEXT; ALTER TABLE tasks ADD COLUMN is_priority INTEGER NOT NULL DEFAULT 0; ALTER TABLE tasks ADD COLUMN estimated_minutes INTEGER NOT NULL DEFAULT 30; PRAGMA user_version=2;',
    );
    old
      .prepare('INSERT INTO users VALUES(?,?,?,?)')
      .run('old-user', 'Раньше', '', clock().toString());
    old
      .prepare('INSERT INTO notes VALUES(?,?,?,?,?,?,?)')
      .run(
        'old-note',
        'old-user',
        'Старая заметка',
        'Сохранилась',
        '2026-09-01',
        instant.toISOString(),
        instant.toISOString(),
      );
    old.close();
    const bytes = readFileSync(file);
    s.action(task);
    const preview = s.inspectBackup(bytes);
    assert.equal(preview.version, 2);
    const state = s.restoreBackup(preview.token);
    assert.equal(state.notes[0].id, 'old-note');
    assert.equal(state.user.id, 'old-user');
    assert.equal(state.events.length, 0);
    assert.deepEqual(readFileSync(file), bytes);
    assert.equal(s.action(event).events[0].reminder_minutes, 15);
  }));
test('restore failure rolls back every table and leaves the running store usable', () =>
  temporary((s, folder) => {
    s.action(task);
    const source = createStore(join(folder, 'source.sqlite'), clock);
    let bytes;
    try {
      source.action({
        action: 'note.save',
        title: 'Abort this insert',
        body: '',
        note_date: '2026-09-01',
      });
      bytes = source.backup().bytes;
    } finally {
      source.close();
    }
    const preview = s.inspectBackup(bytes),
      before = s.snapshot();
    const sabotage = new DatabaseSync(join(folder, 'live.sqlite'));
    sabotage.exec(
      "CREATE TRIGGER simulate_storage_error BEFORE INSERT ON notes WHEN NEW.title='Abort this insert' BEGIN SELECT RAISE(ABORT,'simulated write error'); END;",
    );
    sabotage.close();
    assert.throws(() => s.restoreBackup(preview.token), /simulated/);
    const state = s.snapshot();
    assert.deepEqual(state.tasks, before.tasks);
    assert.equal(state.user.id, before.user.id);
    assert.equal(state.notes.length, 0);
    assert.equal(s.action(event).events.length, 1);
  }));
