'use client';
import { useState, useMemo } from 'react';
import NoteEditor from './note-editor';
export { default as NoteEditor } from './note-editor';
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  FileText,
  Pencil,
  Plus,
  Search,
} from 'lucide-react';
import { dayKey, type Mutate, type Note } from '@/lib/domain';
import { Blank } from './sections';

export function DatePicker({
  value,
  onChange,
  notes,
  events = [],
}: {
  value: string;
  onChange: (date: string) => void;
  notes: Note[];
  events?: { start_at: string }[];
}) {
  const [month, setMonth] = useState(() => new Date(value + 'T12:00:00'));
  const first =
      (new Date(month.getFullYear(), month.getMonth(), 1).getDay() + 6) % 7,
    count = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  return (
    <div className="date-picker">
      <div className="panel-heading">
        <strong>
          {month.toLocaleDateString('ru-RU', {
            month: 'long',
            year: 'numeric',
          })}
        </strong>
        <div>
          <button
            className="icon-button"
            aria-label="Предыдущий месяц"
            onClick={() =>
              setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))
            }
          >
            <ChevronLeft size={16} />
          </button>
          <button
            className="icon-button"
            aria-label="Следующий месяц"
            onClick={() =>
              setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))
            }
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </div>
      <div className="mini-week">
        {['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map((d) => (
          <span key={d}>{d}</span>
        ))}
      </div>
      <div className="mini-days">
        {Array.from({ length: first }, (_, i) => (
          <span key={'blank' + i} />
        ))}
        {Array.from({ length: count }, (_, i) => {
          const date = dayKey(
              new Date(month.getFullYear(), month.getMonth(), i + 1),
            ),
            n = notes.filter((n) => n.note_date === date).length,
            hasEvent = events.some(
              (e) => dayKey(new Date(e.start_at)) === date,
            );
          return (
            <button
              key={date}
              className={`${date === value ? 'selected' : ''} ${date === dayKey() ? 'is-today' : ''}`}
              aria-label={`${date}${n ? `, заметок: ${n}` : ''}${hasEvent ? ', есть события' : ''}`}
              aria-pressed={date === value}
              onClick={() => onChange(date)}
            >
              {i + 1}
              <span className="mini-dots">
                {n > 0 && <i className="dot violet" />}
                {hasEvent && <i className="dot green" />}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function Notes({
  notes,
  date,
  onDate,
  mutate,
  busy,
  error,
  onSchedule,
}: {
  notes: Note[];
  date: string;
  onDate: (date: string) => void;
  mutate: Mutate;
  busy: boolean;
  error: string;
  onSchedule?: (id: string) => void;
}) {
  const [query, setQuery] = useState(''),
    [all, setAll] = useState(false),
    [editing, setEditing] = useState<Note | null | undefined>(undefined);
  const shown = useMemo(() => {
    const search = query.trim().toLocaleLowerCase();
    return notes.filter(
      (n) =>
        (all || n.note_date === date) &&
        (!search ||
          `${n.title} ${n.body}`.toLocaleLowerCase().includes(search)),
    );
  }, [notes, date, all, query]);
  return (
    <>
      <div className="notes-layout">
        <aside className="panel notes-sidebar">
          <DatePicker
            key={date.slice(0, 7)}
            notes={notes}
            value={date}
            onChange={(d) => {
              onDate(d);
              setAll(false);
            }}
          />
          <p className="mini-legend">
            <i className="dot violet" />
            Есть заметки
          </p>
          <button
            className="secondary full-width"
            onClick={() => {
              onDate(dayKey());
              setAll(false);
            }}
          >
            Сегодня
          </button>
          <button
            className={`notes-all ${all ? 'selected' : ''}`}
            onClick={() => setAll((v) => !v)}
          >
            <FileText size={16} />
            Все заметки<span>{notes.length}</span>
          </button>
        </aside>
        <section>
          <div className="notes-heading">
            <div>
              <p className="eyebrow">ВАШИ МЫСЛИ, ИДЕИ И ИТОГИ</p>
              <h2>
                {all
                  ? 'Все заметки'
                  : new Date(date + 'T12:00:00').toLocaleDateString('ru-RU', {
                      day: 'numeric',
                      month: 'long',
                      year: 'numeric',
                    })}
              </h2>
            </div>
            <button className="primary" onClick={() => setEditing(null)}>
              <Plus size={16} />
              Новая заметка
            </button>
          </div>
          <label className="notes-search">
            <Search size={17} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={
                all ? 'Поиск по всем заметкам' : 'Поиск в заметках дня'
              }
              aria-label="Поиск заметок"
            />
          </label>
          {shown.length ? (
            <div className="notes-grid">
              {shown.map((note) => (
                <button
                  className="note-card"
                  key={note.id}
                  onClick={() => setEditing(note)}
                >
                  <span className="note-card-top">
                    <CalendarDays size={13} />
                    {new Date(note.note_date + 'T12:00:00').toLocaleDateString(
                      'ru-RU',
                      { day: 'numeric', month: 'long' },
                    )}
                    <Pencil size={14} />
                  </span>
                  <h3>{note.title}</h3>
                  <p>
                    {note.body
                      ? note.body.slice(0, 400) +
                        (note.body.length > 400 ? '…' : '')
                      : 'Без текста'}
                  </p>
                  <span className="note-card-bottom">
                    Изменено{' '}
                    {new Date(note.updated_at).toLocaleTimeString('ru-RU', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <section className="panel">
              <Blank
                title={query ? 'Ничего не найдено' : 'Место для ваших мыслей'}
                icon={<FileText />}
              >
                {query
                  ? 'Измените запрос или выберите все заметки.'
                  : 'Создайте заметку на этот день — её будет легко найти через календарь.'}
              </Blank>
            </section>
          )}
        </section>
      </div>
      {editing !== undefined && (
        <NoteEditor
          key={editing?.id || 'new'}
          note={editing}
          date={date}
          onClose={() => setEditing(undefined)}
          mutate={mutate}
          busy={busy}
          error={error}
          onSchedule={onSchedule}
        />
      )}
    </>
  );
}
