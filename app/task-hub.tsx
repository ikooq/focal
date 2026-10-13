'use client';
/* oxlint-disable jsx-a11y/no-noninteractive-element-interactions -- Native card dragging has an equivalent labelled state selector for keyboard users. */
import { useState } from 'react';
import {
  Plus,
  Play,
  Check,
  CalendarDays,
  Trash2,
  RotateCcw,
  Star,
  List,
  Columns3,
  Repeat2,
  Search,
  ArrowRight,
} from 'lucide-react';
import {
  type State,
  type Task,
  type Mutate,
  dayKey,
  energyProfile,
} from '@/lib/domain';
import { addDays } from '@/lib/calendar';
import { Field } from './sections';
export const taskTags = (task: Task): string[] =>
  JSON.parse(task.tags_json || '[]');
export const readyTask = (task: Task) =>
  task.status === 'pending' &&
  task.board_status !== 'waiting' &&
  !task.blocked_by?.length;
const labels: Record<string, string> = {
  planned: 'В плане',
  doing: 'В работе',
  waiting: 'Ожидает',
  completed: 'Готово',
};
export default function TaskHub({
  data,
  mutate,
  busy,
  onAdd,
  onOpen,
  onStart,
  onSchedule,
  initialFilter = 'open',
}: {
  data: State;
  mutate: Mutate;
  busy: boolean;
  onAdd: () => void;
  onOpen: (task: Task) => void;
  onStart: (task: Task) => void;
  onSchedule: (id: string) => void;
  initialFilter?: string;
}) {
  const [mode, setMode] = useState('list'),
    [query, setQuery] = useState(''),
    [status, setStatus] = useState(initialFilter),
    [tag, setTag] = useState(''),
    [project, setProject] = useState(''),
    [selected, setSelected] = useState<string[]>([]),
    [viewName, setViewName] = useState(''),
    [bulk, setBulk] = useState('plan'),
    [bulkValue, setBulkValue] = useState('');
  const today = dayKey(new Date(data.server_now));
  const energy = energyProfile(data.energy_logs, new Date(data.server_now));
  const filtered = data.tasks.filter(
    (t) =>
      (!query ||
        t.title.toLocaleLowerCase().includes(query.toLocaleLowerCase())) &&
      (!tag || taskTags(t).includes(tag)) &&
      (!project || t.project_id === project) &&
      (status === 'all' || status === 'completed'
        ? status === 'all' || t.status === 'completed'
        : t.status !== 'completed' &&
          (status === 'waiting'
            ? t.board_status === 'waiting' || !!t.blocked_by?.length
            : status === 'energy'
              ? readyTask(t) &&
                (energy.value === null || t.required_energy <= energy.value)
              : status === 'short'
                ? (t.estimated_minutes || 30) <= 15
                : status === 'overdue'
                  ? !!t.deadline && t.deadline < data.server_now
                  : true)),
  );
  const tags = [...new Set(data.tasks.flatMap(taskTags))].sort();
  const active = data.sessions.some((s) =>
    ['work', 'preparation', 'break'].includes(s.phase),
  );
  const visibleSelected = selected.filter((id) =>
    filtered.some((t) => t.id === id),
  );
  const runBulk = async () => {
    if (
      await mutate(
        {
          action: 'task.bulk',
          ids: visibleSelected,
          operation: bulk,
          date: bulk === 'plan' ? bulkValue || null : undefined,
          tag: bulk === 'tag' ? bulkValue : undefined,
          project_id: bulk === 'project' ? bulkValue || null : undefined,
        },
        'Задачи обновлены',
      )
    )
      setSelected([]);
  };
  const move = async (task: Task, stage: string) => {
    if (
      stage ===
      (task.status === 'completed'
        ? 'completed'
        : task.board_status || 'planned')
    )
      return;
    if (stage === 'completed')
      await mutate(
        { action: 'task.complete', id: task.id },
        'Задача завершена',
      );
    else
      await mutate(
        {
          action: 'task.stage',
          id: task.id,
          stage,
          reopen: task.status === 'completed',
          waiting_reason: task.waiting_reason,
        },
        'Состояние обновлено',
      );
  };
  function card(task: Task) {
    const stage =
      task.status === 'completed'
        ? 'completed'
        : task.board_status || 'planned';
    return (
      <article
        key={task.id}
        className={`work-card stage-${stage}`}
        draggable={!busy && task.status !== 'active'}
        onDragStart={(e) => e.dataTransfer.setData('text/plain', task.id)}
      >
        <div className="work-card-top">
          <input
            type="checkbox"
            className="task-select"
            aria-label={`Выбрать: ${task.title}`}
            checked={visibleSelected.includes(task.id)}
            onChange={(e) =>
              setSelected(
                e.target.checked
                  ? [...selected, task.id]
                  : selected.filter((id) => id !== task.id),
              )
            }
          />
          <button className="work-title" onClick={() => onOpen(task)}>
            {task.title}
          </button>
          {task.recurrence_json && (
            <Repeat2 size={16} aria-label="Повторяющаяся задача" />
          )}
        </div>
        <div className="work-meta">
          <span>{task.estimated_minutes || 30} мин</span>
          {task.planned_date && (
            <span>
              {task.planned_date === today
                ? 'Сегодня'
                : new Date(task.planned_date + 'T12:00:00').toLocaleDateString(
                    'ru-RU',
                    { day: 'numeric', month: 'short' },
                  )}
            </span>
          )}
          {task.deadline && (
            <span
              className={
                task.deadline < data.server_now && task.status !== 'completed'
                  ? 'deadline-late'
                  : ''
              }
            >
              Срок:{' '}
              {new Date(task.deadline).toLocaleDateString('ru-RU', {
                day: 'numeric',
                month: 'short',
              })}
            </span>
          )}
          {taskTags(task).map((t) => (
            <button className="tag-chip" key={t} onClick={() => setTag(t)}>
              #{t}
            </button>
          ))}
        </div>
        {task.blocked_by?.length || task.board_status === 'waiting' ? (
          <p className="waiting-line">
            {task.blocked_by?.length
              ? 'После: ' + task.blocked_by.join(', ')
              : task.waiting_reason || 'Ожидает ответа'}
          </p>
        ) : null}
        <div className="work-card-footer">
          <select
            aria-label={`Состояние: ${task.title}`}
            value={stage}
            disabled={busy || task.status === 'active'}
            onChange={(e) => void move(task, e.target.value)}
          >
            {Object.entries(labels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <div className="work-actions">
            {task.status !== 'completed' && (
              <>
                <button
                  className={`icon-button ${task.is_priority && task.planned_date === today ? 'green-text' : ''}`}
                  aria-label={`Главное на сегодня: ${task.title}`}
                  title="Главное на сегодня"
                  disabled={busy || !readyTask(task)}
                  onClick={() =>
                    void mutate({
                      action: 'task.plan',
                      id: task.id,
                      planned_date: today,
                      is_priority: !(
                        task.is_priority && task.planned_date === today
                      ),
                    })
                  }
                >
                  <Star size={16} />
                </button>
                <button
                  className="icon-button"
                  aria-label={`Запланировать: ${task.title}`}
                  title="Запланировать"
                  onClick={() => onSchedule(task.id)}
                >
                  <CalendarDays size={16} />
                </button>
                <button
                  className="icon-button"
                  aria-label={`Завершить: ${task.title}`}
                  title="Завершить"
                  disabled={busy || !readyTask(task)}
                  onClick={() => void move(task, 'completed')}
                >
                  <Check size={16} />
                </button>
                <button
                  className="secondary compact-start"
                  disabled={busy || active || !readyTask(task)}
                  onClick={() => onStart(task)}
                >
                  <Play size={14} />
                  Фокус
                </button>
              </>
            )}
            <button
              className="icon-button"
              aria-label={`В корзину: ${task.title}`}
              title="В корзину"
              disabled={busy || task.status === 'active'}
              onClick={() =>
                void mutate(
                  { action: 'trash.move', kind: 'task', id: task.id },
                  'Задача в корзине. Её можно восстановить.',
                )
              }
            >
              <Trash2 size={15} />
            </button>
          </div>
        </div>
      </article>
    );
  }
  return (
    <section className="task-hub">
      <p className="work-meta">
        В списке: {filtered.length}
        {status === 'energy' ? ` · ${energy.source}` : ''}
      </p>
      <div className="hub-toolbar">
        <label className="hub-search">
          <Search size={16} />
          <input
            aria-label="Поиск задач"
            placeholder="Найти задачу…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <select
          aria-label="Фильтр задач"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          {[
            ['open', 'Незавершённые'],
            ['energy', 'По энергии'],
            ['all', 'Все'],
            ['waiting', 'Ожидают'],
            ['short', 'До 15 минут'],
            ['overdue', 'Просроченные'],
            ['completed', 'Готово'],
          ].map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
        <select
          aria-label="Фильтр по проекту"
          value={project}
          onChange={(e) => setProject(e.target.value)}
        >
          <option value="">Все проекты</option>
          {data.projects
            ?.filter((p) => !p.archived)
            .map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
        </select>
        <select
          aria-label="Фильтр по метке"
          value={tag}
          onChange={(e) => setTag(e.target.value)}
        >
          <option value="">Все метки</option>
          {tags.map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
        <div className="segmented">
          <button
            className={mode === 'list' ? 'selected' : ''}
            aria-label="Список"
            onClick={() => setMode('list')}
          >
            <List size={17} />
          </button>
          <button
            className={mode === 'board' ? 'selected' : ''}
            aria-label="Канбан"
            onClick={() => {
              setMode('board');
              if (status === 'open') setStatus('all');
            }}
          >
            <Columns3 size={17} />
          </button>
        </div>
      </div>
      <div className="saved-views">
        {data.settings?.saved_views?.map((v) => (
          <div className="saved-view" key={v.id}>
            <button
              onClick={() => {
                setQuery(v.filter.query);
                setTag(v.filter.tag);
                setProject(v.filter.project);
                setStatus(v.filter.status);
              }}
            >
              {v.name}
            </button>
            <button
              aria-label={`Удалить представление ${v.name}`}
              disabled={busy}
              onClick={() => void mutate({ action: 'view.delete', id: v.id })}
            >
              ×
            </button>
          </div>
        ))}
        <details>
          <summary>Сохранить фильтр</summary>
          <form
            className="inline-form"
            onSubmit={async (e) => {
              e.preventDefault();
              if (
                await mutate(
                  {
                    action: 'view.save',
                    name: viewName,
                    filter: { query, tag, project, status },
                  },
                  'Представление сохранено',
                )
              )
                setViewName('');
            }}
          >
            <input
              aria-label="Название представления"
              placeholder="Например, работа на 15 минут"
              required
              maxLength={60}
              value={viewName}
              onChange={(e) => setViewName(e.target.value)}
            />
            <button className="secondary" disabled={busy}>
              Сохранить
            </button>
          </form>
        </details>
      </div>
      {!!filtered.length && (
        <label className="select-all">
          <input
            type="checkbox"
            checked={visibleSelected.length === filtered.length}
            onChange={(e) =>
              setSelected(e.target.checked ? filtered.map((t) => t.id) : [])
            }
          />
          Выбрать все
        </label>
      )}
      {visibleSelected.length > 0 && (
        <div className="bulk-bar">
          <strong>Выбрано: {visibleSelected.length}</strong>
          <select
            aria-label="Массовое действие"
            value={bulk}
            onChange={(e) => {
              setBulk(e.target.value);
              setBulkValue('');
            }}
          >
            {[
              ['plan', 'Перенести на дату'],
              ['project', 'Назначить проект'],
              ['tag', 'Добавить метку'],
              ['complete', 'Завершить'],
              ['trash', 'В корзину'],
            ].map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
          {bulk === 'project' ? (
            <select
              aria-label="Проект для выбранных задач"
              value={bulkValue}
              onChange={(e) => setBulkValue(e.target.value)}
            >
              <option value="">Без проекта</option>
              {data.projects
                ?.filter((p) => !p.archived)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title}
                  </option>
                ))}
            </select>
          ) : ['plan', 'tag'].includes(bulk) ? (
            <input
              aria-label={
                bulk === 'plan'
                  ? 'Дата для выбранных задач'
                  : 'Метка для выбранных задач'
              }
              type={bulk === 'plan' ? 'date' : 'text'}
              maxLength={40}
              value={bulkValue}
              onChange={(e) => setBulkValue(e.target.value)}
            />
          ) : null}
          <button
            className="primary"
            disabled={busy || (bulk === 'tag' && !bulkValue.trim())}
            onClick={() => void runBulk()}
          >
            Применить
          </button>
          <button className="text-action" onClick={() => setSelected([])}>
            Снять выбор
          </button>
        </div>
      )}
      {mode === 'board' ? (
        <div className="kanban-board">
          {Object.entries(labels).map(([stage, label]) => {
            const items = filtered.filter(
              (t) =>
                (t.status === 'completed'
                  ? 'completed'
                  : t.board_status || 'planned') === stage,
            );
            return (
              <section
                key={stage}
                className={'kanban-column ' + stage}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const task = data.tasks.find(
                    (t) => t.id === e.dataTransfer.getData('text/plain'),
                  );
                  if (task && !busy) void move(task, stage);
                }}
              >
                <h3>
                  <i />
                  {label}
                  <span>{items.length}</span>
                </h3>
                {items.map(card)}
                {!items.length && (
                  <p className="column-empty">Перетащите задачу сюда</p>
                )}
              </section>
            );
          })}
        </div>
      ) : (
        <div className="hub-list">{filtered.map(card)}</div>
      )}
      {!filtered.length && (
        <div className="hub-empty">
          <Check size={28} />
          <h3>
            {data.tasks.length ? 'Ничего не найдено' : 'Начните с одного дела'}
          </h3>
          <p className="muted">
            {data.tasks.length
              ? 'Измените фильтры или создайте задачу.'
              : 'Достаточно названия. Остальное можно уточнить позже.'}
          </p>
          <button className="secondary" onClick={onAdd}>
            <Plus size={16} />
            Добавить задачу
          </button>
        </div>
      )}
    </section>
  );
}

export function WorkflowFields({
  task,
  data,
  mutate,
}: {
  task: Task;
  data: State;
  mutate: Mutate;
}) {
  const [reason, setReason] = useState(task.waiting_reason || ''),
    [dependency, setDependency] = useState(''),
    [busy, setBusy] = useState(false);
  const ids: string[] = JSON.parse(task.dependencies_json || '[]');
  const history = data.tasks.filter(
    (t) => t.series_key && t.series_key === task.series_key,
  );
  const tomorrow = dayKey(addDays(new Date(data.server_now), 1));
  return (
    <div className="workflow-fields">
      <div className="form-pair">
        <Field label="Состояние">
          <select
            value={task.board_status || 'planned'}
            disabled={task.status !== 'pending'}
            onChange={(e) =>
              void mutate({
                action: 'task.stage',
                id: task.id,
                stage: e.target.value,
                waiting_reason: reason,
              })
            }
          >
            {Object.entries(labels)
              .filter(([v]) => v !== 'completed')
              .map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
          </select>
        </Field>
        <Field label="Плановая дата">
          <input
            type="date"
            value={task.planned_date || ''}
            onChange={(e) =>
              void mutate({
                action: 'task.plan',
                id: task.id,
                planned_date: e.target.value,
                is_priority: false,
              })
            }
          />
        </Field>
      </div>
      {task.board_status === 'waiting' && (
        <div className="inline-form">
          <input
            aria-label="Кого или чего ждём"
            placeholder="Например, ответ от дизайнера"
            value={reason}
            maxLength={500}
            onChange={(e) => setReason(e.target.value)}
          />
          <button
            type="button"
            className="secondary"
            onClick={() =>
              void mutate({
                action: 'task.stage',
                id: task.id,
                stage: 'waiting',
                waiting_reason: reason,
              })
            }
          >
            Сохранить
          </button>
        </div>
      )}
      <button
        type="button"
        className="text-action"
        onClick={() =>
          void mutate(
            {
              action: 'task.plan',
              id: task.id,
              planned_date: tomorrow,
              is_priority: false,
            },
            'Перенесено на завтра',
          )
        }
      >
        <ArrowRight size={14} />
        На завтра
      </button>
      <details className="dependency-editor">
        <summary>Зависимости {ids.length > 0 ? `· ${ids.length}` : ''}</summary>
        <p className="muted">
          Задача станет доступна после выполнения всех выбранных дел.
        </p>
        {ids.map((id) => (
          <div key={id} className="dependency-row">
            <span>
              {data.tasks.find((t) => t.id === id)?.title || 'Задача в корзине'}
            </span>
            <button
              type="button"
              className="text-action"
              onClick={() =>
                void mutate({
                  action: 'task.configure',
                  id: task.id,
                  dependencies: ids.filter((v) => v !== id),
                })
              }
            >
              Убрать
            </button>
          </div>
        ))}
        <div className="inline-form">
          <select
            aria-label="Зависит от задачи"
            value={dependency}
            onChange={(e) => setDependency(e.target.value)}
          >
            <option value="">Выберите задачу</option>
            {data.tasks
              .filter((t) => t.id !== task.id && !ids.includes(t.id))
              .map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title}
                </option>
              ))}
          </select>
          <button
            type="button"
            className="secondary"
            disabled={!dependency || busy}
            onClick={async () => {
              setBusy(true);
              if (
                await mutate({
                  action: 'task.configure',
                  id: task.id,
                  dependencies: [...ids, dependency],
                })
              )
                setDependency('');
              setBusy(false);
            }}
          >
            Добавить
          </button>
        </div>
      </details>
      {history.length > 1 && (
        <details>
          <summary>История повторений · {history.length}</summary>
          {history.map((t) => (
            <p key={t.id} className="work-meta">
              {t.planned_date || 'Без даты'} ·{' '}
              {t.status === 'completed' ? 'Выполнено' : 'В плане'}
            </p>
          ))}
        </details>
      )}
    </div>
  );
}
export function TrashView({
  data,
  mutate,
  busy,
}: {
  data: State;
  mutate: Mutate;
  busy: boolean;
}) {
  const groups = [...new Set(data.trash?.map((t) => t.trash_batch))];
  return (
    <section className="panel trash-view">
      <h2>
        Корзина <span className="count">{data.trash?.length || 0}</span>
      </h2>
      <p className="muted">
        Записи хранятся до восстановления. Проект возвращается вместе с
        удалёнными с ним задачами и материалами.
      </p>
      {groups.map((batch) => {
        const items = data.trash!.filter((t) => t.trash_batch === batch);
        const item = items.find((t) => t.kind === 'projects') || items[0];
        return (
          <div className="trash-row" key={batch}>
            <div>
              <strong>{item.title}</strong>
              <p className="work-meta">
                {
                  { tasks: 'Задача', notes: 'Заметка', projects: 'Проект' }[
                    item.kind
                  ]
                }{' '}
                · {new Date(item.deleted_at).toLocaleDateString('ru-RU')}
                {items.length > 1 ? ` · записей: ${items.length}` : ''}
              </p>
            </div>
            <button
              className="secondary"
              disabled={busy}
              onClick={() =>
                void mutate({ action: 'trash.restore', batch }, 'Восстановлено')
              }
            >
              <RotateCcw size={15} />
              Восстановить
            </button>
          </div>
        );
      })}
      {!groups.length && <p className="hub-empty">Корзина пуста</p>}
    </section>
  );
}
