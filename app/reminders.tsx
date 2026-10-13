'use client';
import { useEffect, useRef, useState } from 'react';
import { Bell, Check, Play, Clock3, X } from 'lucide-react';
import type { Mutate, State, Task } from '@/lib/domain';
import { reminderFor } from '@/lib/reminders';

export function NotificationToggle() {
  const [permission, setPermission] = useState('unknown');
  useEffect(() => {
    const timer = setTimeout(
      () =>
        setPermission(
          window.focalDesktop
            ? 'desktop'
            : 'Notification' in window
              ? Notification.permission
              : 'unsupported',
        ),
      0,
    );
    return () => clearTimeout(timer);
  }, []);
  return (
    <button
      className="subtle notifications-button"
      disabled={
        permission === 'unsupported' ||
        permission === 'granted' ||
        permission === 'desktop'
      }
      onClick={async () => {
        try {
          setPermission(await Notification.requestPermission());
        } catch {
          setPermission('unsupported');
        }
      }}
      title={
        permission === 'desktop'
          ? 'Напоминания работают, пока focal запущен в трее'
          : permission === 'denied'
            ? 'Разрешите уведомления для этого сайта в настройках браузера.'
            : 'Уведомления о начале событий, пока приложение открыто'
      }
    >
      <Bell size={15} />
      {permission === 'desktop'
        ? 'Напоминания в трее'
        : permission === 'granted'
          ? 'Напоминания включены'
          : permission === 'denied'
            ? 'Уведомления запрещены'
            : permission === 'unsupported'
              ? 'Уведомления недоступны'
              : 'Включить напоминания'}
    </button>
  );
}

export default function ScheduledNow({
  data,
  now,
  mutate,
  busy,
  onStart,
  onCalendar,
}: {
  data: State;
  now: Date;
  mutate: Mutate;
  busy: boolean;
  onStart: (task: Task) => void;
  onCalendar: () => void;
}) {
  const seen = useRef(new Set<string>()),
    reminders = data.events
      .map((e) => reminderFor(e, now))
      .filter((r): r is NonNullable<typeof r> => r !== null)
      .sort((a, b) => a.trigger - b.trigger);
  const hasFocus = data.sessions.some((s) =>
    ['preparation', 'work', 'break'].includes(s.phase),
  );
  useEffect(() => {
    if (
      !('Notification' in window) ||
      Notification.permission !== 'granted' ||
      hasFocus ||
      window.focalDesktop
    )
      return;
    for (const reminder of reminders) {
      const { event, key, trigger } = reminder;
      if (now.getTime() - trigger > 90000 || seen.current.has(key)) continue;
      seen.current.add(key);
      try {
        if (localStorage.getItem('focal-reminded:' + key)) continue;
        localStorage.setItem('focal-reminded:' + key, '1');
        void fetch('/api/reminder/claim', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: event.id, trigger }),
        })
          .then(async (r) => {
            const result = (await r.json()) as { claimed: boolean };
            if (!r.ok || !result.claimed) return;
            new Notification(
              reminder.upcoming
                ? `focal. · Через ${reminder.minutes} мин`
                : 'focal. · Время по плану',
              { body: event.title, tag: event.id },
            );
          })
          .catch(() => {
            seen.current.delete(key);
            localStorage.removeItem('focal-reminded:' + key);
          });
      } catch {
        /* In-app reminder below remains available. */
      }
    }
  }, [reminders, now, hasFocus]);
  if (!reminders.length || hasFocus) return null;
  const reminder = reminders[0],
    event = reminder.event,
    task = data.tasks.find((t) => t.id === event.task_id);
  return (
    <section className="scheduled-banner" aria-label="Сейчас по расписанию">
      <div>
        <small>
          {reminder.upcoming
            ? `Через ${reminder.minutes} мин`
            : 'Сейчас по расписанию'}{' '}
          ·{' '}
          {new Date(event.start_at).toLocaleTimeString('ru-RU', {
            hour: '2-digit',
            minute: '2-digit',
          })}
          –
          {new Date(event.end_at).toLocaleTimeString('ru-RU', {
            hour: '2-digit',
            minute: '2-digit',
          })}
        </small>
        <p>
          {event.title}
          {reminders.length > 1 && ` · ещё ${reminders.length - 1}`}
        </p>
      </div>
      <div className="scheduled-actions">
        {Date.parse(event.end_at) > now.getTime() + 5 * 60000 && (
          <button
            className="secondary"
            disabled={busy}
            onClick={() =>
              void mutate(
                { action: 'event.snooze', id: event.id, minutes: 5 },
                'Напомним через 5 минут',
              )
            }
          >
            <Clock3 size={15} />
            Отложить на 5 минут
          </button>
        )}
        {task?.status === 'pending' ? (
          <button
            className="primary"
            disabled={busy}
            onClick={() => onStart(task)}
          >
            <Play size={14} />
            Начать фокус
          </button>
        ) : (
          <button
            className="secondary"
            disabled={busy}
            onClick={() =>
              void mutate(
                { action: 'event.complete', id: event.id },
                'Событие выполнено',
              )
            }
          >
            <Check size={15} />
            Выполнено
          </button>
        )}
        <button className="subtle" onClick={onCalendar}>
          Календарь
        </button>
        <button
          className="icon-button"
          aria-label="Скрыть это напоминание"
          disabled={busy}
          onClick={() =>
            void mutate(
              { action: 'event.dismiss', id: event.id },
              'Напоминание скрыто',
            )
          }
        >
          <X size={16} />
        </button>
      </div>
    </section>
  );
}
