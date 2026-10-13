import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore } from '../server/store.mjs';
import {
  planDay,
  parseQuick,
  importICS,
  exportICS,
} from '../server/studio.mjs';
import { validateAssistant } from '../server/assistant.mjs';
import { forecast, flowDates } from '../lib/forecast.ts';
const clock = () => new Date('2026-09-07T08:00:00').getTime();
const task = {
  action: 'task.save',
  title: 'Сделать проект',
  brain_hemisphere: 'analytical',
  required_energy: 5,
  penalty_amount: '0',
  estimated_minutes: 120,
};
const iso = (h, m = 0) => new Date(2026, 8, 7, h, m).toISOString();
const event = {
  action: 'event.save',
  title: 'Встреча',
  start_at: iso(10),
  end_at: iso(11),
  color: 'sky',
};

test('projects prevent cycles and premature parent completion; habits are idempotent and date bounded', () => {
  const s = createStore(':memory:', clock);
  try {
    const p = s.action({ action: 'project.save', title: 'Проект' }).projects[0];
    let state = s.action({
      action: 'project.task',
      project_id: p.id,
      title: 'Основная',
    });
    const parent = state.tasks[0];
    state = s.action({
      action: 'project.task',
      project_id: p.id,
      parent_task_id: parent.id,
      title: 'Шаг',
    });
    const child = state.tasks.find((t) => t.parent_task_id);
    assert.throws(() =>
      s.action({
        action: 'task.organize',
        id: parent.id,
        project_id: p.id,
        parent_task_id: child.id,
      }),
    );
    assert.throws(
      () => s.action({ action: 'task.complete', id: parent.id }),
      /подзадачи/,
    );
    s.action({ action: 'task.complete', id: child.id });
    s.action({ action: 'task.complete', id: parent.id });
    const h = s.action({
      action: 'habit.save',
      title: 'Чтение',
      target_per_week: 3,
    }).habits[0];
    s.action({ action: 'habit.check', id: h.id, date: '2026-09-07' });
    state = s.action({ action: 'habit.check', id: h.id, date: '2026-09-07' });
    assert.equal(state.habit_checks.length, 1);
    assert.throws(
      () => s.action({ action: 'habit.check', id: h.id, date: '2026-09-08' }),
      /Будущую/,
    );
  } finally {
    s.close();
  }
});
test('day preview splits work, keeps fixed meeting, applies once, and undo restores calendar only', () => {
  const s = createStore(':memory:', clock);
  try {
    s.action(task);
    const meeting = s.action(event).events[0];
    const before = s.snapshot();
    const p = s.preview({ kind: 'schedule', date: '2026-09-07', replan: true });
    assert.deepEqual(s.snapshot().events, before.events);
    assert.equal(p.blocks.length, 3);
    for (const b of p.blocks)
      assert.ok(b.end_at <= meeting.start_at || b.start_at >= iso(11, 10));
    let state = s.action({ action: 'plan.apply', token: p.token });
    assert.equal(state.events.length, 4);
    assert.equal(state.events.find((e) => e.id === meeting.id).is_fixed, 1);
    assert.equal(
      state.events.filter((e) => e.task_id && e.is_fixed === 0).length,
      3,
    );
    state = s.action({ action: 'plan.apply', token: p.token });
    assert.equal(state.events.length, 4);
    state = s.action({ action: 'calendar.undo' });
    assert.equal(state.events.length, 1);
    assert.equal(state.events[0].id, meeting.id);
  } finally {
    s.close();
  }
});
test('stale preview rejects changes atomically; capacity never exceeds daily limit', () => {
  const s = createStore(':memory:', clock);
  try {
    s.action(task);
    const p = s.preview({
      kind: 'schedule',
      date: '2026-09-07',
      daily_limit: 60,
    });
    assert.ok(p.warnings.length);
    assert.equal(
      p.blocks.reduce(
        (n, b) => n + (Date.parse(b.end_at) - Date.parse(b.start_at)) / 60000,
        0,
      ),
      60,
    );
    s.action(event);
    assert.throws(
      () => s.action({ action: 'plan.apply', token: p.token }),
      /Данные изменились/,
    );
    assert.equal(s.snapshot().events.length, 1);
    const state = s.snapshot();
    const late = planDay(state, { date: '2026-09-07' }, Date.parse(iso(19)));
    assert.equal(late.blocks.length, 0);
  } finally {
    s.close();
  }
});
test('week scenario protects appointments on free day and creates practice as actual calendar entries', () => {
  const s = createStore(':memory:', clock);
  try {
    s.action(task);
    s.action({
      ...event,
      start_at: new Date('2026-09-11T10:00:00').toISOString(),
      end_at: new Date('2026-09-11T11:00:00').toISOString(),
    });
    const p = s.preview({
      kind: 'week',
      date: '2026-09-07',
      free_day: 5,
      practice_minutes: 30,
    });
    assert.ok(p.warnings.some((w) => w.includes('закреплённые')));
    assert.ok(p.blocks.every((b) => new Date(b.start_at).getDay() !== 5));
    const state = s.action({ action: 'plan.apply', token: p.token });
    assert.equal(
      state.events.filter((e) => e.title === 'Ежедневная практика').length,
      6,
    );
    assert.equal(state.events.filter((e) => e.title === 'Встреча').length, 1);
  } finally {
    s.close();
  }
});
test('quick capture preserves Unicode, requires valid event time, previews before saving', () => {
  const items = parseQuick(
    'Тренировка завтра в 19:00 на час\nНаписать заметку',
    '2026-09-07',
  );
  assert.equal(items[0].date, '2026-09-08');
  assert.equal(items[0].time, '19:00');
  assert.equal(items[0].duration, 60);
  assert.equal(items[1].kind, 'task');
  const s = createStore(':memory:', clock);
  try {
    const p = s.preview({ kind: 'capture', items });
    assert.equal(s.snapshot().events.length, 0);
    const state = s.action({ action: 'plan.apply', token: p.token });
    assert.equal(state.events[0].title, 'Тренировка');
    assert.equal(state.tasks[0].title, 'Написать заметку');
    assert.throws(() =>
      s.preview({ kind: 'capture', items: [{ ...items[0], time: '29:99' }] }),
    );
  } finally {
    s.close();
  }
});
test('ICS exports Unicode and special characters, expands recurring exceptions and deduplicates imports', () => {
  const original = [
    {
      id: 'event',
      title: 'Обзор, планы; завтра',
      description: 'Первая\nВторая',
      start_at: iso(10),
      end_at: iso(11),
    },
  ];
  const serialized = exportICS(original);
  const parsed = importICS(serialized, '2026-09-07', '2026-09-09');
  assert.equal(parsed.blocks[0].title, original[0].title);
  assert.equal(parsed.blocks[0].description, original[0].description);
  const source =
    'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:daily\r\nDTSTART:20260907T100000Z\r\nDTEND:20260907T110000Z\r\nRRULE:FREQ=DAILY;COUNT=3\r\nEXDATE:20260908T100000Z\r\nSUMMARY:Daily\r\nEND:VEVENT\r\nEND:VCALENDAR';
  assert.equal(importICS(source, '2026-09-07', '2026-09-10').blocks.length, 2);
  const s = createStore(':memory:', clock);
  try {
    let p = s.preview({
      kind: 'ics',
      source: serialized,
      from: '2026-09-07',
      until: '2026-09-09',
    });
    s.action({ action: 'plan.apply', token: p.token });
    p = s.preview({
      kind: 'ics',
      source: serialized,
      from: '2026-09-07',
      until: '2026-09-09',
    });
    assert.equal(
      s.action({ action: 'plan.apply', token: p.token }).events.length,
      1,
    );
  } finally {
    s.close();
  }
});
test('month-end recurring flows clamp dates, settle once and never double count in forecast', () => {
  const s = createStore(':memory:', () =>
    new Date('2026-03-01T12:00:00').getTime(),
  );
  try {
    s.action({
      action: 'settings.save',
      opening_balance: '1000',
      balance_date: '2026-01-01',
    });
    const flow = s.action({
      action: 'flow.save',
      title: 'Аренда',
      type: 'expense',
      amount: '100',
      frequency: 'monthly',
      start_date: '2026-01-31',
    }).flows[0];
    assert.deepEqual(flowDates(flow, '2026-01-01', '2026-03-31'), [
      '2026-01-31',
      '2026-02-28',
      '2026-03-31',
    ]);
    s.action({
      action: 'flow.settle',
      id: flow.id,
      date: '2026-02-28',
      actual_date: '2026-02-28',
    });
    const state = s.action({
      action: 'flow.settle',
      id: flow.id,
      date: '2026-02-28',
      actual_date: '2026-02-28',
    });
    assert.equal(state.transactions.length, 1);
    assert.equal(
      forecast(state, '2026-01-01', '2026-03-31').at(-1).balance,
      70000,
    );
  } finally {
    s.close();
  }
});
test('checkpoint, thought conversion and attached binary survive backup restore', () => {
  const folder = mkdtempSync(join(tmpdir(), 'focal-v4-'));
  const s = createStore(join(folder, 'test.sqlite'), clock);
  try {
    const t = s.action(task).tasks[0];
    s.action({
      action: 'checkpoint.add',
      task_id: t.id,
      summary: 'Закончил структуру',
      next_step: 'Написать введение',
    });
    const thought = s.action({
      action: 'thought.add',
      task_id: t.id,
      body: 'Идея 💡',
    }).thoughts[0];
    s.action({
      action: 'thought.convert',
      id: thought.id,
      kind: 'note',
      date: '2026-09-07',
    });
    assert.throws(
      () =>
        s.action({ action: 'thought.convert', id: thought.id, kind: 'task' }),
      /разобрана/,
    );
    const state = s.uploadResource(
      { task_id: t.id, title: 'test.txt' },
      Buffer.from('материал'),
    );
    const id = state.resources[0].id;
    assert.equal('content' in state.resources[0], false);
    const p = s.inspectBackup(s.backup().bytes);
    s.action({ action: 'resource.delete', id });
    const restored = s.restoreBackup(p.token);
    assert.equal(restored.checkpoints[0].next_step, 'Написать введение');
    assert.equal(restored.notes[0].body, 'Идея 💡');
    assert.equal(Buffer.from(s.resource(id).content).toString(), 'материал');
  } finally {
    s.close();
    rmSync(folder, { recursive: true, force: true, maxRetries: 3 });
  }
});
test('AI output cannot inject actions, IDs or arbitrary fields into candidate list', () => {
  const r = validateAssistant(
    {
      summary: 'План',
      day_end: 100,
      items: [
        {
          title: 'Задача',
          kind: 'event',
          date: '2026-09-07',
          time: '30:12',
          duration: -1,
          action: 'task.delete',
          id: 'existing',
        },
      ],
    },
    '2026-09-07',
  );
  assert.equal(r.day_end, null);
  assert.equal(r.items[0].time, '');
  assert.equal(r.items[0].duration, 30);
  assert.equal(r.items[0].action, undefined);
  assert.equal(r.items[0].id, undefined);
});
test('shortening the workday relocates flexible blocks after the requested end', () => {
  const s = createStore(':memory:', clock);
  try {
    const t = s.action(task).tasks[0];
    const late = s.action({
      ...event,
      title: t.title,
      task_id: t.id,
      start_at: iso(18),
      end_at: iso(19),
    }).events[0];
    const p = s.preview({
      kind: 'schedule',
      date: '2026-09-07',
      day_end: 17,
      replan: true,
    });
    assert.ok(p.removed.some((e) => e.id === late.id));
    assert.ok(p.blocks.every((e) => e.end_at <= iso(17)));
    assert.equal(
      s
        .action({ action: 'plan.apply', token: p.token })
        .events.some((e) => e.id === late.id),
      false,
    );
  } finally {
    s.close();
  }
});
test('browser and desktop share one persistent delivery claim for each reminder', () => {
  let now = new Date('2026-09-07T09:55:00').getTime();
  const s = createStore(':memory:', () => now);
  try {
    const e = s.action({ ...event, reminder_minutes: 5 }).events[0];
    const trigger = Date.parse(e.start_at) - 300000;
    assert.equal(s.claimReminder({ id: e.id, trigger }).claimed, true);
    assert.equal(s.claimReminder({ id: e.id, trigger }).claimed, false);
    now = Date.parse(e.start_at);
    assert.equal(s.claimReminder({ id: e.id, trigger: now }).claimed, true);
    assert.equal(s.claimReminder({ id: e.id, trigger: now }).claimed, false);
  } finally {
    s.close();
  }
});
test('explicit source dates and times override small-model guesses and cannot leak between sentences', () => {
  const source =
    'Тренировка завтра в 19:00 на час. Подготовить презентацию на 45 минут.';
  const r = validateAssistant(
    {
      items: [
        {
          title: 'Тренировка',
          date: '2026-09-06',
          time: '19:00',
          duration: 30,
          kind: 'task',
        },
        {
          title: 'Подготовка презентации',
          date: '2026-09-07',
          time: '19:00',
          duration: 60,
          kind: 'event',
        },
      ],
    },
    '2026-09-06',
    source,
  );
  assert.equal(r.items[0].date, '2026-09-07');
  assert.equal(r.items[0].duration, 60);
  assert.equal(r.items[0].kind, 'event');
  assert.equal(r.items[1].date, '2026-09-06');
  assert.equal(r.items[1].time, '');
  assert.equal(r.items[1].kind, 'task');
  assert.equal(r.items[1].duration, 45);
});
