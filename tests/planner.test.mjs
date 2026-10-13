import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore } from '../server/store.mjs';
import { daySegments, dropTime, visualEnd } from '../lib/calendar.ts';

const clock = () => Date.parse('2026-09-06T09:00:00Z');
const task = {
  action: 'task.save',
  title: 'Важное дело',
  brain_hemisphere: 'analytical',
  required_energy: 5,
  penalty_amount: '10.25',
  deadline: null,
  estimated_minutes: 45,
};
const event = {
  action: 'event.save',
  title: 'Встреча',
  description: 'Обсудить проект',
  start_at: '2026-09-07T09:00:00Z',
  end_at: '2026-09-07T10:00:00Z',
  color: 'sky',
};
function withStore(fn) {
  const s = createStore(':memory:', clock);
  try {
    fn(s);
  } finally {
    s.close();
  }
}

test('notes keep their chosen date when edited later and preserve long Unicode text', () =>
  withStore((s) => {
    const body = 'Идея 💡\n'.repeat(4000);
    let state = s.action({
      action: 'note.save',
      title: 'Мысли',
      body,
      note_date: '2026-08-01',
    });
    const id = state.notes[0].id;
    state = s.action({
      action: 'note.save',
      id,
      title: 'Итоги',
      body,
      note_date: '2026-08-01',
    });
    assert.equal(state.notes.length, 1);
    assert.equal(state.notes[0].note_date, '2026-08-01');
    assert.equal(state.notes[0].body, body);
    assert.throws(() =>
      s.action({
        action: 'note.save',
        title: 'Ошибка',
        body: '',
        note_date: '2026-02-30',
      }),
    );
    assert.equal(s.action({ action: 'note.delete', id }).notes.length, 0);
  }));
test('events validate intervals and task link; moving keeps duration and deadline', () =>
  withStore((s) => {
    const t = s.action({ ...task, deadline: '2026-09-10T09:00:00Z' }).tasks[0];
    let state = s.action({ ...event, task_id: t.id });
    const e = state.events[0];
    assert.equal(e.title, t.title);
    state = s.action({
      action: 'event.move',
      id: e.id,
      start_at: '2026-09-08T23:30:00Z',
    });
    assert.equal(state.events[0].end_at, '2026-09-09T00:30:00.000Z');
    assert.equal(state.tasks[0].deadline, '2026-09-10T09:00:00.000Z');
    assert.throws(() => s.action({ ...event, end_at: event.start_at }));
    assert.throws(() => s.action({ ...event, color: 'arbitrary-css' }));
    assert.throws(() => s.action({ ...event, task_id: 'unknown' }));
    state = s.action({ action: 'event.delete', id: e.id });
    assert.equal(state.events.length, 0);
    assert.equal(state.tasks.length, 1);
  }));
test('event completion is independent from task completion and is reversible', () =>
  withStore((s) => {
    const t = s.action(task).tasks[0],
      e = s.action({ ...event, task_id: t.id }).events[0];
    const state = s.action({ action: 'event.complete', id: e.id });
    assert.ok(state.events[0].completed_at);
    assert.equal(state.tasks[0].status, 'pending');
    assert.throws(() =>
      s.action({
        action: 'event.move',
        id: e.id,
        start_at: '2026-09-08T09:00:00Z',
      }),
    );
    assert.equal(
      s.action({ action: 'event.complete', id: e.id, completed: false })
        .events[0].completed_at,
      null,
    );
  }));
test('today allows at most three priorities, keeps dates separate and frees removed slots', () =>
  withStore((s) => {
    const ids = [];
    for (let i = 0; i < 4; i++) {
      const state = s.action({ ...task, title: 'Задача ' + i });
      ids.push(state.tasks.find((t) => t.title === 'Задача ' + i).id);
    }
    const plan = (id) => ({
      action: 'task.plan',
      id,
      planned_date: '2026-09-06',
      is_priority: true,
    });
    ids.slice(0, 3).forEach((id) => s.action(plan(id)));
    assert.throws(() => s.action(plan(ids[3])));
    assert.equal(s.snapshot().tasks.filter((t) => t.is_priority).length, 3);
    s.action(plan(ids[0]));
    assert.equal(s.snapshot().tasks.filter((t) => t.is_priority).length, 3);
    s.action({ ...plan(ids[0]), is_priority: false });
    s.action(plan(ids[3]));
    s.action({ ...plan(ids[0]), planned_date: '2026-09-07' });
    assert.equal(
      s
        .snapshot()
        .tasks.filter((t) => t.is_priority && t.planned_date === '2026-09-06')
        .length,
      3,
    );
  }));
test('reopened tasks retain history and cannot create a second penalty', () =>
  withStore((s) => {
    const t = s.action(task).tasks[0],
      start = {
        action: 'session.start',
        task_id: t.id,
        dopamine_debt_duration: 0,
        work_duration: 5,
        break_duration: 5,
        audio_type: 'none',
      };
    let session = s.action(start).sessions[0];
    assert.equal(session.phase, 'work');
    s.action({ action: 'session.cancel', id: session.id });
    const state = s.action({ action: 'task.reopen', id: t.id });
    assert.equal(state.tasks[0].status, 'pending');
    assert.equal(state.tasks[0].deadline, null);
    session = s.action(start).sessions.find((x) => x.phase === 'work');
    s.action({ action: 'session.cancel', id: session.id });
    assert.equal(s.snapshot().transactions.length, 1);
  }));
const local = (day, hour, minute = 0) =>
  new Date(2026, 8, day, hour, minute).toISOString();
const block = (id, from, to) => ({ id, start_at: from, end_at: to });
test('overlap groups allocate stable lanes, while touching blocks can reuse a lane', () => {
  const events = [
    block('a', local(7, 9), local(7, 10)),
    block('b', local(7, 9, 30), local(7, 11)),
    block('c', local(7, 10, 30), local(7, 11, 30)),
    block('d', local(7, 11, 30), local(7, 12)),
  ];
  const segments = daySegments(events, new Date(2026, 8, 7));
  assert.deepEqual(
    segments.map((s) => s.columns),
    [2, 2, 2, 1],
  );
  assert.deepEqual(
    segments.map((s) => s.lane),
    [0, 1, 0, 0],
  );
  assert.deepEqual(
    daySegments([...events].reverse(), new Date(2026, 8, 7)),
    segments,
  );
  for (const a of segments)
    for (const b of segments)
      if (a !== b && a.start < b.end && a.end > b.start)
        assert.notEqual(a.lane, b.lane);
});
test('overnight blocks are clipped and midnight endings do not spill into next day', () => {
  const events = [
    block('night', local(6, 23, 30), local(7, 0, 30)),
    block('ends', local(6, 23), local(7, 0)),
  ];
  assert.equal(daySegments(events, new Date(2026, 8, 6)).length, 2);
  const monday = daySegments(events, new Date(2026, 8, 7));
  assert.equal(monday.length, 1);
  assert.equal(monday[0].start, 0);
  assert.equal(monday[0].end, 30);
});
test('existing SQLite migration preserves live sessions and financial foreign keys', () => {
  const folder = mkdtempSync(join(tmpdir(), 'focal-upgrade-')),
    path = join(folder, 'old.sqlite');
  let store;
  try {
    const db = new DatabaseSync(path);
    db.exec(
      readFileSync(
        new URL('../server/schema.sql', import.meta.url),
        'utf8',
      ).replace('BETWEEN 0 AND 20', 'BETWEEN 10 AND 20'),
    );
    db.prepare('INSERT INTO users VALUES(?,?,?,?)').run(
      'user',
      'Вы',
      '',
      '2026-09-06T08:00:00.000Z',
    );
    db.prepare(
      'INSERT INTO tasks(id,user_id,title,brain_hemisphere,required_energy,penalty_minor,status,created_at) VALUES(?,?,?,?,?,?,?,?)',
    ).run(
      'task',
      'user',
      'Сохранить',
      'analytical',
      5,
      1025,
      'active',
      '2026-09-06T08:00:00.000Z',
    );
    db.prepare('INSERT INTO focus_sessions VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(
      'session',
      'task',
      10,
      50,
      10,
      'none',
      null,
      'preparation',
      '2026-09-06T09:00:00.000Z',
      '2026-09-06T09:10:00.000Z',
      null,
    );
    db.prepare(
      'INSERT INTO financial_transactions(id,user_id,type,amount_minor,category,planned_date,actual_date,task_id,session_id,idempotency_key,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
    ).run(
      'tx',
      'user',
      'penalty',
      1025,
      'История',
      '2026-09-05',
      '2026-09-05',
      'task',
      'session',
      'penalty:task',
      '2026-09-05T08:00:00.000Z',
    );
    db.close();
    store = createStore(path, clock);
    let state = store.snapshot();
    assert.equal(state.sessions[0].id, 'session');
    assert.equal(state.sessions[0].phase_ends_at, '2026-09-06T09:10:00.000Z');
    assert.equal(state.transactions[0].session_id, 'session');
    store.close();
    store = createStore(path, clock);
    state = store.snapshot();
    assert.equal(state.tasks[0].estimated_minutes, 30);
    const check = new DatabaseSync(path);
    assert.equal(check.prepare('PRAGMA foreign_key_check').all().length, 0);
    assert.equal(check.prepare('PRAGMA user_version').get().user_version, 6);
    check.close();
  } finally {
    store?.close();
    rmSync(folder, { recursive: true, force: true, maxRetries: 3 });
  }
});
test('live backup round trip preserves WAL writes, notes, events and current timer', () => {
  const folder = mkdtempSync(join(tmpdir(), 'focal-backup-')),
    store = createStore(join(folder, 'live.sqlite'), clock);
  let restored;
  try {
    const t = store.action(task).tasks[0];
    store.action({ ...event, task_id: t.id });
    store.action({
      action: 'note.save',
      title: 'Резерв',
      body: 'Проверка 💡',
      note_date: '2026-09-06',
    });
    store.action({
      action: 'session.start',
      task_id: t.id,
      dopamine_debt_duration: 0,
      work_duration: 15,
      break_duration: 5,
      audio_type: 'none',
    });
    const before = store.snapshot(),
      backup = store.backup(),
      copy = join(folder, 'restored.sqlite');
    writeFileSync(copy, backup.bytes);
    restored = createStore(copy, clock);
    const after = restored.snapshot();
    for (const key of ['tasks', 'events', 'notes', 'sessions', 'transactions'])
      assert.deepEqual(after[key], before[key]);
    const check = new DatabaseSync(copy);
    assert.equal(
      check.prepare('PRAGMA integrity_check').get().integrity_check,
      'ok',
    );
    assert.equal(check.prepare('PRAGMA foreign_key_check').all().length, 0);
    check.close();
  } finally {
    restored?.close();
    store.close();
    rmSync(folder, { recursive: true, force: true, maxRetries: 3 });
  }
});
test('drag preserves grab offset, including a clipped overnight segment', () => {
  const day = new Date(2026, 8, 8);
  assert.equal(dropTime(day, 10 * 60, 60).toISOString(), local(8, 9));
  assert.equal(dropTime(day, 15, 45).toISOString(), local(7, 23, 30));
});
test('short blocks get separate lanes when their visible minimum heights overlap', () => {
  const list = daySegments(
    [
      block('a', local(7, 9), local(7, 9, 5)),
      block('b', local(7, 9, 5), local(7, 9, 10)),
    ],
    new Date(2026, 8, 7),
  );
  assert.equal(list[0].columns, 2);
  assert.notEqual(list[0].lane, list[1].lane);
  assert.equal(visualEnd(list[0]), 9 * 60 + 15);
});
test('historical task links remain editable without allowing new completed task links', () =>
  withStore((s) => {
    const t = s.action(task).tasks[0],
      e = s.action({ ...event, task_id: t.id }).events[0];
    s.action({ action: 'task.complete', id: t.id });
    const result = s.action({
      ...event,
      id: e.id,
      task_id: t.id,
      description: 'Обновлённая история',
    });
    assert.equal(result.events[0].description, 'Обновлённая история');
    assert.throws(() => s.action({ ...event, task_id: t.id }));
  }));
