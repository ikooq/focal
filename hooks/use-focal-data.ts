'use client';
import { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import type { State } from '@/lib/domain';

export function useFocalData(onFirstSession: (id: string | null) => void) {
  const [data, setData] = useState<State | null>(null);
  const [now, setNow] = useState<Date | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const saving = useRef(false),
    version = useRef(0),
    first = useRef(true),
    etag = useRef(''),
    serverOffset = useRef(0);
  const pending = useRef<{ body: string; id: string } | null>(null);
  const accept = useCallback(
    (result: State) => {
      serverOffset.current = Date.parse(result.server_now) - Date.now();
      setData(result);
      setNow(new Date(result.server_now));
      if (first.current) {
        first.current = false;
        onFirstSession(
          result.sessions.find((s) =>
            ['preparation', 'work', 'break'].includes(s.phase),
          )?.id || null,
        );
      }
    },
    [onFirstSession],
  );
  const refresh = useCallback(async () => {
    if (saving.current) return;
    const request = ++version.current;
    try {
      const response = await fetch('/api/state', {
        headers: etag.current ? { 'If-None-Match': etag.current } : {},
      });
      if (response.status === 304) {
        if (request === version.current) setError('');
        return;
      }
      if (!response.ok) throw Error('Не удалось загрузить данные.');
      const result = (await response.json()) as State;
      if (request === version.current) {
        etag.current = response.headers.get('ETag') || '';
        accept(result);
        setError('');
      }
    } catch (e) {
      if (request === version.current)
        setError(
          e instanceof Error ? e.message : 'Нет связи с локальной базой.',
        );
    }
  }, [accept]);
  const mutate = useCallback(
    async (payload: Record<string, unknown>, message = 'Сохранено') => {
      if (saving.current) return null;
      saving.current = true;
      version.current++;
      setBusy(true);
      setError('');
      const body = JSON.stringify(payload);
      if (pending.current?.body !== body)
        pending.current = { body, id: crypto.randomUUID() };
      try {
        const response = await fetch('/api/action', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...payload, request_id: pending.current!.id }),
        });
        const result = (await response.json()) as State & { error?: string };
        pending.current = null;
        if (!response.ok) throw Error(result.error || 'Не удалось сохранить.');
        etag.current = '';
        accept(result);
        setNotice(message);
        return result;
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Не удалось сохранить.');
        return null;
      } finally {
        saving.current = false;
        setBusy(false);
      }
    },
    [accept],
  );
  useEffect(() => {
    const initial = setTimeout(() => void refresh(), 0);
    const poll = setInterval(() => {
      if (!document.hidden) void refresh();
    }, 15000);
    const minute = setInterval(
      () => setNow(new Date(Date.now() + serverOffset.current)),
      60000,
    );
    const wake = () => {
      if (!document.hidden) void refresh();
    };
    document.addEventListener('visibilitychange', wake);
    return () => {
      clearTimeout(initial);
      clearInterval(poll);
      clearInterval(minute);
      document.removeEventListener('visibilitychange', wake);
    };
  }, [refresh]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(''), 4000);
    return () => clearTimeout(timer);
  }, [notice]);
  const currentData = useMemo(
    () => (data && now ? { ...data, server_now: now.toISOString() } : data),
    [data, now],
  );
  return {
    data: currentData,
    now,
    busy,
    error,
    setError,
    notice,
    setNotice,
    refresh,
    mutate,
    serverOffset,
  };
}
