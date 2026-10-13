'use client';
import { readyTask } from './task-hub';
import { useState } from 'react';
import {
  CalendarDays,
  Check,
  ChevronRight,
  Play,
  Plus,
  Star,
  X,
} from 'lucide-react';
import { NativeSelect } from '@/components/ui/native-select';
import { dayKey, type Mutate, type State, type Task } from '@/lib/domain';
import { addDays } from '@/lib/calendar';

export default function TodayPlan({
  data,
  date,
  mutate,
  busy,
  onStart,
  onSchedule,
  onAdd,
}: {
  data: State;
  date: string;
  mutate: Mutate;
  busy: boolean;
  onStart: (t: Task) => void;
  onSchedule: (id: string) => void;
  onAdd: () => void;
}) {
  const [pick, setPick] = useState('');
  const tasks = data.tasks.filter(
      (t) => t.planned_date === date && t.is_priority,
    ),
    total = tasks
      .filter((t) => t.status !== 'completed')
      .reduce((n, t) => n + (t.estimated_minutes || 30), 0),
    hasActive = data.sessions.some((s) =>
      ['preparation', 'work', 'break'].includes(s.phase),
    );
  return (
    <section className="today-plan">
      <div className="section-heading">
        <div>
          <p className="eyebrow">ПОСИЛЬНЫЙ ПЛАН НА ДЕНЬ</p>
          <h2>
            Три главных дела{' '}
            <span className="count">
              {tasks.filter((t) => t.status === 'completed').length}/
              {tasks.length}
            </span>
          </h2>
        </div>
        <span className="muted">
          {total
            ? `${total} мин запланировано`
            : 'Выберите то, что важно сегодня'}
        </span>
      </div>
      <div className="priority-grid">
        {tasks.map((task) => (
          <article
            className={`priority-card ${task.status === 'completed' ? 'done' : ''}`}
            key={task.id}
          >
            <div className="panel-heading">
              <span className="priority-label">
                <Star size={13} />
                {task.status === 'completed' ? 'Готово' : 'Главное на сегодня'}
              </span>
              <button
                className="icon-button"
                aria-label={`Убрать из главных дел: ${task.title}`}
                disabled={busy}
                onClick={() =>
                  void mutate(
                    {
                      action: 'task.plan',
                      id: task.id,
                      planned_date: date,
                      is_priority: false,
                    },
                    'Убрано из главных дел',
                  )
                }
              >
                <X size={14} />
              </button>
            </div>
            <h3>{task.title}</h3>
            <p className="muted">
              {task.estimated_minutes || 30} мин · энергия{' '}
              {task.required_energy}/10
            </p>
            <div className="priority-actions">
              {task.status === 'pending' ? (
                <>
                  <button
                    className="primary"
                    disabled={busy || hasActive}
                    onClick={() => onStart(task)}
                  >
                    <Play size={14} />
                    Начать
                  </button>
                  <button
                    className="icon-button"
                    aria-label={`Выбрать время: ${task.title}`}
                    onClick={() => onSchedule(task.id)}
                  >
                    <CalendarDays size={16} />
                  </button>
                  <button
                    className="subtle"
                    disabled={busy}
                    onClick={() =>
                      void mutate(
                        {
                          action: 'task.plan',
                          id: task.id,
                          planned_date: dayKey(
                            addDays(new Date(date + 'T12:00:00'), 1),
                          ),
                          is_priority: true,
                        },
                        'Перенесено на завтра',
                      )
                    }
                  >
                    Завтра
                    <ChevronRight size={13} />
                  </button>
                </>
              ) : task.status === 'active' ? (
                <span className="green-text">
                  <Play size={14} />В работе
                </span>
              ) : task.status === 'completed' ? (
                <span className="green-text">
                  <Check size={16} />
                  Выполнено
                </span>
              ) : (
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() =>
                    void mutate(
                      { action: 'task.reopen', id: task.id },
                      'Задача возвращена в работу. Старый дедлайн снят.',
                    )
                  }
                >
                  Вернуть в работу
                </button>
              )}
            </div>
          </article>
        ))}
        {tasks.length < 3 && (
          <div className="priority-add">
            <Star size={22} />
            <h3>
              {tasks.length
                ? 'Добавить главное дело'
                : 'Начните с одного важного дела'}
            </h3>
            {data.tasks.some(
              (t) => readyTask(t) && !tasks.some((p) => p.id === t.id),
            ) ? (
              <div className="priority-select">
                <NativeSelect
                  aria-label="Выберите главное дело"
                  value={pick}
                  onChange={(e) => setPick(e.target.value)}
                >
                  <option value="">Выберите задачу</option>
                  {data.tasks
                    .filter(
                      (t) =>
                        t.status === 'pending' &&
                        !tasks.some((p) => p.id === t.id),
                    )
                    .map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.title}
                      </option>
                    ))}
                </NativeSelect>
                <button
                  className="icon-button"
                  disabled={!pick || busy}
                  aria-label="Добавить в главные дела"
                  onClick={async () => {
                    if (
                      await mutate(
                        {
                          action: 'task.plan',
                          id: pick,
                          planned_date: date,
                          is_priority: true,
                        },
                        'Добавлено в план на сегодня',
                      )
                    )
                      setPick('');
                  }}
                >
                  <Plus size={17} />
                </button>
              </div>
            ) : (
              <button className="text-action" onClick={onAdd}>
                <Plus size={14} />
                Создать задачу
              </button>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
