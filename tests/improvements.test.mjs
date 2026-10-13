import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
  readFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore } from '../server/store.mjs';
import { focusInRange } from '../lib/planning.ts';
import { forecast } from '../lib/forecast.ts';
import { dayKey } from '../lib/domain.ts';
import { localPaths } from '../server/local-paths.mjs';
const task = {
  action: 'task.save',
  title: 'Работа',
  brain_hemisphere: 'analytical',
  required_energy: 5,
  penalty_amount: '100',
  estimated_minutes: 30,
};
const start = {
  action: 'session.start',
  dopamine_debt_duration: 0,
  work_duration: 30,
  break_duration: 5,
  audio_type: 'none',
};

test('paused work survives reopen and backup restore, crosses midnight without counting the pause', () => {
  const folder = mkdtempSync(join(tmpdir(), 'focal-pause-'));
  const path = join(folder, 'test.sqlite');
  let clock = new Date(2026, 8, 8, 23, 50).getTime();
  let store = createStore(path, () => clock);
  try {
    const t = store.action(task).tasks[0];
    const s = store.action({ ...start, task_id: t.id }).sessions[0];
    clock += 5 * 60000;
    store.action({ action: 'session.pause', id: s.id });
    store.close();
    clock += 20 * 60000;
    store = createStore(path, () => clock);
    let state = store.snapshot();
    assert.ok(state.sessions[0].paused_at);
    assert.equal(state.sessions[0].phase, 'work');
    const bytes = store.backup().bytes;
    store.restoreBackup(store.inspectBackup(bytes).token);
    assert.equal(
      focusInRange(
        store.snapshot().sessions,
        new Date(2026, 8, 8),
        new Date(2026, 8, 9),
        new Date(clock),
      ),
      5,
    );
    store.action({ action: 'session.resume', id: s.id });
    clock += 25 * 60000;
    state = store.snapshot();
    assert.equal(state.sessions[0].phase, 'break');
    assert.equal(
      focusInRange(
        state.sessions,
        new Date(2026, 8, 9),
        new Date(2026, 8, 10),
        new Date(clock),
      ),
      25,
    );
    assert.equal(state.transactions.length, 0);
  } finally {
    store.close();
    rmSync(folder, { recursive: true, force: true, maxRetries: 3 });
  }
});

test('preparation pause and cancellation never create imaginary focus minutes', () => {
  let clock = Date.parse('2026-09-08T10:00:00Z');
  const store = createStore(':memory:', () => clock);
  try {
    const t = store.action(task).tasks[0];
    const s = store.action({
      ...start,
      task_id: t.id,
      dopamine_debt_duration: 10,
    }).sessions[0];
    clock += 2 * 60000;
    store.action({ action: 'session.pause', id: s.id });
    clock += 60 * 60000;
    const state = store.action({ action: 'session.cancel', id: s.id });
    assert.equal(
      focusInRange(
        state.sessions,
        new Date(0),
        new Date(clock),
        new Date(clock),
      ),
      0,
    );
    assert.equal(state.tasks[0].status, 'pending');
  } finally {
    store.close();
  }
});

test('overdue focus continues; a conditional penalty affects forecast only after explicit settlement', () => {
  let clock = Date.parse('2026-09-08T10:00:00Z');
  const store = createStore(':memory:', () => clock);
  try {
    const t = store.action({ ...task, deadline: '2026-09-08T10:05:00Z' })
      .tasks[0];
    const s = store.action({ ...start, task_id: t.id }).sessions[0];
    clock += 10 * 60000;
    let state = store.snapshot();
    assert.equal(state.sessions[0].phase, 'work');
    assert.equal(state.tasks[0].status, 'active');
    assert.equal(state.transactions[0].actual_date, null);
    const date = dayKey(new Date(clock));
    assert.equal(forecast(state, date, date)[0].balance, 0);
    state = store.action({
      action: 'penalty.settle',
      id: state.transactions[0].id,
    });
    assert.equal(forecast(state, date, date)[0].balance, -10000);
    assert.throws(() =>
      store.action({ action: 'penalty.settle', id: state.transactions[0].id }),
    );
    store.action({ action: 'session.cancel', id: s.id });
    assert.equal(store.snapshot().transactions.length, 1);
    assert.equal(
      store.action({ action: 'task.complete', id: t.id }).tasks[0].status,
      'completed',
    );
  } finally {
    store.close();
  }
});

test('end of day applies decisions atomically and keeps deadlines and next-step context', () => {
  const clock = () => new Date(2026, 8, 8, 18).getTime();
  const store = createStore(':memory:', clock);
  try {
    const t = store.action({
      ...task,
      deadline: new Date(2026, 8, 9, 18).toISOString(),
    }).tasks[0];
    store.action({
      action: 'task.plan',
      id: t.id,
      planned_date: '2026-09-08',
      is_priority: true,
    });
    assert.throws(() =>
      store.action({
        action: 'day.finish',
        date: '2026-09-08',
        tasks: [
          { id: t.id, choice: 'tomorrow' },
          { id: 'missing', choice: 'complete' },
        ],
      }),
    );
    assert.equal(store.snapshot().tasks[0].planned_date, '2026-09-08');
    const input = {
      action: 'day.finish',
      request_id: 'day-finish-once',
      date: '2026-09-08',
      tasks: [{ id: t.id, choice: 'tomorrow' }],
      first_task_id: t.id,
      next_step: 'Открыть черновик',
      summary: 'Подготовлена структура',
    };
    let state = store.action(input);
    state = store.action(input);
    assert.equal(state.tasks[0].planned_date, '2026-09-09');
    assert.equal(state.tasks[0].is_priority, 1);
    assert.equal(
      state.tasks[0].deadline,
      new Date(2026, 8, 9, 18).toISOString(),
    );
    assert.equal(state.checkpoints.length, 1);
    assert.equal(state.notes.length, 1);
  } finally {
    store.close();
  }
});

test('automatic backup rotation preserves manual copies and respects selected folder and disabled state', () => {
  const folder = mkdtempSync(join(tmpdir(), 'focal-rotation-'));
  let clock = Date.parse('2026-09-01T10:00:00Z');
  const store = createStore(join(folder, 'test.sqlite'), () => clock);
  try {
    const backups = join(folder, 'chosen');
    store.action({ action: 'settings.save', backup_folder: backups });
    writeFileSync(join(backups, 'manual.sqlite'), 'keep');
    for (let i = 0; i < 17; i++) {
      clock += 86400000;
      store.snapshot();
    }
    const files = readdirSync(backups);
    assert.equal(files.filter((f) => f.startsWith('auto-focal-')).length, 14);
    assert.equal(readFileSync(join(backups, 'manual.sqlite'), 'utf8'), 'keep');
    store.action({ action: 'settings.save', auto_backup: false });
    clock += 86400000;
    store.snapshot();
    assert.deepEqual(readdirSync(backups), files);
  } finally {
    store.close();
    rmSync(folder, { recursive: true, force: true, maxRetries: 3 });
  }
});

test('legacy data migration copies committed WAL records without replacing an existing user database', () => {
  const folder = mkdtempSync(join(tmpdir(), 'focal-location-'));
  const store = createStore(join(folder, 'data', 'focal.sqlite'));
  let migrated;
  try {
    store.action(task);
    const paths = localPaths(folder, { LOCALAPPDATA: join(folder, 'profile') });
    migrated = createStore(paths.database);
    assert.equal(migrated.snapshot().tasks.length, 1);
    store.action({ ...task, title: 'Поздняя запись в старой папке' });
    localPaths(folder, { LOCALAPPDATA: join(folder, 'profile') });
    assert.equal(migrated.snapshot().tasks.length, 1);
  } finally {
    store.close();
    migrated?.close();
    rmSync(folder, { recursive: true, force: true, maxRetries: 3 });
  }
});
