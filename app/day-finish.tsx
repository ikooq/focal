'use client';
import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { dayKey, type State, type Mutate } from '@/lib/domain';

export default function DayFinish({
  data,
  mutate,
  close,
}: {
  data: State;
  mutate: Mutate;
  close: () => void;
}) {
  const date = dayKey(new Date(data.server_now));
  const tasks = data.tasks.filter(
    (t) => t.planned_date === date && t.status === 'pending',
  );
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [first, setFirst] = useState('');
  const [summary, setSummary] = useState('');
  const [nextStep, setNextStep] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) close();
      }}
    >
      <DialogContent className="focal-dialog tools-dialog">
        <DialogTitle>Завершить день</DialogTitle>
        <DialogDescription>
          Сохраните итог и выберите, с чего начнёте завтра. Сроки и календарные
          встречи сохранятся.
        </DialogDescription>
        <p>
          Завершено сегодня:{' '}
          {
            data.tasks.filter(
              (t) =>
                t.completed_at && dayKey(new Date(t.completed_at)) === date,
            ).length
          }
        </p>
        <form
          className="stack-form"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError('');
            const result = await mutate(
              {
                action: 'day.finish',
                date,
                tasks: tasks.map((t) => ({
                  id: t.id,
                  choice: choices[t.id] || 'tomorrow',
                })),
                first_task_id: first || null,
                summary,
                next_step: nextStep,
              },
              'День завершён. План на завтра сохранён',
            );
            setBusy(false);
            if (result) close();
            else
              setError(
                'Не удалось завершить день. Проверьте сообщение приложения и обновите список.',
              );
          }}
        >
          {tasks.map((t) => (
            <label key={t.id} className="field">
              {t.title}
              <select
                aria-label={`Что сделать: ${t.title}`}
                value={choices[t.id] || 'tomorrow'}
                onChange={(e) =>
                  setChoices({ ...choices, [t.id]: e.target.value })
                }
              >
                <option value="tomorrow">Перенести на завтра</option>
                <option value="backlog">Вернуть в общий список</option>
                <option value="complete">Завершить</option>
              </select>
            </label>
          ))}
          <label className="field">
            Итог дня
            <textarea
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              maxLength={10000}
              placeholder="Что получилось?"
            />
          </label>
          <label className="field">
            Первое дело на завтра
            <select value={first} onChange={(e) => setFirst(e.target.value)}>
              <option value="">Выбрать позже</option>
              {data.tasks
                .filter(
                  (t) => t.status === 'pending' && choices[t.id] !== 'complete',
                )
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.title}
                  </option>
                ))}
            </select>
          </label>
          {first && (
            <label className="field">
              Первый конкретный шаг
              <textarea
                value={nextStep}
                onChange={(e) => setNextStep(e.target.value)}
                maxLength={10000}
                placeholder="Например, открыть черновик и написать первый абзац"
              />
            </label>
          )}
          {error && <p role="alert">{error}</p>}
          <button className="primary" disabled={busy}>
            Сохранить итог и план
          </button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
