import { createHash } from 'node:crypto';
import { createStore } from './store.mjs';
import { localPaths } from './local-paths.mjs';
import { exportICS } from './studio.mjs';
import {
  assistantStatus,
  assistant,
  recognizeImage,
  transcribe,
} from './assistant.mjs';

export function localApi(path) {
  let store;
  return {
    name: 'focal-local-sqlite',
    configureServer(server) {
      path ??= localPaths().database;
      store ??= createStore(path);
      const housekeeping = setInterval(() => {
        try {
          store.revision();
        } catch (error) {
          console.error('focal maintenance:', error);
        }
      }, 60000);
      housekeeping.unref();
      server.httpServer?.once('close', () => {
        clearInterval(housekeeping);
        store.close();
      });
      server.middlewares.use('/api', async (req, res) => {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        const send = (status, data) => {
          res.statusCode = status;
          res.end(JSON.stringify(data));
        };
        if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(req.headers.host || ''))
          return send(403, {
            error: 'Доступ разрешён только с этого устройства.',
          });
        // Bind on loopback and reject cross-origin writes from unrelated websites.
        if (
          req.headers.origin &&
          req.headers.origin !== `http://${req.headers.host}`
        )
          return send(403, { error: 'Запрос с другого сайта запрещен.' });
        try {
          const url = new URL(req.url, 'http://localhost');
          const read = async (max) => {
            const chunks = [];
            let size = 0;
            for await (const chunk of req) {
              size += chunk.length;
              if (size > max) throw Error('Слишком большой файл или запрос.');
              chunks.push(Buffer.from(chunk));
            }
            return Buffer.concat(chunks);
          };
          if (req.method === 'POST' && url.pathname === '/reminder/claim') {
            if (!req.headers['content-type']?.startsWith('application/json'))
              return send(415, { error: 'Ожидается JSON.' });
            return send(
              200,
              store.claimReminder(
                JSON.parse((await read(1000)).toString('utf8')),
              ),
            );
          }
          if (req.method === 'GET' && url.pathname === '/assistant/status')
            return send(200, await assistantStatus());
          if (req.method === 'GET' && url.pathname === '/calendar.ics') {
            res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
            res.setHeader(
              'Content-Disposition',
              'attachment; filename="focal-calendar.ics"',
            );
            return res.end(exportICS(store.snapshot().events));
          }
          if (req.method === 'GET' && url.pathname === '/resources')
            return send(
              200,
              store
                .snapshot()
                .resources.filter(
                  (r) =>
                    (url.searchParams.get('task_id') &&
                      r.task_id === url.searchParams.get('task_id')) ||
                    (url.searchParams.get('note_id') &&
                      r.note_id === url.searchParams.get('note_id')),
                ),
            );
          if (req.method === 'GET' && url.pathname === '/resource') {
            const r = store.resource(url.searchParams.get('id'));
            res.setHeader('Content-Type', 'application/octet-stream');
            res.setHeader('X-Content-Type-Options', 'nosniff');
            res.setHeader(
              'Content-Disposition',
              `attachment; filename*=UTF-8''${encodeURIComponent(r.title)}`,
            );
            return res.end(r.content);
          }
          if (req.method === 'POST' && url.pathname === '/resource/upload')
            return send(
              200,
              store.uploadResource(
                Object.fromEntries(url.searchParams),
                await read(8 * 1024 * 1024),
              ),
            );
          if (req.method === 'POST' && url.pathname === '/ocr')
            return send(200, await recognizeImage(await read(8 * 1024 * 1024)));
          if (req.method === 'POST' && url.pathname === '/transcribe')
            return send(200, await transcribe(await read(20 * 1024 * 1024)));
          if (
            req.method === 'POST' &&
            ['/preview', '/assistant'].includes(url.pathname)
          ) {
            if (!req.headers['content-type']?.startsWith('application/json'))
              return send(415, { error: 'Ожидается JSON.' });
            const input = JSON.parse((await read(2200000)).toString('utf8'));
            return send(
              200,
              url.pathname === '/preview'
                ? store.preview(input)
                : await assistant(input, store.snapshot()),
            );
          }
          if (req.method === 'GET' && req.url === '/backup') {
            const backup = store.backup();
            res.setHeader('Content-Type', 'application/vnd.sqlite3');
            res.setHeader(
              'Content-Disposition',
              `attachment; filename="${backup.name}"`,
            );
            res.end(backup.bytes);
            return;
          }
          if (req.method === 'GET' && req.url === '/state') {
            const etag =
              '"' +
              createHash('sha256').update(store.revision()).digest('hex') +
              '"';
            res.setHeader('ETag', etag);
            if (req.headers['if-none-match'] === etag) {
              res.statusCode = 304;
              return res.end();
            }
            return send(200, store.snapshot());
          }
          if (req.method === 'POST' && req.url === '/restore/preview') {
            if (
              !req.headers['content-type']?.startsWith(
                'application/octet-stream',
              )
            )
              return send(415, { error: 'Ожидается файл SQLite.' });
            const chunks = [];
            let size = 0;
            for await (const chunk of req) {
              const bytes = Buffer.from(chunk);
              size += bytes.length;
              if (size > 50 * 1024 * 1024)
                return send(413, {
                  error: 'Максимальный размер копии — 50 МБ.',
                });
              chunks.push(bytes);
            }
            return send(200, store.inspectBackup(Buffer.concat(chunks)));
          }
          if (req.method === 'POST' && req.url === '/action') {
            if (!req.headers['content-type']?.startsWith('application/json'))
              return send(415, { error: 'Ожидается JSON.' });
            const chunks = [];
            let size = 0;
            for await (const chunk of req) {
              const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
              size += bytes.length;
              chunks.push(bytes);
              if (size > 250000)
                return send(413, { error: 'Слишком большой запрос.' });
            }
            const body = Buffer.concat(chunks).toString('utf8');
            const input = JSON.parse(body);
            return send(
              200,
              input?.action === 'backup.restore'
                ? store.restoreBackup(input.token)
                : store.action(input),
            );
          }
          send(404, { error: 'Не найдено.' });
        } catch (e) {
          send(400, {
            error: e instanceof Error ? e.message : 'Не удалось сохранить.',
          });
        }
      });
    },
  };
}
