'use client';
import { useState, type SubmitEvent } from 'react';
import {
  ArrowRight,
  Check,
  FolderOpen,
  Plus,
  Target,
  BookOpen,
  Archive,
} from 'lucide-react';
import {
  dayKey,
  type State,
  type Mutate,
  type Decision,
  type Task,
} from '@/lib/domain';
import { addDays, weekStart as startOfWeek } from '@/lib/calendar';
import { Field } from './sections';
import { WorkflowFields } from './task-hub';
import Materials from './materials';
import { VoiceInput } from './capture-controls';

export function CheckpointForm({
  taskId,
  sessionId,
  mutate,
}: {
  taskId: string;
  sessionId?: string;
  mutate: Mutate;
}) {
  const [summary, setSummary] = useState(''),
    [step, setStep] = useState(''),
    [saved, setSaved] = useState(false),
    [busy, setBusy] = useState(false);
  return (
    <div className="checkpoint-form">
      <h3>Продолжить с этого места</h3>
      <textarea
        aria-label="Где вы остановились"
        placeholder="Что сделано и где вы остановились?"
        value={summary}
        maxLength={5000}
        onChange={(e) => {
          setSummary(e.target.value);
          setSaved(false);
        }}
      />
      <VoiceInput onText={(t) => setSummary((s) => (s ? `${s}\n${t}` : t))} />
      <input
        aria-label="Следующий шаг"
        placeholder="Следующий конкретный шаг"
        value={step}
        maxLength={1000}
        onChange={(e) => setStep(e.target.value)}
      />
      <button
        type="button"
        className="secondary"
        disabled={!summary.trim() || busy}
        onClick={async () => {
          setBusy(true);
          if (
            await mutate(
              {
                action: 'checkpoint.add',
                task_id: taskId,
                session_id: sessionId,
                summary,
                next_step: step,
              },
              'Точка продолжения сохранена',
            )
          ) {
            setSaved(true);
            setSummary('');
            setStep('');
          }
          setBusy(false);
        }}
      >
        {saved ? 'Сохранено' : 'Запомнить место'}
      </button>
    </div>
  );
}
export function ThoughtParking({
  taskId,
  sessionId,
  mutate,
}: {
  taskId: string;
  sessionId: string;
  mutate: Mutate;
}) {
  const [text, setText] = useState(''),
    [saved, setSaved] = useState(false);
  return (
    <details className="thought-parking">
      <summary>Припарковать мысль</summary>
      <p className="muted">
        Таймер продолжает идти. Мысль можно разобрать после сессии.
      </p>
      <textarea
        aria-label="Отвлекающая мысль"
        placeholder="Запишите и вернитесь к задаче…"
        value={text}
        maxLength={5000}
        onChange={(e) => {
          setText(e.target.value);
          setSaved(false);
        }}
      />
      <button
        type="button"
        className="subtle"
        disabled={!text.trim()}
        onClick={async () => {
          if (
            await mutate({
              action: 'thought.add',
              task_id: taskId,
              session_id: sessionId,
              body: text,
            })
          ) {
            setText('');
            setSaved(true);
          }
        }}
      >
        Сохранить мысль
      </button>
      {saved && <output>Сохранено во «Входящие».</output>}
    </details>
  );
}
export function TaskWorkspace({
  task,
  data,
  mutate,
}: {
  task: Task;
  data: State;
  mutate: Mutate;
}) {
  const checkpoint = data.checkpoints?.find((c) => c.task_id === task.id);
  return (
    <div className="task-workspace">
      {checkpoint && (
        <blockquote className="resume-card">
          <small>
            В прошлый раз ·{' '}
            {new Date(checkpoint.created_at).toLocaleDateString('ru-RU')}
          </small>
          <p>{checkpoint.summary}</p>
          {checkpoint.next_step && (
            <strong>
              <ArrowRight size={14} /> {checkpoint.next_step}
            </strong>
          )}
        </blockquote>
      )}
      <Field label="Проект">
        <select
          value={task.project_id || ''}
          onChange={(e) =>
            void mutate({
              action: 'task.organize',
              id: task.id,
              project_id: e.target.value,
            })
          }
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
      </Field>
      <WorkflowFields key={task.id} task={task} data={data} mutate={mutate} />
      <CheckpointForm taskId={task.id} mutate={mutate} />
      <Materials taskId={task.id} mutate={mutate} />
    </div>
  );
}
export default function LifeSpace({
  mode,
  data,
  mutate,
  busy,
  onTask,
}: {
  mode?: 'projects' | 'inbox';
  data: State;
  mutate: Mutate;
  busy: boolean;
  onTask: (task: Task) => void;
}) {
  const [view, setView] = useState(
      mode ||
        (data.settings?.hidden_life_sections?.includes('habits')
          ? 'decisions'
          : 'habits'),
    ),
    [selected, setSelected] = useState(''),
    [editing, setEditing] = useState<Decision | null>(null),
    [archive, setArchive] = useState(false),
    [week, setWeek] = useState(() => dayKey(startOfWeek(new Date())));
  const days = Array.from({ length: 7 }, (_, i) =>
      dayKey(addDays(new Date(week + 'T12:00:00'), i)),
    ),
    today = dayKey(new Date(data.server_now));
  const project = data.projects?.find((p) => p.id === selected && !p.archived);
  async function save(e: SubmitEvent<HTMLFormElement>, action: string) {
    e.preventDefault();
    const form = e.currentTarget,
      f = Object.fromEntries(new FormData(form));
    if (
      await mutate(
        {
          ...f,
          action,
          ...(action === 'habit.save'
            ? { target_per_week: Number(f.target_per_week) }
            : {}),
          ...(action === 'project.task'
            ? {
                project_id: project?.id,
                estimated_minutes: Number(f.estimated_minutes),
              }
            : {}),
          ...(action === 'decision.save' && editing ? { id: editing.id } : {}),
        },
        'Сохранено',
      )
    ) {
      form.reset();
      if (action === 'decision.save') setEditing(null);
    }
  }
  return (
    <div className="life-space">
      <header className="section-heading">
        <div>
          <span className="eyebrow">СИСТЕМА ЛИЧНОГО ПРОГРЕССА</span>
          <h2>
            {mode === 'projects'
              ? 'Проекты'
              : mode === 'inbox'
                ? 'Входящие'
                : 'Привычки и решения'}
          </h2>
          <p className="muted">
            {mode === 'inbox'
              ? 'Мысли из быстрого ввода и фокус-сессий.'
              : mode === 'projects'
                ? 'Задачи, объединённые общим результатом.'
                : 'Регулярные действия и решения, к которым стоит вернуться.'}
          </p>
        </div>
      </header>
      <div className="studio-tabs">
        {[
          ['projects', 'Проекты', FolderOpen],
          ['habits', 'Привычки', Target],
          ['decisions', 'Решения', BookOpen],
          ['inbox', 'Входящие', Plus],
        ]
          .filter(([id]) =>
            mode
              ? id === mode
              : id !== 'projects' &&
                id !== 'inbox' &&
                !data.settings?.hidden_life_sections?.includes(String(id)),
          )
          .map(([id, label, Icon]) => (
            <button
              key={String(id)}
              className={view === id ? 'selected' : ''}
              onClick={() => setView(String(id))}
            >
              {typeof Icon !== 'string' && <Icon size={16} />} {String(label)}
            </button>
          ))}
      </div>
      {view === 'projects' && (
        <div className="project-layout">
          <section className="panel">
            <div className="panel-heading">
              <h3>Ваши проекты</h3>
              <button className="subtle" onClick={() => setArchive(!archive)}>
                <Archive size={14} />
                {archive ? 'Активные' : 'Архив'}
              </button>
            </div>
            {data.projects
              ?.filter((p) => !!p.archived === archive)
              .map((p) => {
                const ts = data.tasks.filter((t) => t.project_id === p.id),
                  done = ts.filter((t) => t.status === 'completed').length;
                return (
                  <div
                    className={`project-card ${selected === p.id ? 'selected' : ''}`}
                    key={p.id}
                  >
                    <button
                      className="project-select"
                      onClick={() => setSelected(p.id)}
                    >
                      <strong>{p.title}</strong>
                      <small>
                        {done} из {ts.length} · {p.target_date || 'Без срока'}
                      </small>
                      <progress value={done} max={ts.length || 1} />
                    </button>
                    <button
                      className="subtle"
                      disabled={busy}
                      onClick={() =>
                        void mutate(
                          { action: 'trash.move', kind: 'project', id: p.id },
                          'Проект с задачами перемещён в корзину',
                        )
                      }
                    >
                      В корзину
                    </button>
                    <button
                      className="subtle"
                      onClick={() =>
                        void mutate({
                          action: 'project.archive',
                          id: p.id,
                          archived: !p.archived,
                        })
                      }
                    >
                      {p.archived ? 'Восстановить' : 'В архив'}
                    </button>
                  </div>
                );
              })}
            <form
              className="stack-form"
              onSubmit={(e) => void save(e, 'project.save')}
            >
              <h3>Новый проект</h3>
              <input
                name="title"
                aria-label="Название проекта"
                placeholder="Например, запустить портфолио"
                required
                maxLength={160}
              />
              <textarea
                name="description"
                aria-label="Результат проекта"
                placeholder="Какой результат хотим получить?"
                maxLength={10000}
              />
              <Field label="Целевая дата">
                <input name="target_date" type="date" />
              </Field>
              <button className="primary" disabled={busy}>
                <Plus size={16} />
                Создать проект
              </button>
            </form>
          </section>
          <section className="panel">
            {project ? (
              <>
                <h3>{project.title}</h3>
                <p className="muted">{project.description}</p>
                {data.tasks
                  .filter(
                    (t) => t.project_id === project.id && !t.parent_task_id,
                  )
                  .map((t) => (
                    <div className="project-task" key={t.id}>
                      <button
                        className="task-title-button"
                        onClick={() => onTask(t)}
                      >
                        {t.status === 'completed' && <Check size={16} />}{' '}
                        {t.title}
                        <small>{t.estimated_minutes || 30} мин.</small>
                      </button>
                      {data.tasks
                        .filter((c) => c.parent_task_id === t.id)
                        .map((c) => (
                          <div className="subtask" key={c.id}>
                            <button
                              className="subtle"
                              disabled={c.status !== 'pending' || busy}
                              onClick={() =>
                                void mutate({
                                  action: 'task.complete',
                                  id: c.id,
                                })
                              }
                              aria-label={`Завершить ${c.title}`}
                            >
                              <Check size={15} />
                            </button>
                            <button
                              className={
                                c.status === 'completed'
                                  ? 'done task-title-button'
                                  : 'task-title-button'
                              }
                              onClick={() => onTask(c)}
                            >
                              {c.title}
                            </button>
                          </div>
                        ))}
                      {t.status === 'pending' && (
                        <form
                          className="inline-fields"
                          onSubmit={(e) => void save(e, 'project.task')}
                        >
                          <input
                            type="hidden"
                            name="parent_task_id"
                            value={t.id}
                          />
                          <input
                            type="hidden"
                            name="estimated_minutes"
                            value="15"
                          />
                          <input
                            name="title"
                            aria-label={`Подзадача для ${t.title}`}
                            placeholder="Добавить подзадачу"
                            required
                            maxLength={160}
                          />
                          <button className="subtle" disabled={busy}>
                            ＋
                          </button>
                        </form>
                      )}
                    </div>
                  ))}
                <form
                  className="stack-form"
                  onSubmit={(e) => void save(e, 'project.task')}
                >
                  <h3>Следующий шаг</h3>
                  <input
                    name="title"
                    aria-label="Задача проекта"
                    placeholder="Что нужно сделать?"
                    required
                    maxLength={160}
                  />
                  <Field label="Оценка, минуты">
                    <input
                      name="estimated_minutes"
                      type="number"
                      min="1"
                      max="1440"
                      defaultValue="30"
                      required
                    />
                  </Field>
                  <button className="secondary" disabled={busy}>
                    Добавить задачу
                  </button>
                </form>
              </>
            ) : (
              <div className="studio-empty">
                <FolderOpen />
                <h3>Выберите или создайте проект</h3>
                <p>Задачи проекта появятся и в общем списке.</p>
              </div>
            )}
          </section>
        </div>
      )}
      {view === 'habits' && (
        <section className="panel">
          <div className="panel-heading">
            <h3>Неделя с {week}</h3>
            <div className="inline-fields">
              <button
                className="subtle"
                onClick={() =>
                  setWeek(dayKey(addDays(new Date(week + 'T12:00:00'), -7)))
                }
              >
                ←
              </button>
              <button
                className="subtle"
                onClick={() => setWeek(dayKey(startOfWeek(new Date())))}
              >
                Сегодня
              </button>
              <button
                className="subtle"
                onClick={() =>
                  setWeek(dayKey(addDays(new Date(week + 'T12:00:00'), 7)))
                }
              >
                →
              </button>
            </div>
          </div>
          <div className="habit-table">
            {data.habits
              ?.filter((h) => !h.archived)
              .map((h) => {
                const count = (data.habit_checks || []).filter(
                  (c) => c.habit_id === h.id && days.includes(c.check_date),
                ).length;
                return (
                  <div className="habit-row" key={h.id}>
                    <div>
                      <strong>{h.title}</strong>
                      <small>
                        {count}/{h.target_per_week} на этой неделе
                      </small>
                    </div>
                    <div className="habit-days">
                      {days.map((d) => {
                        const checked = data.habit_checks?.some(
                          (c) => c.habit_id === h.id && c.check_date === d,
                        );
                        return (
                          <button
                            key={d}
                            disabled={d > today || busy}
                            aria-pressed={!!checked}
                            aria-label={`${h.title}, ${d}`}
                            title={d}
                            className={checked ? 'checked' : ''}
                            onClick={() =>
                              void mutate({
                                action: 'habit.check',
                                id: h.id,
                                date: d,
                                checked: !checked,
                              })
                            }
                          >
                            <small>
                              {new Date(d + 'T12:00:00').toLocaleDateString(
                                'ru-RU',
                                { weekday: 'short' },
                              )}
                            </small>
                            {checked ? <Check size={16} /> : d.slice(-2)}
                          </button>
                        );
                      })}
                    </div>
                    <button
                      className="subtle"
                      aria-label={`Архивировать ${h.title}`}
                      onClick={() =>
                        void mutate({ action: 'habit.archive', id: h.id })
                      }
                    >
                      <Archive size={15} />
                    </button>
                  </div>
                );
              })}
          </div>
          <form
            className="inline-fields"
            onSubmit={(e) => void save(e, 'habit.save')}
          >
            <input
              name="title"
              aria-label="Новая привычка"
              placeholder="Новая привычка"
              required
              maxLength={160}
            />
            <Field label="Раз в неделю">
              <input
                type="number"
                name="target_per_week"
                min="1"
                max="7"
                defaultValue="3"
                required
              />
            </Field>
            <button className="primary" disabled={busy}>
              Добавить
            </button>
          </form>
          {data.habits
            ?.filter((h) => h.archived)
            .map((h) => (
              <button
                className="subtle"
                key={h.id}
                onClick={() =>
                  void mutate({
                    action: 'habit.archive',
                    id: h.id,
                    archived: false,
                  })
                }
              >
                Восстановить «{h.title}»
              </button>
            ))}
        </section>
      )}
      {view === 'decisions' && (
        <div className="project-layout">
          <section className="panel">
            <h3>Дневник решений</h3>
            {data.decisions?.map((d) => (
              <button
                className="decision-card"
                key={d.id}
                onClick={() => setEditing(d)}
              >
                <strong>{d.title}</strong>
                <p>{d.expected || d.reasons}</p>
                <small>
                  {d.decided_on} ·{' '}
                  {d.reviewed_at
                    ? 'Разобрано'
                    : d.review_on
                      ? `Разбор ${d.review_on}`
                      : 'Без даты разбора'}
                </small>
                {d.review_on && d.review_on <= today && !d.reviewed_at && (
                  <span className="accent-text">
                    Пора сравнить ожидания и результат
                  </span>
                )}
              </button>
            ))}
          </section>
          <section className="panel">
            <form
              key={editing?.id || 'new'}
              className="stack-form"
              onSubmit={(e) => void save(e, 'decision.save')}
            >
              <h3>{editing ? 'Разобрать решение' : 'Новое решение'}</h3>
              <input
                name="title"
                aria-label="Решение"
                placeholder="Что решили?"
                required
                maxLength={160}
                defaultValue={editing?.title}
              />
              <Field label="Почему">
                <textarea
                  name="reasons"
                  defaultValue={editing?.reasons}
                  maxLength={10000}
                />
              </Field>
              <Field label="Ожидаемый результат">
                <textarea
                  name="expected"
                  defaultValue={editing?.expected}
                  maxLength={10000}
                />
              </Field>
              <div className="inline-fields">
                <Field label="Дата решения">
                  <input
                    type="date"
                    name="decided_on"
                    defaultValue={editing?.decided_on || today}
                    required
                  />
                </Field>
                <Field label="Вернуться к решению">
                  <input
                    type="date"
                    name="review_on"
                    defaultValue={editing?.review_on || ''}
                  />
                </Field>
              </div>
              <Field label="Что получилось на деле">
                <textarea
                  name="outcome"
                  defaultValue={editing?.outcome}
                  maxLength={10000}
                />
              </Field>
              <button className="primary" disabled={busy}>
                Сохранить
              </button>
              {editing && (
                <button
                  type="button"
                  className="subtle"
                  onClick={() => setEditing(null)}
                >
                  Написать новое решение
                </button>
              )}
            </form>
          </section>
        </div>
      )}
      {view === 'inbox' && (
        <section className="panel">
          <h3>Мысли, которым можно дать место</h3>
          {!(data.thoughts || []).some((t) => !t.resolved_at) && (
            <p className="muted">
              Здесь появятся мысли из быстрого ввода и фокус-сессий.
            </p>
          )}
          {data.thoughts
            ?.filter((t) => !t.resolved_at)
            .map((t) => (
              <article className="thought-card" key={t.id}>
                <p>{t.body}</p>
                <small className="muted">
                  {new Date(t.created_at).toLocaleString('ru-RU')}
                </small>
                <div className="inline-fields">
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() =>
                      void mutate({
                        action: 'thought.convert',
                        id: t.id,
                        kind: 'task',
                      })
                    }
                  >
                    В задачу
                  </button>
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() =>
                      void mutate({
                        action: 'thought.convert',
                        id: t.id,
                        kind: 'note',
                        date: today,
                      })
                    }
                  >
                    В заметку
                  </button>
                  <button
                    className="subtle"
                    disabled={busy}
                    onClick={() =>
                      void mutate({ action: 'thought.dismiss', id: t.id })
                    }
                  >
                    Разобрано
                  </button>
                </div>
              </article>
            ))}
        </section>
      )}
    </div>
  );
}
