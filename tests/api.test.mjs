import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { localApi } from '../server/api.mjs';

test('HTTP flow preserves Unicode, previews SQLite restore, rejects foreign origins and retries restore safely', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'focal-api-'));
  let middleware;
  const server = createServer((req, res) => {
    req.url = req.url.slice(4);
    void middleware(req, res);
  });
  localApi(join(folder, 'test.sqlite')).configureServer({
    httpServer: server,
    middlewares: {
      use(prefix, handler) {
        assert.equal(prefix, '/api');
        middleware = handler;
      },
    },
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const action = async (data) => {
    const response = await fetch(origin + '/api/action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: origin },
      body: JSON.stringify(data),
    });
    assert.equal(response.status, 200);
    return response.json();
  };
  try {
    const initial = await fetch(origin + '/api/state');
    const etag = initial.headers.get('etag');
    assert.ok(etag);
    assert.equal(
      (
        await fetch(origin + '/api/state', {
          headers: { 'If-None-Match': etag },
        })
      ).status,
      304,
    );
    const text = 'Мысль💡\n'.repeat(4000);
    let state = await action({
      action: 'note.save',
      title: 'Длинная заметка',
      body: text,
      note_date: '2026-09-06',
    });
    assert.equal(state.notes[0].body, text);
    assert.equal(
      (
        await fetch(origin + '/api/state', {
          headers: { 'If-None-Match': etag },
        })
      ).status,
      200,
    );
    const backup = await fetch(origin + '/api/backup');
    assert.equal(backup.headers.get('content-type'), 'application/vnd.sqlite3');
    const bytes = await backup.arrayBuffer();
    const previewResponse = await fetch(origin + '/api/restore/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream', Origin: origin },
      body: bytes,
    });
    assert.equal(previewResponse.status, 200);
    const preview = await previewResponse.json();
    assert.equal(preview.counts.notes, 1);
    await action({
      action: 'note.save',
      title: 'После копии',
      body: '',
      note_date: '2026-09-06',
    });
    state = await action({ action: 'backup.restore', token: preview.token });
    assert.equal(state.notes.length, 1);
    assert.equal(state.notes[0].body, text);
    assert.equal(
      (await action({ action: 'backup.restore', token: preview.token })).notes
        .length,
      1,
    );
    const denied = await fetch(origin + '/api/restore/preview', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        Origin: 'https://unrelated.example',
      },
      body: bytes,
    });
    assert.equal(denied.status, 403);
    await denied.text();
    const invalid = await fetch(origin + '/api/restore/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream', Origin: origin },
      body: 'bad database',
    });
    assert.equal(invalid.status, 400);
    await invalid.text();
  } finally {
    await new Promise((resolve) => server.close(resolve));
    rmSync(folder, { recursive: true, force: true, maxRetries: 3 });
  }
});
