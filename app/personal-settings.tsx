'use client';
import { useState, useEffect } from 'react';
import type { State, Mutate, Settings } from '@/lib/domain';

export default function PersonalSettings({
  data,
  mutate,
  busy,
}: {
  data: State;
  mutate: Mutate;
  busy: boolean;
}) {
  const [desktop, setDesktop] = useState(false);
  const [shortcut, setShortcut] = useState<boolean | null>(null);
  useEffect(() => {
    const timer = setTimeout(
      () => setDesktop(!!window.focalDesktop?.chooseBackupFolder),
      0,
    );
    return () => clearTimeout(timer);
  }, []);
  useEffect(() => {
    if (desktop)
      void window.focalDesktop
        ?.settings()
        .then((s) => setShortcut(s.captureShortcut ?? null))
        .catch(() => setShortcut(null));
  }, [desktop]);
  const [folder, setFolder] = useState(data.settings?.backup_folder || '');
  const [optimistic, setOptimistic] = useState<Settings | null>(null);
  const settings = optimistic || data.settings || {};
  async function update(patch: Partial<Settings>) {
    setOptimistic({ ...settings, ...patch });
    await mutate({ action: 'settings.save', ...patch });
    setOptimistic(null);
  }
  return (
    <section className="panel stack-form">
      <h3>Быстрый ввод</h3>
      <p className="muted">
        Ctrl + Shift + Space — записать задачу или мысль. В приложении Windows
        сочетание работает поверх других программ. Быстрый ввод также доступен
        через значок + и меню в трее.
      </p>
      {desktop && shortcut === false && (
        <p className="muted">
          Ctrl + Shift + Space занято другой программой. Используйте быстрый
          ввод через + или меню в трее.
        </p>
      )}
      <h3>Видимые разделы</h3>
      <p className="muted">
        Скрытые разделы сохраняют все данные. Их можно вернуть здесь.
      </p>
      {[
        ['energy', 'Энергия'],
        ['finance', 'Финансы'],
        ['life', 'Привычки и решения'],
        ['studio', 'Помощник'],
      ].map(([id, label]) => (
        <label key={id} className="settings-check">
          <input
            type="checkbox"
            checked={!settings.hidden_sections?.includes(id)}
            disabled={busy}
            onChange={(e) =>
              void update({
                hidden_sections: e.target.checked
                  ? (settings.hidden_sections || []).filter((v) => v !== id)
                  : [...(settings.hidden_sections || []), id],
              })
            }
          />
          {label}
        </label>
      ))}
      {[
        ['habits', 'Привычки'],
        ['decisions', 'Решения'],
      ].map(([id, label]) => (
        <label key={id} className="settings-check">
          <input
            type="checkbox"
            checked={!settings.hidden_life_sections?.includes(id)}
            disabled={busy}
            onChange={(e) =>
              void update({
                hidden_life_sections: e.target.checked
                  ? (settings.hidden_life_sections || []).filter(
                      (v) => v !== id,
                    )
                  : [...(settings.hidden_life_sections || []), id],
              })
            }
          />
          {label} внутри раздела
        </label>
      ))}
      <h3>Автоматические резервные копии</h3>
      <label className="settings-check">
        <input
          type="checkbox"
          checked={settings.auto_backup !== false}
          disabled={busy}
          onChange={(e) => void update({ auto_backup: e.target.checked })}
        />
        Создавать копию ежедневно, пока приложение работает
      </label>
      <p className="muted">
        Храним последние 14 автоматических копий. Ручные копии не удаляются.
      </p>
      <form
        className="stack-form"
        onSubmit={async (e) => {
          e.preventDefault();
          await mutate(
            { action: 'settings.save', backup_folder: folder.trim() },
            'Папка копий сохранена',
          );
        }}
      >
        <label className="field">
          Папка копий
          <input
            value={folder}
            onChange={(e) => setFolder(e.target.value)}
            placeholder="По умолчанию — рядом с базой"
          />
        </label>
        <div className="inline-fields">
          <button className="secondary" disabled={busy}>
            Сохранить папку
          </button>
          <button
            type="button"
            className="subtle"
            hidden={!desktop}
            onClick={async () => {
              const selected =
                await window.focalDesktop?.chooseBackupFolder?.();
              if (selected) setFolder(selected);
            }}
          >
            Выбрать папку в Windows
          </button>
        </div>
      </form>
      {data.auto_backup?.last_at && (
        <p className="muted">
          Последняя копия:{' '}
          {new Date(data.auto_backup.last_at).toLocaleString('ru-RU')}
        </p>
      )}
      {data.auto_backup?.error && (
        <p role="alert">Не удалось создать копию: {data.auto_backup.error}</p>
      )}
    </section>
  );
}
