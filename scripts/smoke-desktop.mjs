import { _electron as electron } from 'playwright';
import { createServer } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';

// Do not attach to a user's running server: this check requires an isolated port.
const probe = createServer();
await new Promise((resolve, reject) => {
  probe.once('error', reject);
  probe.listen(3000, '127.0.0.1', resolve);
});
await new Promise((resolve) => probe.close(resolve));
const temporary = mkdtempSync(join(tmpdir(), 'focal-desktop-'));
let application;
try {
  const env = {
    ...process.env,
    FOCAL_DATA_PATH: join(temporary, 'test.sqlite'),
    FOCAL_SUPPORT_DIR: temporary,
  };
  delete env.ELECTRON_RUN_AS_NODE;
  application = await electron.launch({
    executablePath: resolve('desktop-release/win-unpacked/focal.exe'),
    args: ['--background'],
    env,
    timeout: 60000,
  });
  const page = await application.firstWindow({ timeout: 60000 });
  await page
    .getByRole('heading', { name: 'Три главных дела', exact: false })
    .waitFor({ timeout: 60000 });
  const settings = await page.evaluate(() => window.focalDesktop.settings());
  assert.equal(typeof settings.openAtLogin, 'boolean');
  const state = await page.evaluate(
    async () => await (await fetch('/api/state')).json(),
  );
  assert.equal(state.app_version, 6);
  assert.equal(state.tasks.length, 0);
  const appPath = await application.evaluate(({ app }) => app.getAppPath());
  assert.ok(appPath.includes('win-unpacked'));
  await page.evaluate(() => window.focalDesktop.openCapture());
  const capture = application
    .windows()
    .find((p) => p.url().endsWith('/capture'));
  assert.ok(capture, 'Native capture window was created');
  await capture
    .getByLabel('Быстрый ввод', { exact: true })
    .fill('Быстрый ввод из Windows');
  await capture.getByLabel('Быстрый ввод', { exact: true }).press('Enter');
  await capture.getByText('Сохранено', { exact: true }).waitFor();
  const updated = await page.evaluate(
    async () => await (await fetch('/api/state')).json(),
  );
  assert.equal(updated.tasks[0].title, 'Быстрый ввод из Windows');
  assert.equal(updated.tasks.length, 1);
  await page.evaluate(() => window.focalDesktop.openCapture());
  await capture.bringToFront();
  await capture.getByLabel('Быстрый ввод', { exact: true }).waitFor();
  await capture
    .getByRole('button', { name: 'Мысль', exact: true })
    .click({ force: true });
  await capture
    .getByLabel('Быстрый ввод', { exact: true })
    .fill('Мысль из Windows', { force: true });
  await capture
    .getByLabel('Быстрый ввод', { exact: true })
    .press('Enter', { force: true });
  await capture.getByText('Сохранено', { exact: true }).waitFor();
  const thoughts = await page.evaluate(
    async () => await (await fetch('/api/state')).json(),
  );
  assert.equal(thoughts.thoughts[0].body, 'Мысль из Windows');
  console.log(
    'Packaged desktop OK: independent server, native bridge, task/thought capture in a separate window.',
  );
} finally {
  await application?.close();
  rmSync(temporary, { recursive: true, force: true, maxRetries: 5 });
}
