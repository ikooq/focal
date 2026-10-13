import { existsSync, mkdirSync, cpSync, renameSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';

export function localPaths(root = process.cwd(), env = process.env) {
  const folder =
    env.FOCAL_DATA_DIR ||
    join(
      env.LOCALAPPDATA || join(homedir(), '.local', 'share'),
      'focal',
      'data',
    );
  const database = env.FOCAL_DATA_PATH || join(folder, 'focal.sqlite');
  const legacy = resolve(root, 'data/focal.sqlite');
  if (!env.FOCAL_DATA_PATH && !existsSync(database) && existsSync(legacy)) {
    mkdirSync(folder, { recursive: true });
    const source = new DatabaseSync(legacy, { readOnly: true });
    try {
      source.prepare('VACUUM INTO ?').run(database);
    } finally {
      source.close();
    }
  }
  if (!env.FOCAL_DATA_PATH)
    for (const name of ['models', 'voice-env']) {
      const source = resolve(root, 'data', name),
        target = resolve(folder, name);
      if (existsSync(source) && !existsSync(target)) {
        mkdirSync(folder, { recursive: true });
        const staging = resolve(folder, `${name}.import-${randomUUID()}`);
        console.log(`focal: перенос ${name} в каталог пользователя…`);
        cpSync(source, staging, { recursive: true });
        renameSync(staging, target);
      }
    }
  // Models are optional and can be installed independently of the executable.
  const support =
    env.FOCAL_SUPPORT_DIR ||
    (existsSync(join(folder, 'models'))
      ? folder
      : existsSync(join(root, 'data/models'))
        ? join(root, 'data')
        : folder);
  return { database, support, folder };
}
