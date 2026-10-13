import test from 'node:test';
import assert from 'node:assert/strict';
import {
  energyProfile,
  rankTasks,
  focusMinutesToday,
  txDate,
  signed,
} from '../lib/domain.ts';

test('hourly profile weights days equally rather than overcounting frequent entries', () => {
  const now = new Date(2026, 8, 6, 12, 30),
    iso = (day, hour, min) => new Date(2026, 8, day, hour, min).toISOString();
  const profile = energyProfile(
    [
      { energy_level: 10, logged_at: iso(5, 12, 0) },
      { energy_level: 10, logged_at: iso(5, 12, 15) },
      { energy_level: 2, logged_at: iso(4, 12, 0) },
    ],
    now,
  );
  assert.equal(profile.value, 6);
  assert.equal(profile.points[12].days, 2);
  assert.equal(profile.points[13].value, null);
});
test('empty or stale energy is missing, fresh measurement works without history', () => {
  const now = new Date(2026, 8, 6, 12, 30);
  assert.equal(energyProfile([], now).value, null);
  assert.equal(
    energyProfile(
      [{ energy_level: 9, logged_at: new Date(2026, 8, 6, 8).toISOString() }],
      now,
    ).value,
    null,
  );
  assert.equal(
    energyProfile(
      [{ energy_level: 4, logged_at: new Date(2026, 8, 6, 12).toISOString() }],
      now,
    ).value,
    4,
  );
});
test('task recommendations prefer feasible tasks, with demanding work at a peak', () => {
  const tasks = [
    { id: 'hard', status: 'pending', required_energy: 9, deadline: null },
    { id: 'routine', status: 'pending', required_energy: 3, deadline: null },
    { id: 'done', status: 'completed', required_energy: 1, deadline: null },
  ];
  assert.deepEqual(
    rankTasks(tasks, 4).map((t) => t.id),
    ['routine', 'hard'],
  );
  assert.equal(rankTasks(tasks, 9)[0].id, 'hard');
});
test('work intervals crossing midnight are apportioned to the right local day', () => {
  const session = {
    is_successful: 1,
    started_at: new Date(2026, 8, 5, 23, 40).toISOString(),
    dopamine_debt_duration: 10,
    work_duration: 50,
  };
  assert.equal(focusMinutesToday([session], new Date(2026, 8, 5)), 10);
  assert.equal(focusMinutesToday([session], new Date(2026, 8, 6)), 40);
});
test('actual cashflow replaces the planned date and conditional penalties do not affect money', () => {
  assert.equal(
    txDate({ planned_date: '2026-09-20', actual_date: '2026-10-01' }),
    '2026-10-01',
  );
  assert.equal(signed({ type: 'penalty', amount_minor: 105 }), 0);
});
