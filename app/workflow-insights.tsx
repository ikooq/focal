'use client';
import { useState } from 'react';
import { ArrowRight, Play, Clock3 } from 'lucide-react';
import { type State, type Task, type Mutate, dayKey } from '@/lib/domain';
import { atLocalTime, addDays } from '@/lib/calendar';
import { focusInRange, learnedEstimate } from '@/lib/planning';
import { readyTask } from './task-hub';
const time = (n: number) =>
  n >= 60
    ? `${Math.floor(n / 60)} ч ${n % 60 ? `${Math.round(n % 60)} мин` : ''}`
    : `${Math.round(n)} мин`;
export function DayCapacity({
  data,
  mutate,
  busy,
}: {
  data: State;
  mutate: Mutate;
  busy: boolean;
}) {
  const [review, setReview] = useState(false);
  const now = new Date(data.server_now),
    today = dayKey(now),
    start = Math.max(
      now.getTime(),
      atLocalTime(now, data.settings?.day_start ?? 9).getTime(),
    ),
    end = atLocalTime(now, data.settings?.day_end ?? 19).getTime();
  const tasks = data.tasks.filter(
    (t) =>
      t.planned_date === today &&
      readyTask(t) &&
      !data.tasks.some(
        (c) => c.parent_task_id === t.id && c.status !== 'completed',
      ),
  );
  const taskIds = new Set(tasks.map((t) => t.id));
  const merged: number[][] = [];
  for (const block of data.events
    .filter((e) => !e.completed_at && !taskIds.has(e.task_id || ''))
    .map((e) => [
      Math.max(start, Date.parse(e.start_at)),
      Math.min(end, Date.parse(e.end_at)),
    ])
    .filter(([a, b]) => a < b)
    .sort((a, b) => a[0] - b[0])) {
    const prev = merged.at(-1);
    if (prev && prev[1] >= block[0]) prev[1] = Math.max(prev[1], block[1]);
    else merged.push(block);
  }
  const meetings = merged.reduce((n, [a, b]) => n + (b - a) / 60000, 0),
    worked = focusInRange(data.sessions, atLocalTime(now, 0), now, now);
  const available = Math.max(
    0,
    Math.min(
      Math.max(0, (end - start) / 60000) - meetings,
      (data.settings?.daily_limit ?? 360) - worked - meetings,
    ),
  );
  const remaining = (t: Task) =>
    Math.max(
      0,
      (t.estimated_minutes || 30) -
        focusInRange(
          data.sessions.filter((s) => s.task_id === t.id),
          new Date(0),
          now,
          now,
        ),
    );
  const planned = tasks.reduce((n, t) => n + remaining(t), 0),
    overflow = Math.max(0, planned - available);
  const reduction = { minutes: 0 };
  const move = tasks
    .toSorted(
      (a, b) =>
        (a.is_priority || 0) - (b.is_priority || 0) ||
        (b.planned_date || '').localeCompare(a.planned_date || ''),
    )
    .filter((t) => {
      if (
        reduction.minutes >= overflow ||
        data.events.some(
          (e) =>
            e.task_id === t.id &&
            !e.completed_at &&
            Date.parse(e.end_at) > now.getTime(),
        )
      )
        return false;
      reduction.minutes += remaining(t);
      return true;
    });
  return (
    <section className={`capacity-card ${overflow ? 'overloaded' : ''}`}>
      <div className="capacity-heading">
        <div>
          <span className="eyebrow">ЗАГРУЗКА ДО КОНЦА ДНЯ</span>
          <h3>
            Доступно {time(available)} <span>· в плане {time(planned)}</span>
          </h3>
        </div>
        <Clock3 size={21} />
      </div>
      <div className="capacity-track">
        <span
          style={{
            width: `${Math.min(100, (planned / Math.max(1, available)) * 100)}%`,
          }}
        />
      </div>
      <p className="muted">
        {overflow
          ? `План превышает доступное время на ${time(overflow)}.`
          : 'Встречи, уже отработанное время и ваш дневной лимит учтены.'}
      </p>
      {overflow > 0 && move.length > 0 && (
        <button className="text-action" onClick={() => setReview(!review)}>
          Облегчить день · перенести {move.length} <ArrowRight size={14} />
        </button>
      )}
      {review && overflow > 0 && (
        <div className="capacity-review">
          <p>На завтра:</p>
          <ul>
            {move.map((t) => (
              <li key={t.id}>
                {t.title} · {time(remaining(t))}
              </li>
            ))}
          </ul>
          <p className="muted">
            Задачи с будущими блоками в календаре остаются на месте.
          </p>
          <button
            className="secondary"
            disabled={busy}
            onClick={async () => {
              if (
                await mutate(
                  {
                    action: 'task.bulk',
                    ids: move.map((t) => t.id),
                    operation: 'plan',
                    date: dayKey(addDays(now, 1)),
                  },
                  'План облегчен',
                )
              )
                setReview(false);
            }}
          >
            Перенести выбранные
          </button>
        </div>
      )}
    </section>
  );
}
export function ResumeWork({
  data,
  onStart,
  onOpen,
  disabled,
}: {
  data: State;
  onStart: (t: Task) => void;
  onOpen: (t: Task) => void;
  disabled: boolean;
}) {
  const checkpoint = data.checkpoints?.find((c) =>
    data.tasks.some(
      (t) =>
        t.id === c.task_id &&
        readyTask(t) &&
        (!t.planned_date ||
          t.planned_date <= dayKey(new Date(data.server_now))),
    ),
  );
  const task = data.tasks.find((t) => t.id === checkpoint?.task_id);
  if (!task || !checkpoint) return null;
  const materials =
    data.resources?.filter((r) => r.task_id === task.id).slice(0, 3) || [];
  const minutes = focusInRange(
    data.sessions.filter((s) => s.task_id === task.id),
    new Date(0),
    new Date(data.server_now),
    new Date(data.server_now),
  );
  return (
    <section className="resume-work">
      <div>
        <span className="eyebrow">ПРОДОЛЖИТЬ С МЕСТА ОСТАНОВКИ</span>
        <h3>{task.title}</h3>
        <p>{checkpoint.next_step || checkpoint.summary}</p>
        <span className="work-meta">
          Уже вложено {time(minutes)}
          {materials.length
            ? ` · ${materials.map((m) => m.title).join(' · ')}`
            : ''}
        </span>
      </div>
      <div className="resume-actions">
        <button
          className="primary"
          disabled={disabled}
          onClick={() => onStart(task)}
        >
          <Play size={15} />
          Продолжить
        </button>
        <button className="text-action" onClick={() => onOpen(task)}>
          Открыть материалы
        </button>
      </div>
    </section>
  );
}
export function EstimateInsights({
  data,
  mutate,
  busy,
}: {
  data: State;
  mutate: Mutate;
  busy: boolean;
}) {
  const now = new Date(data.server_now);
  const candidates = data.tasks
    .filter((t) => readyTask(t) && !t.estimate_applied_at)
    .map((t) => ({ task: t, estimate: learnedEstimate(data, t, now) }))
    .filter(
      ({ estimate }) =>
        estimate.samples >= 3 && Math.abs(estimate.ratio - 1) >= 0.15,
    )
    .slice(0, 5);
  if (!candidates.length) return null;
  return (
    <section className="panel estimate-insights">
      <h2>Точнее оценивать время</h2>
      {candidates.map(({ task, estimate }) => (
        <div className="insight-row" key={task.id}>
          <div>
            <strong>{task.title}</strong>
            <p className="muted">
              По {estimate.samples} завершённым задачам этого типа: обычно{' '}
              {estimate.ratio > 1 ? 'дольше' : 'быстрее'} на{' '}
              {Math.round(Math.abs(estimate.ratio - 1) * 100)}%. Оценка{' '}
              {task.estimated_minutes || 30} → {estimate.minutes} мин.
            </p>
          </div>
          <button
            className="secondary"
            disabled={busy}
            onClick={() =>
              void mutate(
                {
                  action: 'task.estimate',
                  id: task.id,
                  minutes: estimate.minutes,
                },
                'Оценка обновлена',
              )
            }
          >
            Применить оценку
          </button>
        </div>
      ))}
    </section>
  );
}
