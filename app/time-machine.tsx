'use client';
import { useState, type CSSProperties } from 'react';
import { CalendarDays, RotateCcw } from 'lucide-react';
import {
  dayKey,
  currency,
  type State,
  type Task,
  type Note,
} from '@/lib/domain';
import { addDays, weekStart } from '@/lib/calendar';
export function WeekScene({
  data,
  date,
  onDate,
}: {
  data: State;
  date: string;
  onDate: (date: string) => void;
}) {
  const [rotation, setRotation] = useState(-18);
  const start = weekStart(new Date(date + 'T12:00:00'));
  const days = Array.from({ length: 7 }, (_, i) => dayKey(addDays(start, i)));
  return (
    <section className="week-scene">
      <div className="scene-heading">
        <div>
          <span className="eyebrow">ВАША НЕДЕЛЯ В ОБЪЁМЕ</span>
          <h3>Время обретает форму</h3>
        </div>
        <button
          className="subtle"
          onClick={() => setRotation(-18)}
          aria-label="Сбросить ракурс"
        >
          <RotateCcw size={16} />
        </button>
      </div>
      <div className="scene-viewport">
        <div
          className="scene-world"
          style={{ '--scene-angle': `${rotation}deg` } as CSSProperties}
        >
          {days.map((d, i) => {
            const events = data.events.filter(
                (e) => dayKey(new Date(e.start_at)) === d,
              ),
              minutes = events.reduce(
                (n, e) =>
                  n + (Date.parse(e.end_at) - Date.parse(e.start_at)) / 60000,
                0,
              ),
              notes = data.notes.filter((n) => n.note_date === d).length;
            return (
              <button
                className={`scene-day ${date === d ? 'selected' : ''}`}
                key={d}
                onClick={() => onDate(d)}
                aria-label={`${d}: ${events.length} событий, ${Math.round(minutes)} минут, ${notes} заметок`}
                style={
                  {
                    '--day-index': i,
                    '--height': `${Math.max(10, Math.min(125, minutes / 3))}px`,
                  } as CSSProperties
                }
              >
                <span className="scene-column">
                  <span className="scene-top">
                    {Math.round((minutes / 60) * 10) / 10}
                    <small>ч</small>
                  </span>
                  <span className="scene-front" />
                  <span className="scene-side" />
                </span>
                <span className="scene-label">
                  {new Date(d + 'T12:00:00').toLocaleDateString('ru-RU', {
                    weekday: 'short',
                  })}
                  <b>{d.slice(-2)}</b>
                </span>
                <span className="scene-note">
                  {notes ? `${notes} замет.` : '·'}
                </span>
              </button>
            );
          })}
        </div>
      </div>
      <label className="scene-control">
        Ракурс
        <input
          aria-label="Повернуть трёхмерную неделю"
          type="range"
          min="-40"
          max="35"
          value={rotation}
          onChange={(e) => setRotation(Number(e.target.value))}
        />
      </label>
      <p className="muted">
        Высота — запланированные часы. Выберите день для просмотра истории.
      </p>
    </section>
  );
}
export default function TimeMachine({
  data,
  onTask,
  onNote,
  onCalendar,
}: {
  data: State;
  onTask: (task: Task) => void;
  onNote: (note: Note) => void;
  onCalendar: (date: string) => void;
}) {
  const [date, setDate] = useState(() => dayKey(new Date(data.server_now))),
    [query, setQuery] = useState(''),
    [range, setRange] = useState(false),
    [from, setFrom] = useState(() =>
      dayKey(addDays(new Date(data.server_now), -30)),
    );
  const q = query.toLocaleLowerCase('ru');
  const within = (d: string) =>
    d <= (date || '9999') && d >= (range ? from : date);
  const items = [
    ...data.notes.map((n) => ({
      id: n.id,
      date: n.note_date,
      kind: 'Заметка',
      title: n.title,
      body: n.body,
      open: () => onNote(n),
    })),
    ...data.tasks
      .filter((t) => t.completed_at || t.created_at)
      .map((t) => ({
        id: t.id,
        date: dayKey(new Date(t.completed_at || t.created_at!)),
        kind: t.completed_at ? 'Задача завершена' : 'Задача создана',
        title: t.title,
        body: '',
        open: () => onTask(t),
      })),
    ...data.events.map((e) => ({
      id: e.id,
      date: dayKey(new Date(e.start_at)),
      kind: e.completed_at ? 'Блок выполнен' : 'В календаре',
      title: e.title,
      body: e.description,
      open: () => onCalendar(dayKey(new Date(e.start_at))),
    })),
    ...(data.checkpoints || []).map((c) => ({
      id: c.id,
      date: dayKey(new Date(c.created_at)),
      kind: 'Точка продолжения',
      title: data.tasks.find((t) => t.id === c.task_id)?.title || 'Задача',
      body: `${c.summary}\n${c.next_step}`,
      open: () => {
        const t = data.tasks.find((t) => t.id === c.task_id);
        if (t) onTask(t);
      },
    })),
    ...data.transactions.map((t) => ({
      id: t.id,
      date: t.actual_date || t.planned_date,
      kind: t.actual_date ? 'Операция' : 'Финансовый план',
      title: `${t.category} · ${currency(t.amount_minor)}`,
      body: '',
      open: () => onCalendar(t.actual_date || t.planned_date),
    })),
    ...data.energy_logs.map((e) => ({
      id: e.id,
      date: dayKey(new Date(e.logged_at)),
      kind: 'Энергия',
      title: `${e.energy_level}/10`,
      body: new Date(e.logged_at).toLocaleTimeString('ru-RU', {
        hour: '2-digit',
        minute: '2-digit',
      }),
      open: () => onCalendar(dayKey(new Date(e.logged_at))),
    })),
    ...data.sessions.map((s) => ({
      id: s.id,
      date: dayKey(new Date(s.started_at)),
      kind: 'Сессия фокуса',
      title: data.tasks.find((t) => t.id === s.task_id)?.title || 'Фокус',
      body: `${s.work_duration} мин. по плану · ${s.phase === 'completed' ? 'завершена' : s.phase === 'cancelled' ? 'прервана' : 'идёт'}`,
      open: () => {
        const t = data.tasks.find((t) => t.id === s.task_id);
        if (t) onTask(t);
      },
    })),
  ]
    .filter(
      (i) =>
        within(i.date) &&
        `${i.title} ${i.body} ${i.kind}`.toLocaleLowerCase('ru').includes(q),
    )
    .sort((a, b) => b.date.localeCompare(a.date));
  return (
    <div className="time-machine">
      <WeekScene
        data={data}
        date={date || dayKey()}
        onDate={(d) => {
          setDate(d);
          setRange(false);
        }}
      />
      <section className="panel">
        <div className="panel-heading">
          <h3>
            <CalendarDays size={18} /> Машина времени
          </h3>
          <label className="check-label">
            <input
              type="checkbox"
              checked={range}
              onChange={(e) => setRange(e.target.checked)}
            />
            Период
          </label>
        </div>
        <div className="inline-fields">
          {range && (
            <input
              aria-label="Начало периода истории"
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          )}
          <input
            aria-label="Дата истории"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
          <input
            aria-label="Поиск в истории"
            placeholder="Найти идею, задачу или покупку…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="timeline">
          {items.slice(0, 200).map((i) => (
            <button
              key={i.kind + i.id}
              className="timeline-item"
              onClick={i.open}
            >
              <span className="timeline-dot" />
              <small>
                {i.date} · {i.kind}
              </small>
              <strong>{i.title}</strong>
              {i.body && <p>{i.body.slice(0, 600)}</p>}
            </button>
          ))}
        </div>
        {!items.length && (
          <p className="muted">
            За этот период совпадений нет. Расширьте даты или измените запрос.
          </p>
        )}
        {items.length > 200 && (
          <p className="muted">Первые 200 записей. Уточните поиск.</p>
        )}
      </section>
    </div>
  );
}
