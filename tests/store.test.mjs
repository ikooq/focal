import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createStore, moneyMinor } from '../server/store.mjs';

const taskPayload = {
  action: 'task.save',
  title: 'Подготовить расчёт',
  brain_hemisphere: 'analytical',
  required_energy: 8,
  penalty_amount: '250.15',
  deadline: null,
};
const startPayload = {
  action: 'session.start',
  dopamine_debt_duration: 10,
  work_duration: 50,
  break_duration: 10,
  audio_type: 'none',
};
function setup() {
  let time = Date.parse('2026-09-06T10:00:00Z');
  const store = createStore(':memory:', () => time);
  return {
    store,
    advance: (minutes) => {
      time += minutes * 60000;
    },
  };
}
test('decimal amounts remain exact and malformed or negative amounts are rejected', () => {
  assert.equal(moneyMinor('0.10') + moneyMinor('0,20'), 30);
  assert.equal(moneyMinor('250.15'), 25015);
  for (const v of ['-1', 'NaN', '1.001', '1e3', '', Infinity, 1])
    assert.throws(() => moneyMinor(v));
});
test('energy boundaries and task validation are enforced at API data layer', () => {
  const { store } = setup();
  try {
    for (const n of [0, 11, 1.5, null, '5'])
      assert.throws(() =>
        store.action({ action: 'energy.add', energy_level: n }),
      );
    assert.equal(
      store.action({ action: 'energy.add', energy_level: 10 }).energy_logs[0]
        .energy_level,
      10,
    );
    assert.throws(() => store.action({ ...taskPayload, required_energy: 11 }));
    assert.throws(() =>
      store.action({ ...taskPayload, brain_hemisphere: 'other' }),
    );
    assert.equal(store.snapshot().tasks.length, 0);
  } finally {
    store.close();
  }
});
test('timer catches up through preparation, work and break after inactivity', () => {
  const { store, advance } = setup();
  try {
    const task = store.action(taskPayload).tasks[0];
    let s = store.action({ ...startPayload, task_id: task.id }).sessions[0];
    assert.equal(s.phase, 'preparation');
    assert.equal(s.is_successful, null);
    assert.throws(() => store.action({ ...startPayload, task_id: task.id }));
    advance(15);
    s = store.snapshot().sessions[0];
    assert.equal(s.phase, 'work');
    assert.equal(s.phase_ends_at, '2026-09-06T11:00:00.000Z');
    advance(55);
    const state = store.snapshot();
    assert.equal(state.sessions[0].phase, 'completed');
    assert.equal(state.sessions[0].is_successful, 1);
    assert.equal(state.tasks[0].status, 'pending');
    assert.equal(state.transactions.length, 0);
    assert.equal(
      store.action({ action: 'task.complete', id: task.id }).tasks[0].status,
      'completed',
    );
  } finally {
    store.close();
  }
});
test('cancelled focus and repeated deadlines record one exact penalty', () => {
  const { store, advance } = setup();
  try {
    const task = store.action({
      ...taskPayload,
      deadline: '2026-09-06T12:00:00Z',
    }).tasks[0];
    const s = store.action({ ...startPayload, task_id: task.id }).sessions[0];
    let state = store.action({ action: 'session.cancel', id: s.id });
    assert.equal(state.tasks[0].status, 'pending');
    assert.equal(state.transactions.length, 1);
    assert.equal(state.transactions[0].amount_minor, 25015);
    assert.throws(() => store.action({ action: 'session.cancel', id: s.id }));
    advance(180);
    for (let i = 0; i < 3; i++) state = store.snapshot();
    assert.equal(state.transactions.length, 1);
  } finally {
    store.close();
  }
});
test('ending a break keeps the successful work without a penalty', () => {
  const { store, advance } = setup();
  try {
    const task = store.action(taskPayload).tasks[0];
    const s = store.action({ ...startPayload, task_id: task.id }).sessions[0];
    advance(61);
    assert.equal(store.snapshot().sessions[0].phase, 'break');
    const state = store.action({ action: 'session.cancel', id: s.id });
    assert.equal(state.sessions[0].is_successful, 1);
    assert.equal(state.tasks[0].status, 'pending');
    assert.equal(state.transactions.length, 0);
  } finally {
    store.close();
  }
});
test('missed deadlines keep a task available and never affect completed tasks', () => {
  const { store, advance } = setup();
  try {
    const task = store.action({
      ...taskPayload,
      deadline: '2026-09-06T10:10:00Z',
    }).tasks[0];
    store.action({
      ...taskPayload,
      title: 'Уже готово',
      deadline: '2026-09-06T10:10:00Z',
    });
    const complete = store.snapshot().tasks.find((t) => t.id !== task.id);
    store.action({ action: 'task.complete', id: complete.id });
    advance(11);
    const state = store.snapshot();
    assert.equal(state.tasks.find((t) => t.id === task.id).status, 'pending');
    assert.equal(
      state.tasks.find((t) => t.id === complete.id).status,
      'completed',
    );
    assert.equal(state.transactions.length, 1);
    assert.equal(store.snapshot().transactions.length, 1);
  } finally {
    store.close();
  }
});
test('settling an operation updates the original record without double counting', () => {
  const { store } = setup();
  try {
    let state = store.action({
      action: 'transaction.add',
      amount: '1000.20',
      type: 'income',
      category: 'Проект',
      planned_date: '2026-09-10',
    });
    const id = state.transactions[0].id;
    state = store.action({ action: 'transaction.settle', id });
    assert.equal(state.transactions.length, 1);
    assert.equal(state.transactions[0].amount_minor, 100020);
    assert.equal(state.transactions[0].actual_date, '2026-09-06');
    assert.throws(() => store.action({ action: 'transaction.settle', id }));
    assert.throws(() =>
      store.action({
        action: 'transaction.add',
        amount: '0',
        type: 'expense',
        category: 'Ноль',
        planned_date: '2026-09-10',
      }),
    );
  } finally {
    store.close();
  }
});
test('database survives a close/reopen and resumes elapsed session time', () => {
  // The only cleanup target is the exact fresh temporary directory created here.
  const temp = mkdtempSync(join(tmpdir(), 'focal-test-'));
  const path = join(temp, 'test.sqlite');
  let clock = Date.parse('2026-09-06T10:00:00Z');
  let store = createStore(path, () => clock);
  try {
    const task = store.action(taskPayload).tasks[0];
    store.action({ ...startPayload, task_id: task.id });
    store.close();
    clock += 11 * 60000;
    store = createStore(path, () => clock);
    assert.equal(store.snapshot().tasks.length, 1);
    assert.equal(store.snapshot().sessions[0].phase, 'work');
  } finally {
    store.close();
    rmSync(temp, { recursive: true, force: true });
  }
});
test('offline and continuously checked deadlines yield the same session and penalty date', () => {
  function simulate(poll) {
    let clock = Date.parse('2026-09-30T10:00:00Z');
    const store = createStore(':memory:', () => clock);
    try {
      const task = store.action({
        ...taskPayload,
        deadline: '2026-09-30T10:20:00Z',
      }).tasks[0];
      store.action({ ...startPayload, task_id: task.id });
      if (poll) {
        clock = Date.parse('2026-09-30T10:20:00Z');
        store.snapshot();
      }
      clock = Date.parse('2026-10-01T10:00:00Z');
      const s = store.snapshot();
      return {
        phase: s.sessions[0].phase,
        success: s.sessions[0].is_successful,
        penaltyDate: s.transactions[0].planned_date,
      };
    } finally {
      store.close();
    }
  }
  assert.deepEqual(simulate(false), simulate(true));
  assert.equal(simulate(false).phase, 'completed');
  assert.equal(simulate(false).penaltyDate, '2026-09-30');
});
test('impossible dates and future actual transactions are rejected', () => {
  const { store } = setup();
  try {
    assert.throws(() =>
      store.action({ ...taskPayload, deadline: '2027-02-30T12:00:00Z' }),
    );
    assert.throws(() =>
      store.action({
        action: 'transaction.add',
        type: 'income',
        category: 'Доход',
        amount: '100',
        planned_date: '2026-09-10',
        actual_date: '2026-09-10',
      }),
    );
  } finally {
    store.close();
  }
});
