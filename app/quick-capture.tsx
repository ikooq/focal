'use client';
import { useEffect, useState, useRef } from 'react';
import { Plus, Check, Focus } from 'lucide-react';
import { type Mutate, type State } from '@/lib/domain';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
export function CaptureForm({
  mutate,
  onDone,
}: {
  mutate: Mutate;
  onDone: () => void;
}) {
  const [kind, setKind] = useState('task'),
    [body, setBody] = useState(''),
    [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const focus = () => inputRef.current?.focus();
    focus();
    window.addEventListener('focus', focus);
    return () => window.removeEventListener('focus', focus);
  }, []);
  return (
    <form
      className="capture-form"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        const result = await mutate(
          kind === 'task'
            ? {
                action: 'task.save',
                title: body,
                brain_hemisphere: 'analytical',
                required_energy: 5,
                penalty_amount: '0',
                estimated_minutes: 30,
              }
            : { action: 'thought.add', body },
          kind === 'task' ? 'Задача сохранена' : 'Мысль во входящих',
        );
        setBusy(false);
        if (result) {
          setBody('');
          onDone();
        }
      }}
    >
      <div className="segmented">
        <button
          type="button"
          className={kind === 'task' ? 'selected' : ''}
          onClick={() => setKind('task')}
        >
          Задача
        </button>
        <button
          type="button"
          className={kind === 'thought' ? 'selected' : ''}
          onClick={() => setKind('thought')}
        >
          Мысль
        </button>
      </div>
      <label className="field">
        <span>
          {kind === 'task' ? 'Что нужно сделать?' : 'Что хотите запомнить?'}
        </span>
        <input
          ref={inputRef}
          aria-label="Быстрый ввод"
          value={body}
          maxLength={kind === 'task' ? 160 : 5000}
          required
          placeholder="Запишите, пока не забыли…"
          onChange={(e) => setBody(e.target.value)}
        />
      </label>
      <div className="capture-footer">
        <span className="muted">Enter — сохранить · Esc — закрыть</span>
        <button className="primary" disabled={busy || !body.trim()}>
          <Plus size={16} />
          Сохранить
        </button>
      </div>
    </form>
  );
}
export default function QuickCapture({
  open,
  setOpen,
  mutate,
}: {
  open: boolean;
  setOpen: (open: boolean) => void;
  mutate: Mutate;
}) {
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="focal-dialog">
        <DialogTitle>Быстрый ввод</DialogTitle>
        <DialogDescription>
          Задача попадёт в общий список, мысль — в «Ещё → Входящие».
        </DialogDescription>
        <CaptureForm mutate={mutate} onDone={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}
export function CaptureWindow() {
  const [error, setError] = useState(''),
    [saved, setSaved] = useState(false);
  const pending = useRef<{ body: string; id: string } | null>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') void window.focalDesktop?.closeCapture?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const mutate: Mutate = async (payload) => {
    setError('');
    const body = JSON.stringify(payload);
    if (pending.current?.body !== body)
      pending.current = { body, id: crypto.randomUUID() };
    try {
      const response = await fetch('/api/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, request_id: pending.current.id }),
      });
      const result = (await response.json()) as State & { error?: string };
      pending.current = null;
      if (!response.ok) throw new Error(result.error || 'Не удалось сохранить');
      return result;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось сохранить');
      return null;
    }
  };
  return (
    <main className="capture-window">
      <header>
        <Focus size={24} />
        <strong>
          focal<span>.</span>
        </strong>
        <span className="muted">Быстрый ввод</span>
      </header>
      {saved ? (
        <div className="capture-success">
          <Check />
          Сохранено
        </div>
      ) : (
        <CaptureForm
          mutate={mutate}
          onDone={() => {
            setSaved(true);
            setTimeout(() => {
              setSaved(false);
              void window.focalDesktop?.closeCapture?.();
            }, 400);
          }}
        />
      )}
      {error && (
        <p role="alert" className="error-text">
          {error}
        </p>
      )}
    </main>
  );
}
