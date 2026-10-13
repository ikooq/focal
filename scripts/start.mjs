import { localPaths } from '../server/local-paths.mjs';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { localApi } from '../server/api.mjs';

process.chdir(fileURLToPath(new URL('..', import.meta.url)));
if (!existsSync('dist/server/index.js')) {
  console.error('Сначала соберите приложение: npm run build');
  process.exit(1);
}
const paths = localPaths();
process.env.FOCAL_DATA_PATH = paths.database;
process.env.FOCAL_SUPPORT_DIR = paths.support;
process.env.NODE_ENV = 'production';
const { startProdServer } = await import('vinext/server/prod-server');
const { server, port } = await startProdServer({
  host: '127.0.0.1',
  port: Number(process.env.PORT || 3000),
});
// Use the same API in development and production; all non-API requests retain
// the framework's production handler (SSR, assets, compression, caching).
localApi().configureServer({
  httpServer: server,
  middlewares: {
    use(prefix, handler) {
      const original = server.listeners('request');
      server.removeAllListeners('request');
      server.on('request', (req, res) => {
        if (req.url?.startsWith(`${prefix}/`)) {
          req.url = req.url.slice(prefix.length);
          void handler(req, res);
        } else for (const listener of original) listener.call(server, req, res);
      });
    },
  },
});
console.log(`focal. — http://127.0.0.1:${port}/`);
for (const signal of ['SIGINT', 'SIGTERM'])
  process.once(signal, () => server.close(() => process.exit(0)));
