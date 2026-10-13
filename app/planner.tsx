'use client';
import {
  useEffect,
  useRef,
  useState,
  type SubmitEvent,
  type DragEvent,
} from 'react';
import {
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  FileText,
  Plus,
  Trash2,
  Copy,
  Repeat2,
  Undo2,
  Sparkles,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { NativeSelect } from '@/components/ui/native-select';
import {
  type CalendarEvent,
  type Mutate,
  type Note,
  type State,
  dayKey,
} from '@/lib/domain';
import {
  addDays,
  dropTime,
  atLocalTime,
  daySegments,
  localInput,
  weekStart,
} from '@/lib/calendar';
import { Field } from './sections';
import { DatePicker, NoteEditor } from './notes';
import { NotificationToggle } from './reminders';
import { Templates, SlotFinder } from './planning-tools';
import CalendarBlock from './calendar-block';

const colors = {
  emerald: 'Работа · зелёный',
  sky: 'Личное · голубой',
  violet: 'Учёба · фиолетовый',
  rose: 'Отдых · розовый',
  amber: 'Другое · янтарный',
};
type Draft = {
  event: CalendarEvent | null;
  start: Date;
  end: Date;
  taskId?: string;
};
const time = (value: string) =>
  new Date(value).toLocaleTimeString('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
  });

function EventEditor({
  draft,
  data,
  close,
  mutate,
  busy,
  error,
}: {
  draft: Draft;
  data: State;
  close: () => void;
  mutate: Mutate;
  busy: boolean;
  error: string;
}) {
  const event = draft.event,
    [taskId, setTaskId] = useState(event?.task_id || draft.taskId || ''),
    [kind, setKind] = useState(taskId ? 'task' : 'event'),
    [deleting, setDeleting] = useState(false);
  const [start, setStart] = useState(localInput(draft.start)),
    [end, setEnd] = useState(localInput(draft.end));
  const selected = data.tasks.find((t) => t.id === taskId),
    [localError, setLocalError] = useState('');
  const canEdit = !event?.completed_at;
  const [frequency, setFrequency] = useState('none'),
    [weekdays, setWeekdays] = useState([draft.start.getDay()]),
    [until, setUntil] = useState(dayKey(addDays(draft.start, 90))),
    [scope, setScope] = useState('one');
  const conflicts = data.events.filter(
    (e) =>
      e.id !== event?.id &&
      !e.completed_at &&
      Date.parse(e.start_at) < new Date(end).getTime() &&
      Date.parse(e.end_at) > new Date(start).getTime(),
  );
  async function save(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    setLocalError('');
    const values = Object.fromEntries(new FormData(e.currentTarget));
    if (kind === 'task' && !taskId) {
      setLocalError('Выберите задачу.');
      return;
    }
    const from = new Date(start),
      to = new Date(end);
    if (!Number.isFinite(from.getTime()) || to <= from) {
      setLocalError('Укажите окончание позже начала.');
      return;
    }
    const result = await mutate(
      {
        action: 'event.save',
        ...values,
        id: event?.id,
        title: kind === 'task' ? selected?.title : values.title,
        task_id: kind === 'task' ? taskId : null,
        start_at: from.toISOString(),
        end_at: to.toISOString(),
        reminder_minutes: Number(values.reminder_minutes || 0),
        scope,
        recurrence: event
          ? undefined
          : {
              frequency,
              weekdays,
              until,
              interval: Number(values.repeat_interval || 1),
            },
      },
      'Добавлено в расписание',
    );
    if (result) close();
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) close();
      }}
    >
      <DialogContent className="focal-dialog event-dialog">
        <DialogTitle>
          {event ? 'Событие в расписании' : 'Запланировать время'}
        </DialogTitle>
        <DialogDescription>
          Задайте начало и окончание. Блок займёт это время в календаре.
        </DialogDescription>
        <form className="modal-form" onSubmit={save}>
          <Field label="Что планируем?">
            <NativeSelect
              value={kind}
              disabled={!canEdit}
              onChange={(e) => setKind(e.target.value)}
            >
              <option value="event">Событие</option>
              <option value="task">Задачу из списка</option>
            </NativeSelect>
          </Field>
          {kind === 'task' ? (
            <Field label="Задача">
              <NativeSelect
                value={taskId}
                required
                disabled={!canEdit}
                onChange={(e) => setTaskId(e.target.value)}
              >
                <option value="">Выберите задачу</option>
                {data.tasks
                  .filter(
                    (t) =>
                      ['pending', 'active'].includes(t.status) ||
                      t.id === taskId,
                  )
                  .map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.title}
                    </option>
                  ))}
              </NativeSelect>
            </Field>
          ) : (
            <Field label="Название">
              <input
                required
                maxLength={160}
                name="title"
                defaultValue={event?.title}
                disabled={!canEdit}
                placeholder="Встреча, лекция, прогулка…"
              />
            </Field>
          )}
          <div className="form-pair">
            <Field label="Начало">
              <input
                type="datetime-local"
                value={start}
                onChange={(e) => setStart(e.target.value)}
                required
                disabled={!canEdit}
              />
            </Field>
            <Field label="Окончание">
              <input
                type="datetime-local"
                value={end}
                onChange={(e) => setEnd(e.target.value)}
                required
                disabled={!canEdit}
              />
            </Field>
          </div>
          <Field label="Цвет блока">
            <NativeSelect
              name="color"
              defaultValue={event?.color || 'emerald'}
              disabled={!canEdit}
            >
              {Object.entries(colors).map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Напомнить">
            <NativeSelect
              name="reminder_minutes"
              defaultValue={event?.reminder_minutes || 0}
              disabled={!canEdit}
            >
              <option value={0}>В момент начала</option>
              <option value={5}>За 5 минут</option>
              <option value={15}>За 15 минут</option>
              <option value={30}>За 30 минут</option>
            </NativeSelect>
          </Field>
          {!event && (
            <section className="recurrence-fields">
              <Field label="Повторять">
                <NativeSelect
                  value={frequency}
                  onChange={(e) => setFrequency(e.target.value)}
                >
                  <option value="none">Не повторять</option>
                  <option value="daily">По дням</option>
                  <option value="weekly">По неделям</option>
                </NativeSelect>
              </Field>
              {frequency !== 'none' && (
                <>
                  <div className="form-pair">
                    <Field
                      label={
                        frequency === 'daily'
                          ? 'Каждые N дней'
                          : 'Каждые N недель'
                      }
                    >
                      <input
                        name="repeat_interval"
                        type="number"
                        min={1}
                        max={12}
                        defaultValue={1}
                        required
                      />
                    </Field>
                    <Field label="Повторять до включительно">
                      <input
                        type="date"
                        required
                        value={until}
                        min={start.slice(0, 10)}
                        onChange={(e) => setUntil(e.target.value)}
                      />
                    </Field>
                  </div>
                  {frequency === 'weekly' && (
                    <fieldset
                      className="weekday-options"
                      aria-label="Дни повторения"
                    >
                      {['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map(
                        (label, i) => {
                          const day = (i + 1) % 7;
                          return (
                            <button
                              key={day}
                              type="button"
                              aria-pressed={weekdays.includes(day)}
                              className={
                                weekdays.includes(day) ? 'selected' : ''
                              }
                              onClick={() =>
                                setWeekdays((old) =>
                                  old.includes(day)
                                    ? old.filter((d) => d !== day)
                                    : [...old, day],
                                )
                              }
                            >
                              {label}
                            </button>
                          );
                        },
                      )}
                    </fieldset>
                  )}
                  <p className="footnote">
                    До 730 событий на ближайшие два года. Время повторов — по
                    часовому поясу этого компьютера.
                  </p>
                </>
              )}
            </section>
          )}
          {event?.series_id && (
            <Field label="Изменить или удалить">
              <NativeSelect
                value={scope}
                onChange={(e) => setScope(e.target.value)}
              >
                <option value="one">Только это событие</option>
                <option value="series">Незавершённые события серии</option>
              </NativeSelect>
              <span className="footnote">
                Завершённые события и отдельно изменённые повторы сохраняются.
              </span>
            </Field>
          )}
          <Field label="Описание · необязательно">
            <textarea
              name="description"
              rows={3}
              maxLength={10000}
              defaultValue={event?.description}
              disabled={!canEdit}
              placeholder="Место встречи, план или важные детали"
            />
          </Field>
          {kind === 'task' && (
            <p className="footnote">
              Блок выделяет время на задачу. Дедлайн и статус самой задачи
              меняются отдельно.
            </p>
          )}
          {conflicts.length > 0 && (
            <p className="overlap-note">
              <Clock3 size={14} />
              Пересечение с {conflicts.length} событиями. Они будут показаны
              рядом.
            </p>
          )}
          {(localError || error) && (
            <p className="form-error" role="alert">
              {localError || error}
            </p>
          )}
          {deleting ? (
            <div className="delete-confirm">
              <p>
                {scope === 'series'
                  ? 'Удалить неизменённые незавершённые события серии?'
                  : 'Удалить только этот блок из расписания?'}
              </p>
              <button
                type="button"
                className="secondary"
                onClick={() => setDeleting(false)}
              >
                Оставить
              </button>
              <button
                type="button"
                className="danger-button"
                disabled={busy}
                onClick={async () => {
                  if (
                    await mutate(
                      { action: 'event.delete', id: event?.id, scope },
                      'Блок удалён из расписания',
                    )
                  )
                    close();
                }}
              >
                Удалить
              </button>
            </div>
          ) : (
            <>
              <div className="event-secondary-actions">
                {event && (
                  <>
                    <button
                      type="button"
                      className="secondary"
                      disabled={busy}
                      onClick={async () => {
                        const from = new Date(start);
                        if (!Number.isFinite(from.getTime())) return;
                        const copyStart = addDays(from, 1);
                        if (
                          await mutate(
                            {
                              action: 'event.duplicate',
                              id: event.id,
                              start_at: copyStart.toISOString(),
                            },
                            'Копия добавлена на следующий день',
                          )
                        )
                          close();
                      }}
                    >
                      <Copy size={15} />
                      Копия на следующий день
                    </button>
                    <button
                      type="button"
                      className="subtle"
                      onClick={() => setDeleting(true)}
                    >
                      <Trash2 size={14} />
                      Удалить блок
                    </button>
                    <button
                      type="button"
                      className="secondary"
                      disabled={busy}
                      onClick={async () => {
                        if (
                          await mutate(
                            {
                              action: 'event.complete',
                              id: event.id,
                              completed: !event.completed_at,
                            },
                            event.completed_at
                              ? 'Событие возвращено в план'
                              : 'Событие отмечено выполненным',
                          )
                        )
                          close();
                      }}
                    >
                      <Check size={15} />
                      {event.completed_at
                        ? 'Вернуть в план'
                        : 'Событие выполнено'}
                    </button>
                  </>
                )}
              </div>
              <div className="modal-actions">
                <button
                  type="button"
                  className="secondary"
                  disabled={busy}
                  onClick={close}
                >
                  Закрыть
                </button>
                {canEdit && (
                  <button className="primary" disabled={busy}>
                    {busy ? 'Сохраняем…' : 'Сохранить время'}
                  </button>
                )}
              </div>
            </>
          )}
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function Planner({
  data,
  date,
  onDate,
  mutate,
  busy,
  error,
  initialTaskId,
  onInitialUsed,
  onOpenNotes,
  initialEventId,
  onEventUsed,
}: {
  data: State;
  date: string;
  onDate: (date: string) => void;
  mutate: Mutate;
  busy: boolean;
  error: string;
  initialTaskId?: string;
  onInitialUsed: () => void;
  onOpenNotes: (date: string) => void;
  initialEventId?: string;
  onEventUsed?: () => void;
}) {
  const [mode, setMode] = useState<'week' | 'day'>('week'),
    [draft, setDraft] = useState<Draft | null>(null),
    [editingNote, setEditingNote] = useState<Note | null | undefined>(
      undefined,
    ),
    [dragging, setDragging] = useState<string | null>(null);
  const [templatesOpen, setTemplatesOpen] = useState(false),
    [slotsOpen, setSlotsOpen] = useState(false),
    [slotTask, setSlotTask] = useState<string | undefined>();
  const scroll = useRef<HTMLDivElement>(null),
    dateValue = new Date(date + 'T12:00:00');
  const days =
    mode === 'day'
      ? [dateValue]
      : Array.from({ length: 7 }, (_, i) => addDays(weekStart(dateValue), i));
  useEffect(() => {
    if (scroll.current) scroll.current.scrollTop = 7 * 72;
  }, [mode]);
  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        const saved = localStorage.getItem('focal-calendar-mode');
        setMode(
          saved === 'week' || saved === 'day'
            ? saved
            : window.matchMedia('(max-width: 700px)').matches
              ? 'day'
              : 'week',
        );
      } catch {
        setMode(
          window.matchMedia('(max-width: 700px)').matches ? 'day' : 'week',
        );
      }
    }, 0);
    return () => clearTimeout(timer);
  }, []);
  useEffect(() => {
    const timer = setTimeout(() => {
      if (initialEventId) {
        const e = data.events.find((e) => e.id === initialEventId);
        if (e)
          setDraft({
            event: e,
            start: new Date(e.start_at),
            end: new Date(e.end_at),
          });
        else if (initialEventId === 'new') {
          const start = atLocalTime(new Date(date + 'T00:00:00'));
          setDraft({
            event: null,
            start,
            end: new Date(start.getTime() + 60 * 60000),
          });
        }
        onEventUsed?.();
      }
    }, 0);
    return () => clearTimeout(timer);
  }, [initialEventId, data.events, onEventUsed, date]);
  useEffect(() => {
    const timer = setTimeout(() => {
      if (initialTaskId) {
        setSlotTask(initialTaskId);
        setSlotsOpen(true);
        onInitialUsed();
      }
    }, 0);
    return () => clearTimeout(timer);
  }, [initialTaskId, onInitialUsed]);
  useEffect(() => {
    const handle = (e: KeyboardEvent) => {
      if (
        (e.ctrlKey || e.metaKey) &&
        e.key.toLowerCase() === 'z' &&
        !e.shiftKey &&
        !(
          e.target instanceof HTMLElement &&
          e.target.closest(
            'input,textarea,[contenteditable="true"],[role="dialog"]',
          )
        ) &&
        !draft &&
        !templatesOpen &&
        !slotsOpen &&
        editingNote === undefined &&
        data.calendar_undo &&
        !busy
      ) {
        e.preventDefault();
        void mutate({ action: 'calendar.undo' }, 'Действие отменено');
      }
    };
    window.addEventListener('keydown', handle);
    return () => window.removeEventListener('keydown', handle);
  }, [
    data.calendar_undo,
    busy,
    draft,
    templatesOpen,
    slotsOpen,
    editingNote,
    mutate,
  ]);
  function add(start = atLocalTime(dateValue), taskId?: string) {
    setDraft({
      event: null,
      start,
      end: new Date(
        start.getTime() +
          (taskId
            ? data.tasks.find((t) => t.id === taskId)?.estimated_minutes || 30
            : 60) *
            60000,
      ),
      taskId,
    });
  }
  const notes = data.notes.filter((n) => n.note_date === date),
    agenda = daySegments(data.events, dateValue);
  async function drop(e: DragEvent<HTMLDivElement>, day: Date) {
    e.preventDefault();
    const id = e.dataTransfer.getData('application/focal-event');
    const offset = Number(
      e.dataTransfer.getData('application/focal-grab-offset'),
    );
    if (
      !id ||
      busy ||
      !data.events.some((event) => event.id === id) ||
      !Number.isFinite(offset)
    )
      return;
    const bounds = e.currentTarget.getBoundingClientRect();
    const minute = Math.max(0, Math.min(1439, (e.clientY - bounds.top) / 1.2));
    setDragging(null);
    await mutate(
      {
        action: 'event.move',
        id,
        start_at: dropTime(day, minute, offset).toISOString(),
      },
      'Время события изменено',
    );
  }
  return (
    <>
      <div className="planner-toolbar">
        <div className="planner-title">
          <div className="planner-arrows">
            <button
              className="icon-button"
              aria-label="Предыдущий период"
              onClick={() =>
                onDate(dayKey(addDays(dateValue, mode === 'week' ? -7 : -1)))
              }
            >
              <ChevronLeft size={19} />
            </button>
            <button
              className="icon-button"
              aria-label="Следующий период"
              onClick={() =>
                onDate(dayKey(addDays(dateValue, mode === 'week' ? 7 : 1)))
              }
            >
              <ChevronRight size={19} />
            </button>
          </div>
          <h2>
            {mode === 'day'
              ? dateValue.toLocaleDateString('ru-RU', {
                  day: 'numeric',
                  month: 'long',
                })
              : `${days[0].getDate()} ${days[0].toLocaleDateString('ru-RU', { month: 'short' })} — ${days[6].getDate()} ${days[6].toLocaleDateString('ru-RU', { month: 'short', year: 'numeric' })}`}
          </h2>
          <button className="secondary" onClick={() => onDate(dayKey())}>
            Сегодня
          </button>
        </div>
        <div className="planner-actions">
          <button
            className="icon-button"
            title="Отменить последнее изменение календаря (Ctrl+Z)"
            aria-label="Отменить последнее изменение календаря"
            disabled={busy || !data.calendar_undo}
            onClick={() =>
              void mutate({ action: 'calendar.undo' }, 'Действие отменено')
            }
          >
            <Undo2 size={18} />
          </button>
          <button className="secondary" onClick={() => setTemplatesOpen(true)}>
            <Repeat2 size={16} />
            Шаблоны
          </button>
          <NotificationToggle />
          <div className="segmented">
            <button
              className={mode === 'day' ? 'selected' : ''}
              aria-pressed={mode === 'day'}
              onClick={() => {
                setMode('day');
                try {
                  localStorage.setItem('focal-calendar-mode', 'day');
                } catch {}
              }}
            >
              День
            </button>
            <button
              className={mode === 'week' ? 'selected' : ''}
              aria-pressed={mode === 'week'}
              onClick={() => {
                setMode('week');
                try {
                  localStorage.setItem('focal-calendar-mode', 'week');
                } catch {}
              }}
            >
              Неделя
            </button>
          </div>
          <button className="primary" onClick={() => add()}>
            <Plus size={16} />
            Событие или задача
          </button>
        </div>
      </div>
      <div className="planner-layout">
        <aside className="planner-sidebar">
          <section className="panel">
            <DatePicker
              key={date.slice(0, 7)}
              value={date}
              notes={data.notes}
              events={data.events}
              onChange={onDate}
            />
            <p className="mini-legend">
              <i className="dot green" />
              События
              <i className="dot violet" />
              Заметки
            </p>
          </section>
          <section className="panel day-notes">
            <div className="panel-heading">
              <h3>
                Заметки дня <span className="count">{notes.length}</span>
              </h3>
              <button
                className="icon-button"
                aria-label="Добавить заметку на выбранный день"
                onClick={() => setEditingNote(null)}
              >
                <Plus size={17} />
              </button>
            </div>
            {notes.length ? (
              notes.slice(0, 4).map((n) => (
                <button
                  className="day-note-item"
                  key={n.id}
                  onClick={() => setEditingNote(n)}
                >
                  <FileText size={14} />
                  <span>{n.title}</span>
                </button>
              ))
            ) : (
              <p className="muted">Сохраните мысли и итоги этого дня.</p>
            )}
            <button className="text-action" onClick={() => onOpenNotes(date)}>
              Открыть заметки дня
            </button>
          </section>
          <section className="panel unscheduled">
            <h3>Задачи для расписания</h3>
            <button
              className="secondary"
              onClick={() => {
                setSlotTask(undefined);
                setSlotsOpen(true);
              }}
            >
              <Sparkles size={15} />
              Подобрать время
            </button>
            {data.tasks.filter((t) => t.status === 'pending').length ? (
              data.tasks
                .filter((t) => t.status === 'pending')
                .slice(0, 8)
                .map((t) => (
                  <button
                    key={t.id}
                    onClick={() => {
                      setSlotTask(t.id);
                      setSlotsOpen(true);
                    }}
                  >
                    <span>{t.title}</span>
                    <Plus size={14} />
                  </button>
                ))
            ) : (
              <p className="muted">Создайте задачу в разделе «Задачи».</p>
            )}
          </section>
        </aside>
        <section className="timetable-panel">
          <div className="timetable-hint">
            <span>
              <CalendarDays size={15} />
              Нажмите на свободное время, чтобы добавить блок
            </span>
            <span>Перетащите блок для переноса</span>
          </div>
          <div className="timetable-scroll" ref={scroll}>
            <div
              className={`timetable ${mode}`}
              style={{ '--day-count': days.length } as React.CSSProperties}
            >
              <div className="timetable-header">
                <span className="time-zone">24 ч</span>
                {days.map((day) => (
                  <button
                    key={dayKey(day)}
                    className={`${dayKey(day) === date ? 'selected' : ''} ${dayKey(day) === dayKey() ? 'is-today' : ''}`}
                    onClick={() => onDate(dayKey(day))}
                  >
                    <span>
                      {day.toLocaleDateString('ru-RU', { weekday: 'short' })}
                    </span>
                    <strong>{day.getDate()}</strong>
                    <small>
                      {data.notes.filter((n) => n.note_date === dayKey(day))
                        .length > 0 ? (
                        <>
                          <FileText size={11} />
                          {
                            data.notes.filter(
                              (n) => n.note_date === dayKey(day),
                            ).length
                          }
                        </>
                      ) : null}
                    </small>
                  </button>
                ))}
              </div>
              <div className="timetable-body">
                <div className="hour-labels">
                  {Array.from({ length: 24 }, (_, h) => (
                    <span key={h} style={{ top: h * 72 }}>
                      {String(h).padStart(2, '0')}:00
                    </span>
                  ))}
                </div>
                {days.map((day) => {
                  const key = dayKey(day),
                    segments = daySegments(data.events, day),
                    isToday = key === dayKey();
                  return (
                    <div
                      key={key}
                      className={`day-column ${dragging ? 'drop-ready' : ''}`}
                      onDragOver={(e) => {
                        if (dragging) e.preventDefault();
                      }}
                      onDrop={(e) => void drop(e, day)}
                    >
                      {Array.from({ length: 48 }, (_, i) => (
                        <button
                          className="time-slot"
                          key={i}
                          tabIndex={i === 18 ? 0 : -1}
                          onKeyDown={(e) => {
                            if (
                              [
                                'ArrowUp',
                                'ArrowDown',
                                'ArrowLeft',
                                'ArrowRight',
                              ].includes(e.key)
                            ) {
                              e.preventDefault();
                              const column = e.currentTarget.parentElement;
                              const next =
                                e.key === 'ArrowLeft'
                                  ? column?.previousElementSibling
                                  : e.key === 'ArrowRight'
                                    ? column?.nextElementSibling
                                    : column;
                              const index =
                                e.key === 'ArrowUp'
                                  ? Math.max(0, i - 1)
                                  : e.key === 'ArrowDown'
                                    ? Math.min(47, i + 1)
                                    : i;
                              next
                                ?.querySelectorAll<HTMLButtonElement>(
                                  '.time-slot',
                                )
                                [index]?.focus();
                            }
                          }}
                          style={{ top: i * 36 }}
                          aria-label={`Добавить ${key} в ${Math.floor(i / 2)}:${i % 2 ? '30' : '00'}`}
                          onClick={() => {
                            onDate(key);
                            add(
                              atLocalTime(
                                day,
                                Math.floor(i / 2),
                                i % 2 ? 30 : 0,
                              ),
                            );
                          }}
                        >
                          <span>
                            <Plus size={12} />
                            {Math.floor(i / 2)}:{i % 2 ? '30' : '00'}
                          </span>
                        </button>
                      ))}
                      {segments.map((s) => (
                        <CalendarBlock
                          key={s.event.id}
                          segment={s}
                          day={day}
                          busy={busy}
                          mutate={mutate}
                          onDrag={setDragging}
                          onOpen={() =>
                            setDraft({
                              event: s.event,
                              start: new Date(s.event.start_at),
                              end: new Date(s.event.end_at),
                            })
                          }
                        />
                      ))}
                      {isToday && (
                        <div
                          className="now-line"
                          style={{
                            top:
                              (new Date().getHours() * 60 +
                                new Date().getMinutes()) *
                              1.2,
                          }}
                          aria-hidden="true"
                        >
                          <i />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
          <div className="timetable-footer">
            <span>
              {
                data.events.filter(
                  (e) =>
                    Date.parse(e.start_at) <
                      addDays(days[days.length - 1], 1).getTime() &&
                    Date.parse(e.end_at) > atLocalTime(days[0], 0).getTime(),
                ).length
              }{' '}
              событий в этом периоде
            </span>
            <span>
              Время на устройстве ·{' '}
              {new Intl.DateTimeFormat().resolvedOptions().timeZone}
            </span>
          </div>
        </section>
      </div>
      <section className="panel agenda-panel">
        <div className="panel-heading">
          <h3>
            План на{' '}
            {dateValue.toLocaleDateString('ru-RU', {
              day: 'numeric',
              month: 'long',
            })}
          </h3>
          <button className="text-action" onClick={() => add()}>
            <Plus size={14} />
            Добавить
          </button>
        </div>
        {agenda.length ? (
          agenda.map(({ event }) => (
            <button
              className="agenda-row"
              key={event.id}
              onClick={() =>
                setDraft({
                  event,
                  start: new Date(event.start_at),
                  end: new Date(event.end_at),
                })
              }
            >
              <span className="agenda-time">
                {time(event.start_at)}–{time(event.end_at)}
              </span>
              <i className={`agenda-dot color-${event.color}`} />
              <span className={event.completed_at ? 'struck' : ''}>
                {event.title}
              </span>
              {event.completed_at && <Check size={16} />}
            </button>
          ))
        ) : (
          <p className="muted">
            День пока свободен. Выберите время в сетке выше.
          </p>
        )}
      </section>
      {draft && (
        <EventEditor
          key={draft.event?.id || draft.start.toISOString()}
          draft={draft}
          data={data}
          close={() => setDraft(null)}
          mutate={mutate}
          busy={busy}
          error={error}
        />
      )}{' '}
      {editingNote !== undefined && (
        <NoteEditor
          key={editingNote?.id || 'new'}
          note={editingNote}
          date={date}
          onClose={() => setEditingNote(undefined)}
          mutate={mutate}
          busy={busy}
          error={error}
          onSchedule={(id) => {
            setEditingNote(undefined);
            setSlotTask(id);
            setSlotsOpen(true);
          }}
        />
      )}
      {templatesOpen && (
        <Templates
          data={data}
          date={date}
          mutate={mutate}
          busy={busy}
          error={error}
          close={() => setTemplatesOpen(false)}
        />
      )}
      {slotsOpen && (
        <SlotFinder
          data={data}
          date={date}
          initialTask={slotTask}
          close={() => setSlotsOpen(false)}
          onChoose={(task, start, end) => {
            setSlotsOpen(false);
            onDate(dayKey(start));
            setDraft({ event: null, start, end, taskId: task.id });
          }}
        />
      )}
    </>
  );
}
