import {
  app,
  BrowserWindow,
  Tray,
  Menu,
  Notification,
  ipcMain,
  nativeImage,
  shell,
  dialog,
  globalShortcut,
} from 'electron';
import { spawn } from 'node:child_process';
import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  appendFileSync,
} from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = dirname(fileURLToPath(import.meta.url));
let win,
  capture,
  tray,
  server,
  ollama,
  quitting = false,
  recovering = false,
  poll;
const origin = 'http://127.0.0.1:3000';
const root = resolve(__dirname, '..');
const support = join(
  process.env.LOCALAPPDATA || app.getPath('appData'),
  'focal',
  'data',
);
const logFolder = join(
  process.env.LOCALAPPDATA || app.getPath('appData'),
  'focal',
  'logs',
);
mkdirSync(logFolder, { recursive: true });
const logFile = join(logFolder, 'startup.log');
function log(message) {
  appendFileSync(
    logFile,
    new Date().toISOString() + ' ' + String(message) + '\n',
  );
}
function icon() {
  const size = 32,
    bytes = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4,
        r = Math.hypot(x - 15.5, y - 15.5),
        green = (r > 9 && r < 12) || r < 3;
      bytes[i] = green ? 16 : 8;
      bytes[i + 1] = green ? 185 : 15;
      bytes[i + 2] = green ? 129 : 12;
      bytes[i + 3] = 255;
    }
  return nativeImage.createFromBitmap(bytes, { width: size, height: size });
}
const show = () => {
  if (win) {
    win.show();
    win.focus();
  }
};
function trusted(event) {
  if (!event.senderFrame?.url.startsWith(origin + '/'))
    throw Error('Unknown sender');
}
function settings() {
  return {
    captureShortcut: globalShortcut.isRegistered(
      'CommandOrControl+Shift+Space',
    ),
    openAtLogin: app.getLoginItemSettings({
      path: process.execPath,
      args: ['--background'],
    }).openAtLogin,
  };
}
async function readyServer() {
  try {
    const r = await fetch(origin + '/api/state', {
      signal: AbortSignal.timeout(1500),
    });
    if (r.ok && (await r.json()).app_version === 6) return;
  } catch {}
  const port = 3000;
  server = spawn(process.execPath, [join(root, 'scripts/start.mjs')], {
    cwd: root,
    windowsHide: true,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      PORT: String(port),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.on('data', (chunk) => log(chunk.toString()));
  server.stderr.on('data', (chunk) => log(chunk.toString()));
  server.on('error', (error) => log(error.message));
  for (let i = 0; i < 100; i++) {
    if (server.exitCode !== null)
      throw Error(
        'Не удалось запустить локальный сервер. Проверьте, свободен ли порт 3000.',
      );
    await new Promise((r) => setTimeout(r, 300));
    try {
      const r = await fetch(origin + '/api/state', {
        signal: AbortSignal.timeout(1000),
      });
      if (r.ok && (await r.json()).app_version === 6) return;
    } catch {}
  }
  throw Error('Локальный сервер не ответил.');
}
let reminderState,
  reminderTag = '';
async function reminders() {
  try {
    const r = await fetch(origin + '/api/state', {
      signal: AbortSignal.timeout(5000),
      headers: reminderTag ? { 'If-None-Match': reminderTag } : {},
    });
    if (r.status !== 304) {
      if (!r.ok) throw Error('Локальный сервер недоступен.');
      reminderState = await r.json();
      reminderTag = r.headers.get('ETag') || '';
    }
    const data = reminderState,
      now = Date.now();
    if (!data) return;
    if (
      data.sessions.some((s) =>
        ['preparation', 'work', 'break'].includes(s.phase),
      )
    )
      return;
    let seen = {};
    const file = join(app.getPath('userData'), 'reminders.json');
    try {
      seen = JSON.parse(readFileSync(file, 'utf8'));
    } catch {}
    for (const e of data.events) {
      if (e.completed_at || now >= Date.parse(e.end_at)) continue;
      const start = Date.parse(e.start_at),
        trigger = e.snoozed_until
          ? Date.parse(e.snoozed_until)
          : now >= start
            ? start
            : start - (e.reminder_minutes || 0) * 60000;
      if (
        now < trigger ||
        now - trigger > 90000 ||
        (e.reminder_dismissed_at &&
          Date.parse(e.reminder_dismissed_at) >= trigger)
      )
        continue;
      const key = `${e.id}:${e.start_at}:${trigger}`;
      if (seen[key]) continue;
      seen[key] = now;
      if (Notification.isSupported()) {
        const claim = await fetch(origin + '/api/reminder/claim', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: e.id, trigger }),
        });
        if (!claim.ok || !(await claim.json()).claimed) continue;
        const n = new Notification({
          title:
            now < start
              ? `focal · Через ${Math.ceil((start - now) / 60000)} мин.`
              : 'focal · Время по плану',
          body: e.title,
          icon: icon(),
          silent: false,
        });
        n.on('click', () => {
          void win.loadURL(origin + '/#calendar');
          show();
        });
        n.show();
      }
    }
    writeFileSync(
      file,
      JSON.stringify(
        Object.fromEntries(
          Object.entries(seen).filter(([, at]) => now - at < 7 * 86400000),
        ),
      ),
    );
  } catch {
    if (!quitting && !recovering && (!server || server.exitCode !== null)) {
      recovering = true;
      try {
        await readyServer();
      } catch {
      } finally {
        recovering = false;
      }
    }
  }
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', show);
  app.on('window-all-closed', () => {});
  app.on('before-quit', () => {
    quitting = true;
    globalShortcut.unregisterAll();
    clearInterval(poll);
    server?.kill();
    ollama?.kill();
  });
  void app.whenReady().then(async () => {
    app.setAppUserModelId('local.focal.desktop');
    if (app.isPackaged) {
      const link = join(
        app.getPath('appData'),
        'Microsoft/Windows/Start Menu/Programs/focal — Focus app.lnk',
      );
      if (
        !existsSync(link) ||
        shell.readShortcutLink(link).target === process.execPath
      )
        shell.writeShortcutLink(link, existsSync(link) ? 'update' : 'create', {
          target: process.execPath,
          cwd: root,
          description: 'focal — локальное пространство внимания',
          appUserModelId: 'local.focal.desktop',
        });
    }
    try {
      await fetch('http://127.0.0.1:11434/api/tags', {
        signal: AbortSignal.timeout(1000),
      });
    } catch {
      const exe = join(
        process.env.LOCALAPPDATA || '',
        'Programs/Ollama/ollama.exe',
      );
      if (existsSync(exe))
        ollama = spawn(exe, ['serve'], { windowsHide: true, stdio: 'ignore' });
    }
    try {
      await readyServer();
    } catch (e) {
      log(e.message);
      dialog.showErrorBox(
        'Не удалось открыть focal',
        e.message +
          '\n\nЖурнал запуска: ' +
          logFile +
          '\nДанные сохранены в: ' +
          support,
      );
      app.quit();
      return;
    }
    win = new BrowserWindow({
      width: 1440,
      height: 960,
      minWidth: 390,
      minHeight: 600,
      backgroundColor: '#080a09',
      title: 'focal',
      icon: icon(),
      show: false,
      autoHideMenuBar: true,
      webPreferences: {
        preload: join(__dirname, 'preload.cjs'),
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
      },
    });
    win.on('close', (e) => {
      if (!quitting) {
        e.preventDefault();
        win.hide();
      }
    });
    win.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https?:\/\//.test(url)) void shell.openExternal(url);
      return { action: 'deny' };
    });
    win.webContents.on('will-navigate', (e, url) => {
      if (!url.startsWith(origin + '/')) {
        e.preventDefault();
        if (/^https?:\/\//.test(url)) void shell.openExternal(url);
      }
    });
    win.webContents.session.setPermissionRequestHandler(
      (contents, permission, callback, details) =>
        callback(
          contents === win.webContents &&
            details.requestingUrl.startsWith(origin + '/') &&
            permission === 'media',
        ),
    );
    ipcMain.handle('focal:backup-folder', async (e) => {
      trusted(e);
      const result = await dialog.showOpenDialog(win, {
        title: 'Папка резервных копий',
        properties: ['openDirectory', 'createDirectory'],
      });
      return result.canceled ? null : result.filePaths[0];
    });
    ipcMain.handle('focal:settings', (e) => {
      trusted(e);
      return settings();
    });
    async function showCapture() {
      if (!capture || capture.isDestroyed()) {
        capture = new BrowserWindow({
          width: 620,
          height: 350,
          minWidth: 390,
          minHeight: 320,
          show: false,
          alwaysOnTop: true,
          autoHideMenuBar: true,
          title: 'focal · Быстрый ввод',
          backgroundColor: '#080a09',
          icon: icon(),
          webPreferences: {
            preload: join(__dirname, 'preload.cjs'),
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true,
          },
        });
        capture.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
        capture.webContents.on('will-navigate', (e, url) => {
          if (url !== origin + '/capture') e.preventDefault();
        });
        capture.on('close', (e) => {
          if (!quitting) {
            e.preventDefault();
            capture.hide();
          }
        });
        await capture.loadURL(origin + '/capture');
      }
      capture.show();
      capture.focus();
    }
    ipcMain.handle('focal:capture-close', (e) => {
      trusted(e);
      if (e.sender === capture?.webContents) capture.hide();
    });
    ipcMain.handle('focal:capture-open', (e) => {
      trusted(e);
      return showCapture();
    });
    if (
      !globalShortcut.register(
        'CommandOrControl+Shift+Space',
        () => void showCapture(),
      )
    )
      log(
        'Ctrl+Shift+Space занят другим приложением. Быстрый ввод доступен в трее.',
      );
    ipcMain.handle('focal:login', (e, enabled) => {
      trusted(e);
      if (typeof enabled !== 'boolean') throw Error('Invalid value');
      app.setLoginItemSettings({
        openAtLogin: enabled,
        path: process.execPath,
        args: ['--background'],
      });
      return settings();
    });
    tray = new Tray(icon());
    tray.setToolTip('focal · ваши планы под рукой');
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: 'Открыть focal', click: show },
        {
          label: 'Быстрый ввод · Ctrl+Shift+Space',
          click: () => void showCapture(),
        },
        {
          label: 'Открыть в браузере',
          click: () => void shell.openExternal(origin),
        },
        { type: 'separator' },
        { label: 'Выйти и отключить напоминания', click: () => app.quit() },
      ]),
    );
    tray.on('double-click', show);
    await win.loadURL(origin);
    if (!process.argv.includes('--background')) show();
    poll = setInterval(() => void reminders(), 15000);
    void reminders();
  });
}
