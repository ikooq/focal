import { mkdirSync, readdirSync, unlinkSync } from 'node:fs';
import { dirname, join, isAbsolute, resolve } from 'node:path';

export function autoBackups(db, path, clock) {
  let lastDay = '',
    nextAttempt = 0,
    status = { last_at: null, error: null, folder: null };
  return {
    run(settings = {}) {
      if (path === ':memory:' || settings.auto_backup === false) return status;
      const day = new Date(clock()).toISOString().slice(0, 10);
      if (clock() < nextAttempt) return status;
      const folder = settings.backup_folder || join(dirname(path), 'backups');
      if (day === lastDay && status.folder === folder) return status;
      try {
        if (!isAbsolute(folder))
          throw Error('Выберите абсолютный путь для резервных копий.');
        mkdirSync(folder, { recursive: true });
        const existing = readdirSync(folder)
          .filter(
            (f) =>
              f.startsWith(`auto-focal-${day}-`) &&
              /^auto-focal-\d{4}-\d{2}-\d{2}-\d+\.sqlite$/.test(f),
          )
          .sort()
          .at(-1);
        if (existing) {
          lastDay = day;
          status = {
            last_at: new Date(
              Number(existing.match(/-(\d+)\.sqlite$/)[1]),
            ).toISOString(),
            error: null,
            folder,
          };
          return status;
        }
        const name = `auto-focal-${day}-${clock()}.sqlite`;
        db.prepare('VACUUM INTO ?').run(join(folder, name));
        const files = readdirSync(folder)
          .filter((f) => /^auto-focal-\d{4}-\d{2}-\d{2}-\d+\.sqlite$/.test(f))
          .sort()
          .reverse();
        for (const file of files.slice(14)) {
          const target = resolve(folder, file);
          if (dirname(target) !== resolve(folder))
            throw Error('Некорректный путь копии.');
          unlinkSync(target);
        }
        lastDay = day;
        status = {
          last_at: new Date(clock()).toISOString(),
          error: null,
          folder,
        };
      } catch (error) {
        status = {
          ...status,
          folder,
          error:
            error instanceof Error
              ? error.message
              : 'Не удалось создать копию.',
        };
        nextAttempt = clock() + 60000;
      }
      return status;
    },
    status: () => status,
  };
}
