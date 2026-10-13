'use client';
import { useEffect, useState, useRef, type SubmitEvent } from 'react';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { FileCheck, ListTodo, Trash2 } from 'lucide-react';
import { type Mutate, type Note } from '@/lib/domain';
import { Field } from './sections';
import Materials from './materials';

type Draft = { title: string; body: string; note_date: string };
export default function NoteEditor({
  note,
  date,
  onClose,
  mutate,
  busy,
  error,
  onSchedule,
}: {
  note: Note | null;
  date: string;
  onClose: () => void;
  mutate: Mutate;
  busy: boolean;
  error: string;
  onSchedule?: (id: string) => void;
}) {
  const key = `focal-note-draft:${note?.id || 'new:' + date}`;
  const [draft, setDraft] = useState<Draft>({
    title: note?.title || '',
    body: note?.body || '',
    note_date: note?.note_date || date,
  });
  const [status, setStatus] = useState(''),
    [recovered, setRecovered] = useState(false),
    [dirty, setDirty] = useState(false),
    [deleting, setDeleting] = useState(false);
  const [converting, setConverting] = useState(false),
    [taskTitle, setTaskTitle] = useState(''),
    [minutes, setMinutes] = useState(30),
    [schedule, setSchedule] = useState(true);
  const selection = useRef('');
  const persistedId = useRef(note?.id);
  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        const raw = localStorage.getItem(key);
        if (raw) {
          const saved = JSON.parse(raw);
          if (
            typeof saved.title === 'string' &&
            typeof saved.body === 'string' &&
            typeof saved.note_date === 'string'
          ) {
            setDraft(saved);
            setRecovered(true);
            setDirty(true);
            setStatus('Черновик восстановлен на этом устройстве');
          }
        }
      } catch {
        setStatus('Хранилище черновиков недоступно');
      }
    }, 0);
    return () => clearTimeout(timer);
  }, [key]);
  function update(next: Draft) {
    setDraft(next);
    setDirty(true);
    try {
      localStorage.setItem(key, JSON.stringify(next));
      setStatus('Черновик сохранён на этом устройстве');
    } catch {
      setStatus('Не удалось сохранить черновик. Нажмите «Сохранить».');
    }
  }
  function clear() {
    try {
      localStorage.removeItem(key);
    } catch {
      /* Save still persists in SQLite. */
    }
  }
  function close() {
    if (
      dirty &&
      status.startsWith('Не удалось') &&
      !window.confirm('Черновик не сохранён. Закрыть заметку?')
    )
      return;
    onClose();
  }
  async function persist() {
    if (!draft.title.trim()) return null;
    const result = await mutate(
      { action: 'note.save', id: persistedId.current, ...draft },
      'Заметка сохранена',
    );
    if (!result) return null;
    clear();
    setDirty(false);
    const saved = persistedId.current
      ? result.notes.find((n) => n.id === persistedId.current)
      : result.notes.find(
          (n) =>
            n.title === draft.title.trim() &&
            n.body === draft.body &&
            n.note_date === draft.note_date,
        );
    if (saved) persistedId.current = saved.id;
    return saved ? { note: saved, state: result } : null;
  }
  async function save(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    if (await persist()) onClose();
  }
  async function convert() {
    if (!taskTitle.trim()) return;
    const saved = await persist();
    if (!saved) return;
    const result = await mutate(
      {
        action: 'note.task',
        note_id: saved.note.id,
        title: taskTitle,
        estimated_minutes: minutes,
      },
      'Задача создана из заметки',
    );
    if (!result) return;
    const task = result.tasks.find(
      (t) => !saved.state.tasks.some((old) => old.id === t.id),
    );
    onClose();
    if (task && schedule) onSchedule?.(task.id);
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) close();
      }}
    >
      <DialogContent className="focal-dialog note-dialog">
        <DialogTitle>
          {note ? 'Редактировать заметку' : 'Новая заметка'}
        </DialogTitle>
        <DialogDescription>
          Выберите дату заметки. Выделенный пункт можно превратить в задачу.
        </DialogDescription>
        <form className="modal-form" onSubmit={save}>
          {recovered && (
            <div className="draft-status">
              <FileCheck size={16} />
              Есть сохранённый черновик.
              <button
                className="text-action"
                type="button"
                onClick={() => {
                  clear();
                  setDraft({
                    title: note?.title || '',
                    body: note?.body || '',
                    note_date: note?.note_date || date,
                  });
                  setDirty(false);
                  setRecovered(false);
                  setStatus('Черновик удалён');
                }}
              >
                Вернуться к сохранённой заметке
              </button>
            </div>
          )}
          <div className="note-form-heading">
            <Field label="Заголовок">
              <input
                required
                maxLength={160}
                value={draft.title}
                onChange={(e) => update({ ...draft, title: e.target.value })}
                placeholder="О чём эта заметка?"
              />
            </Field>
            <Field label="Дата">
              <input
                required
                type="date"
                value={draft.note_date}
                onChange={(e) =>
                  update({ ...draft, note_date: e.target.value })
                }
              />
            </Field>
          </div>
          <Field label="Заметка">
            <textarea
              rows={12}
              maxLength={50000}
              value={draft.body}
              onChange={(e) => update({ ...draft, body: e.target.value })}
              onSelect={(e) => {
                const t = e.currentTarget;
                selection.current = t.value.slice(
                  t.selectionStart,
                  t.selectionEnd,
                );
              }}
              placeholder="Идеи, итоги дня, планы…"
            />
          </Field>
          <div className="note-tools">
            <output className="muted">
              {status || 'Изменения сохраняются как черновик'}
            </output>
            <button
              type="button"
              className="secondary"
              disabled={busy || !draft.title.trim()}
              onClick={() => {
                setTaskTitle(
                  (selection.current || draft.title).trim().slice(0, 160),
                );
                setConverting((v) => !v);
              }}
            >
              <ListTodo size={16} />
              Сделать задачей
            </button>
          </div>
          {converting && (
            <section className="conversion-panel">
              <Field label="Название задачи">
                <input
                  maxLength={160}
                  value={taskTitle}
                  onChange={(e) => setTaskTitle(e.target.value)}
                />
              </Field>
              <Field label="Длительность, минут">
                <input
                  type="number"
                  min={1}
                  max={1440}
                  value={minutes}
                  onChange={(e) => setMinutes(Number(e.target.value))}
                />
              </Field>
              {onSchedule && (
                <label className="check-label">
                  <input
                    type="checkbox"
                    checked={schedule}
                    onChange={(e) => setSchedule(e.target.checked)}
                  />
                  Сразу выбрать время в календаре
                </label>
              )}
              <p className="footnote">
                Заметка сохранится, у задачи будет ссылка на неё.
              </p>
              <button
                type="button"
                className="primary"
                disabled={
                  busy || !taskTitle.trim() || minutes < 1 || minutes > 1440
                }
                onClick={() => void convert()}
              >
                Создать задачу
              </button>
            </section>
          )}
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          {deleting ? (
            <div className="delete-confirm">
              <p>
                Переместить заметку «{note?.title}» в корзину? Её можно
                восстановить вместе с материалами.
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
                      { action: 'note.delete', id: note?.id },
                      'Заметка в корзине',
                    )
                  ) {
                    clear();
                    onClose();
                  }
                }}
              >
                В корзину
              </button>
            </div>
          ) : (
            <div className="modal-actions">
              {note && (
                <button
                  type="button"
                  className="subtle delete-note"
                  onClick={() => setDeleting(true)}
                >
                  <Trash2 size={15} />
                  В корзину
                </button>
              )}
              <button
                type="button"
                className="secondary"
                disabled={busy}
                onClick={close}
              >
                Закрыть
              </button>
              <button className="primary" disabled={busy}>
                {busy ? 'Сохраняем…' : 'Сохранить заметку'}
              </button>
            </div>
          )}
        </form>
        {note && <Materials noteId={note.id} mutate={mutate} />}
      </DialogContent>
    </Dialog>
  );
}
