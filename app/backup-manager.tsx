'use client';
import { useState } from 'react';
import { Download, Upload, ShieldCheck } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import type { State, Mutate } from '@/lib/domain';
type Preview = {
  token: string;
  username: string;
  counts: Record<string, number>;
  expires_at: string;
  error?: string;
};
export default function BackupManager({
  data,
  mutate,
  busy,
  error,
  close,
  onRestored,
}: {
  data: State;
  mutate: Mutate;
  busy: boolean;
  error: string;
  close: () => void;
  onRestored: () => void;
}) {
  const [preview, setPreview] = useState<Preview | null>(null),
    [checking, setChecking] = useState(false),
    [localError, setLocalError] = useState(''),
    [filename, setFilename] = useState(''),
    [confirmed, setConfirmed] = useState(false);
  const labels: Record<string, string> = {
    tasks: 'Задачи',
    notes: 'Заметки',
    calendar_events: 'События',
    focus_sessions: 'Сессии',
    financial_transactions: 'Операции',
    week_templates: 'Шаблоны',
    projects: 'Проекты',
    habits: 'Привычки',
    decisions: 'Решения',
    resources: 'Материалы',
    work_checkpoints: 'Точки продолжения',
    focus_thoughts: 'Мысли',
    recurring_flows: 'Регулярные платежи',
  };
  async function check(file?: File) {
    setPreview(null);
    setConfirmed(false);
    setLocalError('');
    if (!file) return;
    setFilename(file.name);
    if (file.size > 50 * 1024 * 1024) {
      setLocalError('Максимальный размер файла — 50 МБ.');
      return;
    }
    setChecking(true);
    try {
      const response = await fetch('/api/restore/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: file,
      });
      const result = (await response.json()) as Preview;
      if (!response.ok)
        throw new Error(result.error || 'Не удалось проверить файл.');
      setPreview(result);
    } catch (e) {
      setLocalError(
        e instanceof Error ? e.message : 'Не удалось проверить файл.',
      );
    } finally {
      setChecking(false);
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy && !checking) close();
      }}
    >
      <DialogContent className="focal-dialog tools-dialog">
        <DialogTitle>Резервные копии</DialogTitle>
        <DialogDescription>
          Сохраните все данные приложения или восстановите их из проверенной
          копии.
        </DialogDescription>
        <a href="/api/backup" className="secondary backup-download" download>
          <Download size={17} />
          Скачать текущую базу
        </a>
        <label className="backup-upload">
          <Upload size={22} />
          <strong>
            {checking ? 'Проверяем файл…' : 'Выбрать копию SQLite'}
          </strong>
          <span>{filename || 'Файл .sqlite или .db, до 50 МБ'}</span>
          <input
            aria-label="Резервная копия SQLite"
            type="file"
            accept=".sqlite,.db,.sqlite3,application/vnd.sqlite3"
            disabled={busy || checking}
            onChange={(e) => void check(e.target.files?.[0])}
          />
        </label>
        {preview && (
          <>
            <div className="backup-verified">
              <ShieldCheck size={19} />
              <span>Копия проверена · {preview.username}</span>
            </div>
            <div className="backup-counts">
              {Object.entries(preview.counts).map(([key, n]) => (
                <div key={key}>
                  <span>{labels[key] || key}</span>
                  <strong>{n}</strong>
                </div>
              ))}
            </div>
            <p className="restore-warning">
              Сейчас в приложении {data.tasks.length} задач, {data.notes.length}{' '}
              заметок и {data.events.length} событий. Восстановление заменит все
              текущие данные содержимым копии. Перед заменой приложение
              автоматически сохранит текущую базу в папке резервных копий.
            </p>
            <p className="footnote">
              Таймеры и сроки пересчитаются по текущему времени. Проверка
              действует 15 минут.
            </p>
            <label className="check-label">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
              />
              Заменить текущие данные этой копией
            </label>
            <button
              className="primary"
              disabled={busy || !confirmed || checking}
              onClick={async () => {
                if (
                  await mutate(
                    { action: 'backup.restore', token: preview.token },
                    'Данные восстановлены. Предыдущая база сохранена в резервных копиях.',
                  )
                )
                  onRestored();
              }}
            >
              {busy ? 'Восстанавливаем…' : 'Восстановить данные'}
            </button>
          </>
        )}
        {(localError || error) && (
          <p role="alert" className="form-error">
            {localError || error}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
