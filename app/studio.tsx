'use client';
import { useEffect, useState, type SubmitEvent } from 'react';
import {
  Sparkles,
  ArrowRight,
  CalendarDays,
  SlidersHorizontal,
  History,
  ScanText,
  Download,
  ShieldCheck,
} from 'lucide-react';
import {
  dayKey,
  type State,
  type Mutate,
  type Task,
  type Note,
} from '@/lib/domain';
import { addDays } from '@/lib/calendar';
import { Field } from './sections';
import { VoiceInput, ImageInput, postJSON } from './capture-controls';
import TimeMachine from './time-machine';
import ForecastPanel from './forecast-panel';
type Candidate = {
  title: string;
  date: string;
  time: string;
  duration: number;
  kind: string;
  warning?: string;
};
type Preview = {
  token: string;
  summary: string;
  operations: Record<string, unknown>[];
  blocks: { title: string; start_at: string; end_at: string }[];
  removed: { id: string; title: string; start_at: string; end_at: string }[];
  warnings: string[];
};
type AIResult = {
  summary: string;
  provider: string;
  items: Candidate[];
  day_end?: number | null;
  daily_limit?: number | null;
};
type Desktop = {
  closeCapture?: () => Promise<void>;
  openCapture?: () => Promise<void>;
  chooseBackupFolder?: () => Promise<string | null>;
  settings: () => Promise<{ openAtLogin: boolean; captureShortcut?: boolean }>;
  setLogin: (enabled: boolean) => Promise<{ openAtLogin: boolean }>;
};
declare global {
  interface Window {
    focalDesktop?: Desktop;
  }
}

function PreviewCard({
  preview,
  mutate,
  onDone,
}: {
  preview: Preview;
  mutate: Mutate;
  onDone: () => void;
}) {
  const [busy, setBusy] = useState(false),
    [ack, setAck] = useState(false);
  return (
    <section className="panel plan-preview">
      <span className="eyebrow">ПРЕДПРОСМОТР · ДАННЫЕ ЕЩЁ НЕ ИЗМЕНЕНЫ</span>
      <h3>{preview.summary}</h3>
      <div className="before-after">
        <div>
          <h4>Было · заменяемые блоки</h4>
          {preview.removed.length ? (
            preview.removed.map((b) => (
              <p key={b.id}>
                <time>
                  {new Date(b.start_at).toLocaleString('ru-RU', {
                    day: 'numeric',
                    month: 'short',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </time>{' '}
                {b.title}
              </p>
            ))
          ) : (
            <p className="muted">Текущие блоки сохраняются.</p>
          )}
        </div>
        <div>
          <h4>Станет · новые блоки</h4>
          {preview.blocks.map((b, i) => (
            <p key={i}>
              <time>
                {new Date(b.start_at).toLocaleString('ru-RU', {
                  day: 'numeric',
                  month: 'short',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
                –
                {new Date(b.end_at).toLocaleTimeString('ru-RU', {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </time>{' '}
              {b.title}
            </p>
          ))}
          {preview.operations
            .filter((o) => o.action === 'quick.task')
            .map((o, i) => (
              <p key={i}>
                Задача · {String(o.title)} · {String(o.date)}
              </p>
            ))}
          {!preview.blocks.length &&
            !preview.operations.some((o) => o.action === 'quick.task') && (
              <p className="muted">
                {preview.operations.some(
                  (o) => o.action === 'transaction.reschedule',
                )
                  ? 'Будет перенесена дата планового расхода.'
                  : 'Новых блоков нет.'}
              </p>
            )}
        </div>
      </div>
      {preview.warnings.length > 0 && (
        <div className="plan-warnings">
          <strong>Обратите внимание</strong>
          <ul>
            {preview.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
          <label className="check-label">
            <input
              type="checkbox"
              checked={ack}
              onChange={(e) => setAck(e.target.checked)}
            />
            Я проверил ограничения и пересечения
          </label>
        </div>
      )}
      <div className="inline-fields">
        <button
          className="primary"
          disabled={
            busy ||
            !preview.operations.length ||
            (preview.warnings.length > 0 && !ack)
          }
          onClick={async () => {
            setBusy(true);
            if (
              await mutate(
                { action: 'plan.apply', token: preview.token },
                'План применён',
              )
            )
              onDone();
            setBusy(false);
          }}
        >
          <CheckIcon />
          Применить {preview.operations.length} изменений
        </button>
        <button className="subtle" onClick={onDone} disabled={busy}>
          Отменить предложение
        </button>
      </div>
      <p className="muted">
        Предложение действует 15 минут. Изменения расписания можно отменить
        кнопкой в календаре; созданные задачи сохранятся.
      </p>
    </section>
  );
}
const CheckIcon = () => <ShieldCheck size={16} />;
export default function Studio({
  data,
  mutate,
  onTask,
  onNote,
  onCalendar,
  mode,
}: {
  mode?: 'settings';
  data: State;
  mutate: Mutate;
  onTask: (task: Task) => void;
  onNote: (note: Note) => void;
  onCalendar: (date: string) => void;
}) {
  const today = dayKey(new Date(data.server_now));
  const [view, setView] = useState(mode || 'director'),
    [date, setDate] = useState(today),
    [source, setSource] = useState(''),
    [items, setItems] = useState<Candidate[]>([]),
    [ai, setAI] = useState<AIResult | null>(null),
    [preview, setPreview] = useState<Preview | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [dayEnd, setDayEnd] = useState(data.settings?.day_end || 19),
    [limit, setLimit] = useState(data.settings?.daily_limit || 360),
    [status, setStatus] = useState<{
      ai: boolean;
      model: string;
      ocr: boolean;
      voice: boolean;
    } | null>(null),
    [freeDay, setFreeDay] = useState(5),
    [practice, setPractice] = useState(30),
    [purchase, setPurchase] = useState(''),
    [purchaseDate, setPurchaseDate] = useState(
      dayKey(addDays(new Date(data.server_now), 14)),
    ),
    [login, setLogin] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    const update = () =>
      void fetch('/api/assistant/status')
        .then((r) => r.json())
        .then((v) => {
          if (live) setStatus(v as NonNullable<typeof status>);
        })
        .catch(() => {});
    update();
    const timer = setInterval(update, 30000);
    if (window.focalDesktop)
      void window.focalDesktop.settings().then((v) => {
        if (live) setLogin(v.openAtLogin);
      });
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, []);
  async function request<T>(
    path: string,
    body: unknown,
    receive: (v: T) => void,
  ) {
    setBusy(true);
    setError('');
    try {
      receive(await postJSON<T>(path, body));
    } catch (e) {
      setError(
        e instanceof Error ? e.message : 'Не удалось обработать запрос.',
      );
    } finally {
      setBusy(false);
    }
  }
  const addText = (text: string) => {
    setSource((s) => (s ? `${s}\n${text}` : text));
    setItems([]);
    setAI(null);
    setPreview(null);
  };
  const build = (body: unknown) =>
    void request('/api/preview', body, setPreview);
  async function settings(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.currentTarget));
    setBusy(true);
    await mutate(
      {
        action: 'settings.save',
        ...f,
        day_start: Number(f.day_start),
        day_end: Number(f.day_end),
        daily_limit: Number(f.daily_limit),
        buffer_minutes: Number(f.buffer_minutes),
        session_minutes: Number(f.session_minutes),
      },
      'Настройки сохранены',
    );
    setBusy(false);
  }
  return (
    <div className="studio">
      <header className="section-heading">
        <div>
          <span className="eyebrow">
            {mode ? 'ВАШИ НАСТРОЙКИ' : 'ПОМОЩНИК ПЛАНИРОВАНИЯ'}
          </span>
          <h2>
            {mode ? 'Ритм и поведение приложения' : 'План на ваших условиях'}
          </h2>
          <p className="muted" hidden={!!mode}>
            Предлагайте сценарий, проверяйте результат, выбирайте следующий шаг.
          </p>
        </div>
        <span className="local-model" hidden={!!mode}>
          <i className={`dot ${status?.ai ? 'green' : ''}`} />
          {status?.ai
            ? 'Помощник готов'
            : status
              ? 'Помощник недоступен · проверьте настройки'
              : 'Проверяем локальный ИИ…'}
        </span>
      </header>
      <div className="studio-tabs" hidden={!!mode}>
        {[
          { id: 'director', label: 'Режиссёр дня', icon: Sparkles },
          { id: 'whatif', label: 'Что, если…', icon: SlidersHorizontal },
          { id: 'capture', label: 'Из хаоса в план', icon: ScanText },
          { id: 'history', label: 'Машина времени', icon: History },
        ].map((v) => (
          <button
            key={v.id}
            className={view === v.id ? 'selected' : ''}
            onClick={() => {
              setView(v.id);
              setPreview(null);
              setError('');
            }}
          >
            <v.icon size={16} />
            {v.label}
          </button>
        ))}
      </div>
      {view === 'history' && (
        <TimeMachine
          data={data}
          onTask={onTask}
          onNote={onNote}
          onCalendar={onCalendar}
        />
      )}
      {(view === 'director' || view === 'capture') && (
        <section className="panel capture-panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">
                {view === 'director'
                  ? 'ПЛАН, КОТОРЫЙ МОЖНО ИЗМЕНИТЬ'
                  : 'ТЕКСТ · ГОЛОС · ФОТО'}
              </span>
              <h3>
                {view === 'director'
                  ? 'Как вы хотите провести день?'
                  : 'Выгрузите всё из головы'}
              </h3>
            </div>
            <Field label="Опорная дата">
              <input
                type="date"
                value={date}
                onChange={(e) => {
                  setDate(e.target.value);
                  setPreview(null);
                }}
              />
            </Field>
          </div>
          <textarea
            className="command-text"
            aria-label="Запрос помощнику"
            value={source}
            maxLength={20000}
            placeholder={
              view === 'director'
                ? 'День пошёл не по плану. Хочу закончить к 18:00 и работать не больше четырёх часов.'
                : 'Тренировка завтра в 19:00 на час\nПодготовить презентацию на 45 минут\nВстреча 2026-09-15 в 14:30 на 30 минут'
            }
            onChange={(e) => {
              setSource(e.target.value);
              setAI(null);
              setItems([]);
              setPreview(null);
            }}
          />
          <div className="capture-actions">
            <VoiceInput onText={addText} />
            {view === 'capture' && <ImageInput onText={addText} />}
            <button
              className="secondary"
              disabled={busy || !source.trim()}
              onClick={() =>
                void request(
                  '/api/assistant',
                  { source, date, mode: 'quick' },
                  (v: AIResult) => {
                    setItems(v.items);
                    setAI(v);
                    setPreview(null);
                  },
                )
              }
            >
              Быстрый разбор
            </button>
            <button
              className="primary"
              disabled={busy || !source.trim() || !status?.ai}
              onClick={() =>
                void request(
                  '/api/assistant',
                  {
                    source,
                    date,
                    mode: view === 'director' ? 'director' : 'capture',
                  },
                  (v: AIResult) => {
                    setAI(v);
                    setItems(v.items);
                    if (v.day_end) setDayEnd(v.day_end);
                    if (v.daily_limit) setLimit(v.daily_limit);
                    setPreview(null);
                  },
                )
              }
            >
              <Sparkles size={16} />
              {busy ? 'Обрабатываю…' : 'Предложение ИИ'}
            </button>
          </div>
          <p className="muted">
            Текст, фото и звук обрабатываются на вашем компьютере. ИИ может
            ошибаться — сначала проверьте записи.
          </p>
          {ai && (
            <blockquote className="assistant-response">
              <small>{ai.provider}</small>
              <p>{ai.summary}</p>
            </blockquote>
          )}
          {items.length > 0 && (
            <div className="candidate-list" onChange={() => setPreview(null)}>
              <h3>Проверьте распознанное</h3>
              {items.map((item, i) => (
                <div className="candidate-row" key={i}>
                  <input
                    aria-label={`Название записи ${i + 1}`}
                    value={item.title}
                    maxLength={160}
                    onChange={(e) =>
                      setItems(
                        items.map((v, k) =>
                          k === i ? { ...v, title: e.target.value } : v,
                        ),
                      )
                    }
                  />
                  <select
                    aria-label={`Тип записи ${i + 1}`}
                    value={item.kind}
                    onChange={(e) =>
                      setItems(
                        items.map((v, k) =>
                          k === i ? { ...v, kind: e.target.value } : v,
                        ),
                      )
                    }
                  >
                    <option value="task">Задача</option>
                    <option value="event">Событие</option>
                  </select>
                  <input
                    aria-label={`Дата записи ${i + 1}`}
                    type="date"
                    value={item.date}
                    onChange={(e) =>
                      setItems(
                        items.map((v, k) =>
                          k === i ? { ...v, date: e.target.value } : v,
                        ),
                      )
                    }
                  />
                  <input
                    aria-label={`Время записи ${i + 1}`}
                    type="time"
                    value={item.time}
                    disabled={item.kind === 'task'}
                    onChange={(e) =>
                      setItems(
                        items.map((v, k) =>
                          k === i ? { ...v, time: e.target.value } : v,
                        ),
                      )
                    }
                  />
                  <input
                    aria-label={`Длительность записи ${i + 1}, минуты`}
                    type="number"
                    min="5"
                    max="1440"
                    value={item.duration}
                    onChange={(e) =>
                      setItems(
                        items.map((v, k) =>
                          k === i
                            ? { ...v, duration: Number(e.target.value) }
                            : v,
                        ),
                      )
                    }
                  />
                  <button
                    className="subtle"
                    aria-label={`Убрать запись ${i + 1}`}
                    onClick={() => setItems(items.filter((_, k) => k !== i))}
                  >
                    ×
                  </button>
                  <small className="muted">{item.warning}</small>
                </div>
              ))}
              <button
                className="secondary"
                disabled={busy}
                onClick={() => build({ kind: 'capture', items })}
              >
                Предпросмотр новых записей <ArrowRight size={15} />
              </button>
            </div>
          )}
          {view === 'director' && (
            <>
              <div className="inline-fields">
                <Field label="Закончить до">
                  <input
                    type="number"
                    min={(data.settings?.day_start || 9) + 1}
                    max="24"
                    value={dayEnd}
                    onChange={(e) => {
                      setDayEnd(Number(e.target.value));
                      setPreview(null);
                    }}
                  />
                </Field>
                <Field label="Лимит занятости, мин.">
                  <input
                    type="number"
                    min="15"
                    max="720"
                    value={limit}
                    onChange={(e) => {
                      setLimit(Number(e.target.value));
                      setPreview(null);
                    }}
                  />
                </Field>
                <button
                  className="primary"
                  disabled={busy}
                  onClick={() =>
                    build({
                      kind: 'schedule',
                      date,
                      day_end: dayEnd,
                      daily_limit: limit,
                      replan: true,
                    })
                  }
                >
                  Пересобрать день
                </button>
              </div>
              <p className="muted">
                Незавершённые задачи по приоритету и сроку. Закреплённые встречи
                остаются на месте; буфер между блоками —{' '}
                {data.settings?.buffer_minutes ?? 10} мин.
              </p>
              <details>
                <summary>Какие блоки можно двигать</summary>
                {data.events
                  .filter(
                    (e) =>
                      dayKey(new Date(e.start_at)) === date && !e.completed_at,
                  )
                  .map((e) => (
                    <label className="lock-row" key={e.id}>
                      <input
                        type="checkbox"
                        checked={!!e.is_fixed}
                        onChange={(v) => {
                          setPreview(null);
                          void mutate({
                            action: 'event.lock',
                            id: e.id,
                            is_fixed: v.target.checked,
                          });
                        }}
                      />
                      <span>
                        {new Date(e.start_at).toLocaleTimeString('ru-RU', {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}{' '}
                        · {e.title}
                      </span>
                      <small>
                        {e.is_fixed
                          ? 'Закреплено'
                          : e.task_id
                            ? 'Можно перенести'
                            : 'Без связанной задачи — сохраняется'}
                      </small>
                    </label>
                  ))}
              </details>
            </>
          )}
        </section>
      )}
      {view === 'capture' && (
        <section className="panel">
          <h3>
            <CalendarDays size={18} /> Перенести календарь
          </h3>
          <p className="muted">
            Импорт ICS за выбранный период, до 500 событий. Повторы
            разворачиваются в отдельные записи; повторный импорт с теми же UID
            не создаёт дубликаты.
          </p>
          <div className="inline-fields">
            <Field label="Начало периода">
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </Field>
            <label className="secondary file-button">
              Выбрать .ics
              <input
                type="file"
                accept=".ics,text/calendar"
                disabled={busy}
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  e.target.value = '';
                  if (!f) return;
                  if (f.size > 2000000) {
                    setError('Файл должен быть до 2 МБ.');
                    return;
                  }
                  build({
                    kind: 'ics',
                    source: await f.text(),
                    from: date,
                    until: dayKey(addDays(new Date(date + 'T12:00:00'), 90)),
                  });
                }}
              />
            </label>
            <a className="subtle" href="/api/calendar.ics" download>
              <Download size={16} />
              Экспорт календаря
            </a>
          </div>
          <p className="muted">
            Будут показаны события на 90 дней от выбранной даты.
          </p>
        </section>
      )}
      {view === 'whatif' && (
        <>
          <section className="panel">
            <span className="eyebrow">СИМУЛЯЦИЯ БЕЗ ИЗМЕНЕНИЯ ДАННЫХ</span>
            <h3>А если освободить день?</h3>
            <div className="inline-fields">
              <Field label="Неделя начиная с">
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                />
              </Field>
              <Field label="Оставить свободным">
                <select
                  value={freeDay}
                  onChange={(e) => setFreeDay(Number(e.target.value))}
                >
                  {[
                    'Воскресенье',
                    'Понедельник',
                    'Вторник',
                    'Среда',
                    'Четверг',
                    'Пятница',
                    'Суббота',
                  ].map((d, i) => (
                    <option key={d} value={i}>
                      {d}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Практика ежедневно, мин.">
                <input
                  type="number"
                  min="0"
                  max="180"
                  value={practice}
                  onChange={(e) => setPractice(Number(e.target.value))}
                />
              </Field>
              <button
                className="primary"
                disabled={busy}
                onClick={() =>
                  build({
                    kind: 'week',
                    date,
                    free_day: freeDay,
                    practice_minutes: practice,
                  })
                }
              >
                Рассчитать сценарий
              </button>
            </div>
            <p className="muted">
              План на 7 дней с текущим дневным лимитом. Фиксированные встречи
              сохраняются, свободный день исключается из размещения задач и
              практики.
            </p>
          </section>
          <section className="panel">
            <h3>А если отложить покупку?</h3>
            <div className="inline-fields">
              <Field label="Плановый расход">
                <select
                  value={purchase}
                  onChange={(e) => setPurchase(e.target.value)}
                >
                  <option value="">Выберите расход</option>
                  {data.transactions
                    .filter((t) => t.type === 'expense' && !t.actual_date)
                    .map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.category}
                      </option>
                    ))}
                </select>
              </Field>
              <Field label="Новая дата">
                <input
                  type="date"
                  value={purchaseDate}
                  onChange={(e) => setPurchaseDate(e.target.value)}
                />
              </Field>
              <button
                className="secondary"
                disabled={!purchase || busy}
                onClick={() =>
                  build({ kind: 'purchase', id: purchase, date: purchaseDate })
                }
              >
                Предпросмотр переноса
              </button>
            </div>
          </section>
          <ForecastPanel
            data={data}
            mutate={mutate}
            postpone={
              purchase ? { id: purchase, date: purchaseDate } : undefined
            }
          />
        </>
      )}
      {view === 'settings' && (
        <section className="panel">
          <h3>Ваш ритм</h3>
          <form className="stack-form" onSubmit={(e) => void settings(e)}>
            <div className="inline-fields">
              {[
                {
                  name: 'day_start',
                  label: 'Начало дня, час',
                  min: 0,
                  max: 23,
                  value: 9,
                },
                {
                  name: 'day_end',
                  label: 'Конец дня, час',
                  min: 1,
                  max: 24,
                  value: 19,
                },
                {
                  name: 'daily_limit',
                  label: 'Лимит занятости, мин.',
                  min: 15,
                  max: 720,
                  value: 360,
                },
                {
                  name: 'buffer_minutes',
                  label: 'Пауза между блоками, мин.',
                  min: 0,
                  max: 60,
                  value: 10,
                },
                {
                  name: 'session_minutes',
                  label: 'Блок фокуса, мин.',
                  min: 5,
                  max: 120,
                  value: 50,
                },
              ].map((f) => (
                <Field key={f.name} label={f.label}>
                  <input
                    name={f.name}
                    type="number"
                    min={f.min}
                    max={f.max}
                    defaultValue={Number(
                      data.settings?.[
                        f.name as keyof NonNullable<State['settings']>
                      ] ?? f.value,
                    )}
                    required
                  />
                </Field>
              ))}
            </div>
            <Field label="Анимации">
              <select
                name="motion"
                defaultValue={data.settings?.motion || 'gentle'}
              >
                <option value="gentle">Спокойные</option>
                <option value="full">Полные · 3D и плавные переходы</option>
                <option value="off">Выключены</option>
              </select>
            </Field>
            <button className="primary" disabled={busy}>
              Сохранить настройки
            </button>
          </form>
          <div className="settings-runtime">
            <h3>Локальная обработка</h3>
            <p>
              ИИ: {status?.ai ? 'готов' : 'ожидает модель Ollama'}. Фото:{' '}
              {status?.ocr
                ? 'готово'
                : status
                  ? 'модель не установлена'
                  : 'проверяем'}
              . Голос:{' '}
              {status?.voice
                ? 'готов'
                : status
                  ? 'модель или среда не установлена'
                  : 'проверяем'}
              .
            </p>
            <p className="muted">
              Системная настройка уменьшения движения имеет приоритет. Во время
              фокуса анимации останавливаются.
            </p>
            {login !== null ? (
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={login}
                  onChange={async (e) => {
                    const value = e.target.checked;
                    try {
                      const s = await window.focalDesktop!.setLogin(value);
                      setLogin(s.openAtLogin);
                    } catch {
                      setError('Не удалось изменить автозапуск.');
                    }
                  }}
                />
                Запускать focal в трее при входе в Windows
              </label>
            ) : (
              <p className="muted">
                Автозапуск и напоминания при закрытом браузере доступны в
                настольной версии focal.
              </p>
            )}
          </div>
        </section>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {preview && (
        <PreviewCard
          key={preview.token}
          preview={preview}
          mutate={mutate}
          onDone={() => setPreview(null)}
        />
      )}
    </div>
  );
}
