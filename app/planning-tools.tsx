'use client';
import { useMemo, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Copy,
  Plus,
  Sparkles,
  Trash2,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { NativeSelect } from '@/components/ui/native-select';
import { type State, type Mutate, type Task, dayKey } from '@/lib/domain';
import { addDays, weekStart, atLocalTime } from '@/lib/calendar';
import {
  freeMinutes,
  learnedEstimate,
  previewTemplate,
  suggestSlots,
  weeklyReview,
} from '@/lib/planning';
import { Field } from './sections';
const when = (d: Date) =>
  d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
const duration = (n: number) =>
  n >= 60
    ? `${Math.floor(n / 60)} ч${Math.round(n % 60) ? ' ' + Math.round(n % 60) + ' мин' : ''}`
    : `${Math.round(n)} мин`;

export function Templates({
  data,
  date,
  mutate,
  busy,
  error,
  close,
}: {
  data: State;
  date: string;
  mutate: Mutate;
  busy: boolean;
  error: string;
  close: () => void;
}) {
  const [name, setName] = useState(''),
    [id, setId] = useState(data.templates[0]?.id || ''),
    [target, setTarget] = useState(
      dayKey(addDays(weekStart(new Date(date + 'T00:00:00')), 7)),
    ),
    [policy, setPolicy] = useState('skip');
  const template = data.templates.find((t) => t.id === id),
    week = dayKey(weekStart(new Date((target || date) + 'T00:00:00')));
  const preview = useMemo(
    () =>
      template ? previewTemplate(template, week, data.events, policy) : [],
    [template, week, data.events, policy],
  );
  const selected = preview.filter(
    (b) => !b.duplicate && (policy === 'allow' || !b.conflict),
  );
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) close();
      }}
    >
      <DialogContent className="focal-dialog tools-dialog">
        <DialogTitle>Шаблоны недели</DialogTitle>
        <DialogDescription>
          Сохраните расписание и применяйте его к другим неделям. Шаблон создаёт
          блоки времени без связей с прежними задачами.
        </DialogDescription>
        <form
          className="template-create"
          onSubmit={async (e) => {
            e.preventDefault();
            const before = data.templates;
            const result = await mutate(
              {
                action: 'template.save',
                name,
                week_start: dayKey(weekStart(new Date(date + 'T00:00:00'))),
              },
              'Шаблон сохранён',
            );
            if (result) {
              setId(
                result.templates.find((t) => !before.some((b) => b.id === t.id))
                  ?.id || '',
              );
              setName('');
            }
          }}
        >
          <Field
            label={`Сохранить неделю с ${dayKey(weekStart(new Date(date + 'T00:00:00')))}`}
          >
            <input
              required
              maxLength={80}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Например, учебная неделя"
            />
          </Field>
          <button className="secondary" disabled={busy}>
            <Plus size={16} />
            Сохранить
          </button>
        </form>
        {data.templates.length > 0 ? (
          <>
            <div className="form-pair">
              <Field label="Шаблон">
                <NativeSelect
                  value={id}
                  onChange={(e) => setId(e.target.value)}
                >
                  <option value="">Выберите шаблон</option>
                  {data.templates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field label="Применить к неделе с выбранной датой">
                <input
                  type="date"
                  value={target}
                  onChange={(e) => setTarget(e.target.value)}
                />
              </Field>
            </div>
            {template && (
              <>
                <div
                  className="template-preview"
                  aria-label="Предварительный просмотр"
                >
                  {preview.map((b, i) => (
                    <div key={i} className={b.conflict ? 'has-conflict' : ''}>
                      <span>
                        {new Date(b.start_at).toLocaleDateString('ru-RU', {
                          weekday: 'short',
                          day: 'numeric',
                          month: 'short',
                        })}{' '}
                        · {when(new Date(b.start_at))}–
                        {when(new Date(b.end_at))}
                      </span>
                      <strong>{b.title}</strong>
                      <small>
                        {b.duplicate
                          ? 'Уже есть'
                          : b.conflict
                            ? 'Пересечение'
                            : 'Свободно'}
                      </small>
                    </div>
                  ))}
                </div>
                <Field label="Если время занято">
                  <NativeSelect
                    value={policy}
                    onChange={(e) => setPolicy(e.target.value)}
                  >
                    <option value="skip">Пропустить пересечения</option>
                    <option value="allow">
                      Добавить рядом с существующими событиями
                    </option>
                  </NativeSelect>
                </Field>
                <p className="footnote">
                  Неделя с {week}. Будет добавлено блоков: {selected.length}.
                  Точные дубликаты пропускаются.
                </p>
                <div className="modal-actions">
                  <button
                    type="button"
                    className="subtle"
                    disabled={busy}
                    onClick={async () => {
                      if (
                        window.confirm(
                          `Удалить шаблон «${template.name}»? События в календаре останутся.`,
                        ) &&
                        (await mutate(
                          { action: 'template.delete', id },
                          'Шаблон удалён',
                        ))
                      )
                        setId('');
                    }}
                  >
                    <Trash2 size={15} />
                    Удалить шаблон
                  </button>
                  <button
                    className="primary"
                    disabled={busy || !target || !selected.length}
                    onClick={async () => {
                      if (
                        await mutate(
                          {
                            action: 'template.apply',
                            id,
                            week_start: week,
                            conflicts: policy,
                          },
                          'Расписание из шаблона добавлено',
                        )
                      )
                        close();
                    }}
                  >
                    <Copy size={16} />
                    Применить шаблон
                  </button>
                </div>
              </>
            )}
          </>
        ) : (
          <p className="muted">
            Сначала заполните неделю событиями и сохраните её здесь.
          </p>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function SlotFinder({
  data,
  date,
  initialTask,
  close,
  onChoose,
}: {
  data: State;
  date: string;
  initialTask?: string;
  close: () => void;
  onChoose: (task: Task, start: Date, end: Date) => void;
}) {
  const [taskId, setTaskId] = useState(
      initialTask || data.tasks.find((t) => t.status === 'pending')?.id || '',
    ),
    [day, setDay] = useState(date),
    [startHour, setStartHour] = useState(9),
    [endHour, setEndHour] = useState(19),
    [now] = useState(() => new Date());
  const task = data.tasks.find((t) => t.id === taskId);
  const hours = useMemo(
    () => ({ start: startHour, end: endHour }),
    [startHour, endHour],
  );
  const valid = !!day && startHour >= 0 && endHour <= 24 && startHour < endHour;
  const slots = useMemo(
    () => (task && valid ? suggestSlots(data, task, day, hours, now) : []),
    [data, task, day, hours, valid, now],
  );
  const available = valid ? freeMinutes(data.events, day, hours) : 0,
    estimate = task ? learnedEstimate(data, task, now) : null;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DialogContent className="focal-dialog tools-dialog">
        <DialogTitle>Подобрать время</DialogTitle>
        <DialogDescription>
          Свободные окна с учётом длительности, дедлайна и ваших отметок
          энергии. Выберите вариант и проверьте его перед сохранением.
        </DialogDescription>
        <Field label="Задача">
          <NativeSelect
            value={taskId}
            onChange={(e) => setTaskId(e.target.value)}
          >
            <option value="">Выберите задачу</option>
            {data.tasks
              .filter((t) => t.status === 'pending')
              .map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title}
                </option>
              ))}
          </NativeSelect>
        </Field>
        <div className="form-triple">
          <Field label="День">
            <input
              type="date"
              value={day}
              onChange={(e) => setDay(e.target.value)}
            />
          </Field>
          <Field label="С часа">
            <input
              type="number"
              min={0}
              max={23}
              value={startHour}
              onChange={(e) => setStartHour(Number(e.target.value))}
            />
          </Field>
          <Field label="До часа">
            <input
              type="number"
              min={1}
              max={24}
              value={endHour}
              onChange={(e) => setEndHour(Number(e.target.value))}
            />
          </Field>
        </div>
        <div className="availability-summary">
          <span>
            Свободно в этом диапазоне <strong>{duration(available)}</strong>
          </span>
          {estimate && (
            <span>
              На задачу <strong>{duration(estimate.minutes)}</strong>
            </span>
          )}
        </div>
        {estimate && (
          <p className="footnote">
            {estimate.samples >= 3
              ? `Длительность уточнена по ${estimate.samples} завершённым задачам этого типа с замерами фокуса. Исходная оценка: ${task?.estimated_minutes || 30} мин.`
              : 'Для уточнения длительности нужны хотя бы три завершённые задачи этого типа с замерами фокуса.'}
          </p>
        )}
        <div className="slot-options">
          {slots.map((s) => (
            <button
              key={s.start.toISOString()}
              className="slot-option"
              onClick={() => onChoose(task!, s.start, s.end)}
            >
              <span className="slot-time">
                {when(s.start)}–{when(s.end)}
                <Sparkles size={17} />
              </span>
              <span>
                {s.energy === null
                  ? 'Свободное время · пока мало отметок энергии'
                  : `Средняя энергия ${s.energy.toFixed(1)}/10 · ${s.days} дней наблюдений за 28 дней`}
              </span>
              <small>
                {s.energy !== null && s.energy < (task?.required_energy || 0)
                  ? 'Энергия обычно ниже требуемой — учитывайте своё состояние.'
                  : 'Нет пересечений с расписанием'}
              </small>
            </button>
          ))}
        </div>
        {!slots.length && (
          <p className="muted">
            {!task
              ? 'Создайте или выберите задачу.'
              : !valid
                ? 'Укажите корректный диапазон часов.'
                : 'Подходящих окон нет. Выберите другой день или расширьте часы планирования.'}
          </p>
        )}
        {task && day && (
          <button
            className="secondary"
            onClick={() => {
              const from = atLocalTime(
                new Date(day + 'T00:00:00'),
                valid ? startHour : 9,
              );
              onChoose(
                task,
                from,
                new Date(
                  from.getTime() + (task.estimated_minutes || 30) * 60000,
                ),
              );
            }}
          >
            Указать время вручную
          </button>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function WeeklyReview({ data, now }: { data: State; now: Date }) {
  const [date, setDate] = useState(dayKey(weekStart(now)));
  const minute = Math.floor(now.getTime() / 60000);
  const review = useMemo(
    () => weeklyReview(data, date, new Date(minute * 60000)),
    [data, date, minute],
  );
  const planned = review.days.reduce((a, d) => a + d.planned, 0),
    actual = review.days.reduce((a, d) => a + d.focus, 0),
    max = Math.max(60, ...review.days.flatMap((d) => [d.planned, d.focus]));
  const underestimated = review.estimates.filter(
    (e) => e.actual > e.estimate * 1.2,
  );
  const insight = underestimated.length
    ? `${underestimated.length} задач заняли больше времени в фокусе, чем вы ожидали. Для похожих задач стоит увеличить оценку.`
    : review.overdue
      ? `${review.overdue} прошедших блоков ещё не отмечены. Проверьте итоги и оставьте в следующей неделе время для незавершённого.`
      : review.completed
        ? `За неделю завершено задач: ${review.completed}. Сравните нагрузку по дням, когда будете планировать следующую неделю.`
        : 'Здесь появятся ваши итоги, когда начнёте планировать задачи и работать с таймером.';
  return (
    <section className="panel weekly-review">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">ПЛАН И ФАКТ</p>
          <h3>
            Неделя с{' '}
            {new Date(date + 'T00:00:00').toLocaleDateString('ru-RU', {
              day: 'numeric',
              month: 'long',
            })}
          </h3>
        </div>
        <div className="review-nav">
          <button
            className="icon-button"
            aria-label="Предыдущая неделя обзора"
            onClick={() =>
              setDate(dayKey(addDays(new Date(date + 'T00:00:00'), -7)))
            }
          >
            <ChevronLeft size={18} />
          </button>
          <button
            className="secondary"
            onClick={() => setDate(dayKey(weekStart(now)))}
          >
            Текущая
          </button>
          <button
            className="icon-button"
            aria-label="Следующая неделя обзора"
            onClick={() =>
              setDate(dayKey(addDays(new Date(date + 'T00:00:00'), 7)))
            }
          >
            <ChevronRight size={18} />
          </button>
        </div>
      </div>
      <div className="review-metrics">
        <div>
          <small>В расписании</small>
          <strong>{duration(planned)}</strong>
        </div>
        <div>
          <small>Измерено в фокусе</small>
          <strong>{duration(actual)}</strong>
        </div>
        <div>
          <small>Завершено задач</small>
          <strong>{review.completed}</strong>
        </div>
        <div>
          <small>Выполнено блоков</small>
          <strong>
            {review.done} <span>/ {review.blocks}</span>
          </strong>
        </div>
      </div>
      <figure
        className="review-chart"
        aria-label={review.days
          .map(
            (d) =>
              `${d.date}: план ${Math.round(d.planned)} минут, фокус ${Math.round(d.focus)} минут`,
          )
          .join('; ')}
      >
        {review.days.map((d) => (
          <div key={d.date} className="review-day">
            <div className="review-bars">
              <span
                style={{ height: `${(d.planned / max) * 100}%` }}
                title={`План ${duration(d.planned)}`}
              />
              <span
                style={{ height: `${(d.focus / max) * 100}%` }}
                title={`Фокус ${duration(d.focus)}`}
              />
            </div>
            <strong>
              {new Date(d.date + 'T00:00:00').toLocaleDateString('ru-RU', {
                weekday: 'short',
              })}
            </strong>
            <small>
              {d.energy === null ? '—' : d.energy.toFixed(1) + '/10'}
            </small>
          </div>
        ))}
      </figure>
      <div className="review-legend">
        <span>
          <i className="dot violet" />
          План
        </span>
        <span>
          <i className="dot green" />
          Фокус
        </span>
        <span>Под днями — средняя энергия</span>
      </div>
      <p className="review-insight">{insight}</p>
      <p className="footnote">
        Фокус учитывает только время работы таймера, включая прерванные сессии.
        Встречи и работа без таймера сюда не входят. Завершение блока и задачи
        учитывается отдельно.
      </p>
      {review.estimates.length > 0 && (
        <details>
          <summary>Оценки завершённых задач</summary>
          <div className="estimate-list">
            {review.estimates.map((e) => (
              <div key={e.task.id}>
                <span>{e.task.title}</span>
                <span>
                  {duration(e.estimate)} → {duration(e.actual)}
                </span>
              </div>
            ))}
          </div>
        </details>
      )}
    </section>
  );
}
