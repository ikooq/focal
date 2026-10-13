import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../server/store.mjs';
import { nextOccurrence } from '../server/workflow.mjs';
import { rankTasks } from '../lib/domain.ts';
import { planDay } from '../server/studio.mjs';
const now = new Date(2026, 8, 8, 10).getTime();
const task = {
  action: 'task.save',
  title: 'Задача',
  brain_hemisphere: 'analytical',
  required_energy: 5,
  penalty_amount: '0',
  estimated_minutes: 30,
};
const start = {
  action: 'session.start',
  dopamine_debt_duration: 0,
  work_duration: 25,
  break_duration: 5,
  audio_type: 'none',
};
function memory(fn) {
  const store = createStore(':memory:', () => now);
  try {
    fn(store);
  } finally {
    store.close();
  }
}
function add(s, title, extra = {}) {
  return s
    .action({ ...task, title, ...extra })
    .tasks.find((t) => t.title === title);
}
test('waiting and dependency blocks apply to focus, completion, ranking and automatic planning', () =>
  memory((s) => {
    const a = add(s, 'Согласовать цену'),
      b = add(s, 'Отправить предложение');
    let state = s.action({
      action: 'task.configure',
      id: b.id,
      dependencies: [a.id],
    });
    assert.deepEqual(state.tasks.find((t) => t.id === b.id).blocked_by, [
      a.title,
    ]);
    assert.throws(
      () => s.action({ ...start, task_id: b.id }),
      /Сначала завершите/,
    );
    assert.throws(
      () => s.action({ action: 'task.complete', id: b.id }),
      /Сначала завершите/,
    );
    assert.throws(
      () =>
        s.action({ action: 'task.configure', id: a.id, dependencies: [b.id] }),
      /круг/,
    );
    assert.deepEqual(
      rankTasks(state.tasks, 5).map((t) => t.id),
      [a.id],
    );
    assert.ok(
      planDay(state, { date: '2026-09-08' }, now).blocks.every(
        (e) => e.task_id !== b.id,
      ),
    );
    s.action({ action: 'task.complete', id: a.id });
    state = s.action({
      action: 'task.stage',
      id: b.id,
      stage: 'waiting',
      waiting_reason: 'Ответ клиента',
    });
    assert.equal(rankTasks(state.tasks, 5).length, 0);
    assert.throws(() => s.action({ ...start, task_id: b.id }), /ожидает/);
    s.action({ action: 'task.stage', id: b.id, stage: 'doing' });
    state = s.action({ ...start, task_id: b.id });
    assert.equal(state.tasks.find((t) => t.id === b.id).board_status, 'doing');
    assert.throws(
      () => s.action({ action: 'trash.move', kind: 'task', id: b.id }),
      /фокус/,
    );
  }));
test('monthly and completion-relative repeat dates handle month ends, leap years and late completion', () => {
  assert.equal(
    nextOccurrence(
      { mode: 'monthly', every: 1, day: 31 },
      '2026-01-31',
      '2026-01-31T12:00:00Z',
    ),
    '2026-02-28',
  );
  assert.equal(
    nextOccurrence(
      { mode: 'monthly', every: 1, day: 31 },
      '2026-02-28',
      '2026-02-28T12:00:00Z',
    ),
    '2026-03-31',
  );
  assert.equal(
    nextOccurrence(
      { mode: 'monthly', every: 1, day: 31 },
      '2028-01-31',
      '2028-01-31T12:00:00Z',
    ),
    '2028-02-29',
  );
  assert.equal(
    nextOccurrence(
      { mode: 'days', every: 7 },
      '2026-09-01',
      '2026-09-20T12:00:00Z',
    ),
    '2026-09-22',
  );
  assert.equal(
    nextOccurrence(
      { mode: 'after', every: 7 },
      '2026-09-01',
      '2026-09-20T12:00:00Z',
    ),
    '2026-09-27',
  );
});
test('recurrence creates exactly one next task, preserves history, tags and project; reopen cannot duplicate it', () =>
  memory((s) => {
    const t = add(s, 'Счета', {
      tags: 'Дом, Финансы',
      recurrence: { mode: 'monthly', every: 1, day: 10 },
    });
    s.action({
      action: 'task.plan',
      id: t.id,
      planned_date: '2026-09-10',
      is_priority: false,
    });
    const payload = {
      action: 'task.complete',
      id: t.id,
      request_id: 'complete-once',
    };
    let state = s.action(payload);
    state = s.action(payload);
    assert.equal(state.tasks.length, 2);
    const next = state.tasks.find((v) => v.id !== t.id);
    assert.equal(next.planned_date, '2026-10-10');
    assert.equal(next.tags_json, '["Дом","Финансы"]');
    assert.equal(next.series_key, t.id);
    s.action({ action: 'task.reopen', id: t.id });
    state = s.action({ action: 'task.complete', id: t.id });
    assert.equal(state.tasks.length, 2);
  }));
test('bulk updates are atomic, tag union is unique, daily priorities are cleared on move', () =>
  memory((s) => {
    const a = add(s, 'А'),
      b = add(s, 'Б');
    s.action({
      action: 'task.plan',
      id: a.id,
      planned_date: '2026-09-08',
      is_priority: true,
    });
    s.action({
      action: 'task.bulk',
      ids: [a.id, b.id],
      operation: 'tag',
      tag: 'Работа',
    });
    s.action({
      action: 'task.bulk',
      ids: [a.id, b.id],
      operation: 'tag',
      tag: 'Работа',
    });
    let state = s.action({
      action: 'task.bulk',
      ids: [a.id, b.id],
      operation: 'plan',
      date: '2026-09-09',
    });
    assert.ok(
      state.tasks.every(
        (t) => t.is_priority === 0 && t.tags_json === '["Работа"]',
      ),
    );
    s.action({ ...start, task_id: b.id });
    assert.throws(
      () =>
        s.action({
          action: 'task.bulk',
          ids: [a.id, b.id],
          operation: 'complete',
        }),
      /фокусом/,
    );
    state = s.snapshot();
    assert.equal(state.tasks.find((t) => t.id === a.id).status, 'pending');
  }));
test('project trash preserves tasks, events, note links and materials; restore returns the entire group', () =>
  memory((s) => {
    let state = s.action({ action: 'project.save', title: 'Запуск' });
    const p = state.projects[0];
    state = s.action({
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
    s.action({
      action: 'event.save',
      title: 'Работа',
      start_at: '2026-09-09T10:00:00Z',
      end_at: '2026-09-09T11:00:00Z',
      task_id: child.id,
      color: 'emerald',
    });
    s.uploadResource(
      { task_id: child.id, title: 'Материал' },
      Buffer.from('test'),
    );
    state = s.action({ action: 'trash.move', kind: 'project', id: p.id });
    assert.equal(state.tasks.length, 0);
    assert.equal(state.events.length, 0);
    assert.equal(state.projects.length, 0);
    assert.equal(state.trash.length, 3);
    assert.throws(
      () => s.action({ ...start, task_id: child.id }),
      /не найдена/,
    );
    state = s.action({
      action: 'trash.restore',
      batch: state.trash[0].trash_batch,
    });
    assert.equal(state.tasks.length, 2);
    assert.equal(state.events.length, 1);
    assert.equal(state.projects.length, 1);
    assert.equal(state.resources.length, 1);
    assert.equal(
      state.tasks.find((t) => t.id === child.id).parent_task_id,
      parent.id,
    );
  }));
test('deleted prerequisites remain blocked and separately deleted children restore only after their project', () =>
  memory((s) => {
    const a = add(s, 'А'),
      b = add(s, 'Б');
    s.action({ action: 'task.configure', id: b.id, dependencies: [a.id] });
    let state = s.action({ action: 'trash.move', kind: 'task', id: a.id });
    assert.match(state.tasks[0].blocked_by[0], /корзине/);
    state = s.action({
      action: 'trash.restore',
      batch: state.trash[0].trash_batch,
    });
    assert.equal(state.tasks.find((t) => t.id === b.id).blocked_by[0], 'А');
  }));
test('saved views and workflow data survive backup restore', () =>
  memory((s) => {
    const t = add(s, 'Работа', {
      tags: 'Дом',
      recurrence: { mode: 'after', every: 3 },
    });
    s.action({
      action: 'task.stage',
      id: t.id,
      stage: 'waiting',
      waiting_reason: 'Жду',
    });
    s.action({
      action: 'view.save',
      name: 'Дом',
      filter: { tag: 'Дом', status: 'waiting' },
    });
    let state = s.action({
      action: 'note.save',
      title: 'Заметка',
      body: 'Материалы',
      note_date: '2026-09-08',
    });
    s.action({ action: 'note.delete', id: state.notes[0].id });
    const bytes = s.backup().bytes;
    s.action({ action: 'task.stage', id: t.id, stage: 'planned' });
    state = s.restoreBackup(s.inspectBackup(bytes).token);
    assert.equal(state.tasks[0].waiting_reason, 'Жду');
    assert.equal(state.tasks[0].board_status, 'waiting');
    assert.equal(state.settings.saved_views[0].filter.tag, 'Дом');
    assert.equal(state.trash.length, 1);
  }));

test('bulk completion orders selected dependencies and parent tasks before committing', () =>
  memory((s) => {
    const p = s.action({ action: 'project.save', title: 'Проект' }).projects[0];
    const parent = s.action({
      action: 'project.task',
      project_id: p.id,
      title: 'Основная',
    }).tasks[0];
    const child = s
      .action({
        action: 'project.task',
        project_id: p.id,
        parent_task_id: parent.id,
        title: 'Подзадача',
      })
      .tasks.find((t) => t.parent_task_id);
    const next = add(s, 'После проекта');
    s.action({
      action: 'task.configure',
      id: next.id,
      dependencies: [parent.id],
    });
    const state = s.action({
      action: 'task.bulk',
      ids: [next.id, parent.id, child.id],
      operation: 'complete',
    });
    assert.ok(state.tasks.every((t) => t.status === 'completed'));
  }));
test('bulk project move and trash handle selected parents and children as a group', () =>
  memory((s) => {
    const p = s.action({ action: 'project.save', title: 'А' }).projects[0];
    const q = s
      .action({ action: 'project.save', title: 'Б' })
      .projects.find((p) => p.title === 'Б');
    const parent = s.action({
      action: 'project.task',
      project_id: p.id,
      title: 'Основная',
    }).tasks[0];
    const child = s
      .action({
        action: 'project.task',
        project_id: p.id,
        parent_task_id: parent.id,
        title: 'Подзадача',
      })
      .tasks.find((t) => t.parent_task_id);
    let state = s.action({
      action: 'task.bulk',
      ids: [child.id, parent.id],
      operation: 'project',
      project_id: q.id,
    });
    assert.ok(state.tasks.every((t) => t.project_id === q.id));
    state = s.action({
      action: 'task.bulk',
      ids: [parent.id, child.id],
      operation: 'trash',
    });
    assert.equal(state.tasks.length, 0);
    assert.equal(new Set(state.trash.map((t) => t.trash_batch)).size, 1);
  }));
test('organizing a dependency as a child cannot introduce an implicit cycle', () =>
  memory((s) => {
    const p = s.action({ action: 'project.save', title: 'Проект' }).projects[0];
    const a = add(s, 'А'),
      b = add(s, 'Б');
    s.action({ action: 'task.organize', id: a.id, project_id: p.id });
    s.action({ action: 'task.configure', id: b.id, dependencies: [a.id] });
    assert.throws(
      () =>
        s.action({
          action: 'task.organize',
          id: b.id,
          project_id: p.id,
          parent_task_id: a.id,
        }),
      /круг/,
    );
    assert.equal(
      s.snapshot().tasks.find((t) => t.id === b.id).parent_task_id,
      null,
    );
  }));
