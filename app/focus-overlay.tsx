'use client';
import { useEffect, useRef, useState } from 'react';
import { Focus, X, Check, Volume2, VolumeX } from 'lucide-react';
import { CheckpointForm, ThoughtParking } from './life-space';
import type { Session, State, Mutate } from '@/lib/domain';
const phases: Record<string, string> = {
  preparation: 'Подготовка',
  work: 'Глубокий фокус',
  break: 'Перерыв',
  completed: 'Цикл завершён',
  cancelled: 'Сессия прервана',
};
const audioLabels: Record<string, string> = {
  none: 'Тишина',
  binaural: 'Бинауральный тон',
  isochronic: 'Изохронный пульс',
  baroque: 'Барочная миниатюра',
};
export default function FocusOverlay({
  session,
  data,
  busy,
  mutate,
  onClose,
  onCancel,
  audioEnabled,
  toggleAudio,
  error,
  refresh,
}: {
  session: Session;
  data: State;
  busy: boolean;
  mutate: Mutate;
  onClose: () => void;
  onCancel: () => void;
  error: string;
  refresh: () => Promise<void>;
  audioEnabled: boolean;
  toggleAudio: () => Promise<void>;
}) {
  const [tick, setTick] = useState(() => Date.now());
  const focusExit = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    focusExit.current?.focus();
    const timer = setInterval(() => setTick(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const remaining = Math.max(
    0,
    Math.ceil(
      (Date.parse(session.phase_ends_at) -
        (session.paused_at ? Date.parse(session.paused_at) : tick)) /
        1000,
    ),
  );
  return (
    <section className="focus-overlay" aria-label="Режим фокуса">
      <div className="focus-top">
        <span className="brand">
          <Focus />
          focal<span className="brand-dot">.</span>
        </span>
        <button
          ref={focusExit}
          className="subtle"
          onClick={() => {
            onClose();
          }}
        >
          <X size={15} />
          {['completed', 'cancelled'].includes(session.phase)
            ? 'Закрыть'
            : 'Свернуть'}
        </button>
      </div>
      <div className="focus-center">
        <span className="eyebrow">
          <i className="dot green" />
          {session.paused_at ? 'На паузе' : phases[session.phase]}
        </span>
        <h2>{data?.tasks.find((t) => t.id === session.task_id)?.title}</h2>
        {!['completed', 'cancelled'].includes(session.phase) ? (
          <>
            <div
              className="countdown"
              role="timer"
              aria-label={`${Math.floor(remaining / 60)} минут ${remaining % 60} секунд`}
            >
              {String(Math.floor(remaining / 60)).padStart(2, '0')}
              <span>:</span>
              {String(remaining % 60).padStart(2, '0')}
            </div>
            <p className="muted">
              {session.phase === 'preparation'
                ? 'Дайте вниманию переключиться. Работа начнётся автоматически.'
                : session.phase === 'work'
                  ? 'Сейчас — одна задача. Всё остальное подождёт.'
                  : 'Пора немного отдохнуть. Работа на этот цикл закончена.'}
            </p>
            <div className="focus-steps">
              {['preparation', 'work', 'break'].map((p, i) => (
                <span key={p} className={session.phase === p ? 'current' : ''}>
                  {['Подготовка', 'Работа', 'Отдых'][i]}
                  <b>
                    {
                      [
                        session.dopamine_debt_duration,
                        session.work_duration,
                        session.break_duration,
                      ][i]
                    }{' '}
                    мин
                  </b>
                </span>
              ))}
            </div>
            <div className="focus-bottom-controls">
              <button
                className="secondary"
                disabled={busy}
                onClick={() =>
                  void mutate(
                    {
                      action: session.paused_at
                        ? 'session.resume'
                        : 'session.pause',
                      id: session.id,
                    },
                    session.paused_at ? 'Фокус продолжен' : 'Таймер на паузе',
                  )
                }
              >
                {session.paused_at ? 'Продолжить фокус' : 'Пауза без штрафа'}
              </button>
              {session.audio_type !== 'none' && (
                <button className="subtle" onClick={() => void toggleAudio()}>
                  {audioEnabled ? <Volume2 size={16} /> : <VolumeX size={16} />}{' '}
                  {audioLabels[session.audio_type]}
                  {session.phase !== 'work' ? ' · во время работы' : ''}
                </button>
              )}
              <button className="subtle" onClick={() => onCancel()}>
                {session.phase === 'break'
                  ? 'Закончить отдых'
                  : 'Прервать сессию'}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="finished-icon">
              <Check size={52} />
            </div>
            <p className="muted">
              {session.phase === 'completed'
                ? 'Цикл завершён. Задачу можно закрыть или продолжить позже.'
                : 'Сессия сохранена в истории.'}
            </p>
            <div className="completion-actions">
              {session.phase === 'completed' &&
                data?.tasks.find((t) => t.id === session.task_id)?.status ===
                  'pending' && (
                  <button
                    className="primary"
                    disabled={busy}
                    onClick={async () => {
                      const result = await mutate(
                        { action: 'task.complete', id: session.task_id },
                        'Задача завершена',
                      );
                      if (result) onClose();
                    }}
                  >
                    <Check size={17} />
                    Завершить задачу
                  </button>
                )}
              <button
                className="secondary"
                onClick={() => {
                  onClose();
                }}
              >
                В пространство
              </button>
            </div>
          </>
        )}
      </div>
      <div className="focus-caption">PERIPHERAL BLACKOUT</div>
      {['preparation', 'work'].includes(session.phase) ? (
        <ThoughtParking
          taskId={session.task_id}
          sessionId={session.id}
          mutate={mutate}
        />
      ) : (
        <CheckpointForm
          taskId={session.task_id}
          sessionId={session.id}
          mutate={mutate}
        />
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
          <button className="subtle" onClick={() => void refresh()}>
            Повторить
          </button>
        </p>
      )}
    </section>
  );
}
