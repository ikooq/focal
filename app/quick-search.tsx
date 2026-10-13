'use client';
import { useEffect, useMemo, useState } from 'react';
import { Search, CalendarDays, FileText, ListTodo, Plus } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from '@/components/ui/command';
import {
  dayKey,
  type State,
  type Task,
  type Note,
  type CalendarEvent,
} from '@/lib/domain';
export default function QuickSearch({
  data,
  disabled,
  onTask,
  onNote,
  onEvent,
  onDate,
  onCreate,
  commands = [],
}: {
  data: State;
  disabled: boolean;
  onTask: (t: Task) => void;
  onNote: (n: Note) => void;
  onEvent: (e: CalendarEvent) => void;
  onDate: (d: string) => void;
  onCreate: (kind: string) => void;
  commands?: { id: string; label: string; run: () => void }[];
}) {
  const [open, setOpen] = useState(false),
    [query, setQuery] = useState('');
  useEffect(() => {
    const handle = (e: KeyboardEvent) => {
      if (
        (e.ctrlKey || e.metaKey) &&
        e.key.toLowerCase() === 'k' &&
        !disabled
      ) {
        if (!open && document.querySelector('[role="dialog"]')) return;
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', handle);
    return () => window.removeEventListener('keydown', handle);
  }, [disabled, open]);
  const index = useMemo(
    () => ({
      notes: data.notes.map((n) => ({
        item: n,
        text: (n.title + ' ' + n.body + ' ' + n.note_date).toLocaleLowerCase(),
      })),
      tasks: data.tasks.map((t) => ({
        item: t,
        text: t.title.toLocaleLowerCase(),
      })),
      events: data.events.map((e) => ({
        item: e,
        text: (
          e.title +
          ' ' +
          e.description +
          ' ' +
          dayKey(new Date(e.start_at))
        ).toLocaleLowerCase(),
      })),
    }),
    [data.notes, data.tasks, data.events],
  );
  const q = query.trim().toLocaleLowerCase(),
    notes = index.notes.filter((n) => n.text.includes(q)).slice(0, 20),
    tasks = index.tasks.filter((t) => t.text.includes(q)).slice(0, 20),
    events = index.events.filter((e) => e.text.includes(q)).slice(0, 30);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(q)
    ? q
    : /^\d{2}\.\d{2}\.\d{4}$/.test(q)
      ? q.split('.').reverse().join('-')
      : '';
  const validDate =
    date &&
    Number.isFinite(Date.parse(date)) &&
    new Date(date).toISOString().slice(0, 10) === date;
  const choose = (fn: () => void) => {
    setOpen(false);
    setQuery('');
    fn();
  };
  return (
    <>
      <button
        className="search-trigger secondary"
        disabled={disabled}
        onClick={() => setOpen(true)}
        aria-label="Поиск и быстрые действия, Ctrl+K"
      >
        <Search size={16} />
        <span>Найти</span>
        <kbd>Ctrl K</kbd>
      </button>
      <Dialog open={open && !disabled} onOpenChange={setOpen}>
        <DialogContent className="focal-dialog search-dialog">
          <DialogTitle>Поиск и быстрые действия</DialogTitle>
          <DialogDescription>
            Задачи, заметки, события. Введите дату в формате ДД.ММ.ГГГГ, чтобы
            открыть календарь.
          </DialogDescription>
          <Command shouldFilter={false}>
            <CommandInput
              value={query}
              onValueChange={setQuery}
              placeholder="Найти или перейти к дате…"
            />
            <CommandList>
              <CommandEmpty>Ничего не найдено.</CommandEmpty>
              <CommandGroup heading="Быстрые действия">
                {commands
                  .filter((c) => !q || c.label.toLocaleLowerCase().includes(q))
                  .map((c) => (
                    <CommandItem
                      key={c.id}
                      value={c.id}
                      onSelect={() => choose(c.run)}
                    >
                      <Plus />
                      {c.label}
                    </CommandItem>
                  ))}
                {validDate && (
                  <CommandItem onSelect={() => choose(() => onDate(date))}>
                    <CalendarDays />
                    Открыть {query}
                  </CommandItem>
                )}
                {[
                  ['task', 'Новая задача'],
                  ['note', 'Новая заметка'],
                  ['event', 'Новое событие'],
                ].map(([kind, label]) => (
                  <CommandItem
                    key={kind}
                    value={'create-' + kind}
                    onSelect={() => choose(() => onCreate(kind))}
                  >
                    <Plus />
                    {label}
                  </CommandItem>
                ))}
              </CommandGroup>
              {tasks.length > 0 && (
                <CommandGroup heading="Задачи">
                  {tasks.map(({ item: t }) => (
                    <CommandItem
                      key={t.id}
                      value={t.id}
                      onSelect={() => choose(() => onTask(t))}
                    >
                      <ListTodo />
                      <span>{t.title}</span>
                      <small>
                        {t.status === 'completed'
                          ? 'Завершена'
                          : t.status === 'active'
                            ? 'В работе'
                            : t.status === 'failed'
                              ? 'Не выполнена'
                              : 'В плане'}
                      </small>
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
              {notes.length > 0 && (
                <CommandGroup heading="Заметки">
                  {notes.map(({ item: n }) => (
                    <CommandItem
                      key={n.id}
                      value={n.id}
                      onSelect={() => choose(() => onNote(n))}
                    >
                      <FileText />
                      <span>{n.title}</span>
                      <small>{n.note_date}</small>
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
              {events.length > 0 && (
                <CommandGroup heading="События">
                  {events.map(({ item: e }) => (
                    <CommandItem
                      key={e.id}
                      value={e.id}
                      onSelect={() => choose(() => onEvent(e))}
                    >
                      <CalendarDays />
                      <span>{e.title}</span>
                      <small>
                        {new Date(e.start_at).toLocaleString('ru-RU', {
                          day: 'numeric',
                          month: 'short',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </small>
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
            </CommandList>
          </Command>
        </DialogContent>
      </Dialog>
    </>
  );
}
