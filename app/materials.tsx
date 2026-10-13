'use client';
import { useEffect, useState } from 'react';
import { Paperclip, Trash2, ExternalLink } from 'lucide-react';
import type { Material, Mutate } from '@/lib/domain';
export default function Materials({
  taskId,
  noteId,
  mutate,
}: {
  taskId?: string;
  noteId?: string;
  mutate: Mutate;
}) {
  const [rows, setRows] = useState<Material[]>([]),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [url, setUrl] = useState(''),
    [title, setTitle] = useState('');
  const params = new URLSearchParams(
    taskId ? { task_id: taskId } : { note_id: noteId || '' },
  ).toString();
  useEffect(() => {
    let live = true;
    void fetch('/api/resources?' + params)
      .then((r) => r.json())
      .then((v) => {
        if (live && Array.isArray(v)) setRows(v);
      })
      .catch(() => {
        if (live) setError('Не удалось загрузить материалы.');
      });
    return () => {
      live = false;
    };
  }, [params]);
  const reload = async () => {
    const r = await fetch('/api/resources?' + params);
    if (r.ok) setRows(await r.json());
  };
  return (
    <section className="materials">
      <h3>
        <Paperclip size={16} /> Материалы
      </h3>
      {rows.map((r) => (
        <div className="material-row" key={r.id}>
          <a
            href={r.url || `/api/resource?id=${r.id}`}
            target={r.url ? '_blank' : undefined}
            rel="noreferrer"
          >
            <ExternalLink size={14} />
            {r.title}
          </a>
          <small>{r.size ? `${Math.ceil(r.size / 1024)} КБ` : 'Ссылка'}</small>
          <button
            type="button"
            className="subtle"
            aria-label={`Удалить ${r.title}`}
            disabled={busy}
            onClick={async () => {
              if (await mutate({ action: 'resource.delete', id: r.id }))
                await reload();
            }}
          >
            <Trash2 size={14} />
          </button>
        </div>
      ))}
      <div className="inline-fields">
        <input
          aria-label="Название материала"
          placeholder="Название"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={160}
        />
        <input
          aria-label="Ссылка на материал"
          placeholder="https://…"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          type="url"
        />
        <button
          type="button"
          className="secondary"
          disabled={!url || !title || busy}
          onClick={async () => {
            if (
              await mutate({
                action: 'resource.link',
                title,
                url,
                task_id: taskId,
                note_id: noteId,
              })
            ) {
              setTitle('');
              setUrl('');
              await reload();
            }
          }}
        >
          Добавить
        </button>
      </div>
      <label className="subtle file-button">
        <Paperclip size={15} />
        {busy ? 'Сохраняю…' : 'Прикрепить файл · до 8 МБ'}
        <input
          type="file"
          disabled={busy}
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (!f) return;
            setBusy(true);
            setError('');
            try {
              const r = await fetch(
                `/api/resource/upload?${params}&title=${encodeURIComponent(f.name)}`,
                {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/octet-stream' },
                  body: f,
                },
              );
              const v = (await r.json()) as { error?: string };
              if (!r.ok) throw Error(v.error || 'Не удалось загрузить файл');
              await reload();
            } catch (err) {
              setError(
                err instanceof Error
                  ? err.message
                  : 'Не удалось сохранить файл.',
              );
            } finally {
              setBusy(false);
            }
          }}
        />
      </label>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
