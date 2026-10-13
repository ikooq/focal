import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
const temporary = mkdtempSync(join(tmpdir(), 'focal-browser-'));
const child = spawn(process.execPath, ['scripts/start.mjs'], {
  stdio: 'inherit',
  env: {
    ...process.env,
    PORT: '3107',
    FOCAL_DATA_PATH: join(temporary, 'test.sqlite'),
  },
});
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, () => child.kill());
child.on('exit', (code) => {
  rmSync(temporary, { recursive: true, force: true, maxRetries: 5 });
  process.exit(code || 0);
});
