'use client';
import { useEffect, useRef, useState } from 'react';
import { Mic, Square, ImagePlus } from 'lucide-react';
export async function postJSON<T>(path: string, body: unknown) {
  const r = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const v = (await r.json()) as T & { error?: string };
  if (!r.ok) throw Error(v.error || 'Не удалось выполнить запрос.');
  return v;
}
export function VoiceInput({ onText }: { onText: (text: string) => void }) {
  const [recording, setRecording] = useState(false),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState('');
  const recorder = useRef<MediaRecorder | null>(null),
    stream = useRef<MediaStream | null>(null),
    limit = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (limit.current) clearTimeout(limit.current);
      if (recorder.current?.state === 'recording') {
        recorder.current.onstop = null;
        recorder.current.stop();
      }
      stream.current?.getTracks().forEach((t) => t.stop());
    },
    [],
  );
  async function start() {
    try {
      if (!navigator.mediaDevices || typeof MediaRecorder === 'undefined')
        throw Error('Запись звука не поддерживается этим браузером.');
      stream.current = await navigator.mediaDevices.getUserMedia({
        audio: true,
      });
      const r = new MediaRecorder(stream.current);
      recorder.current = r;
      const parts: Blob[] = [];
      r.ondataavailable = (e) => parts.push(e.data);
      r.onstop = async () => {
        if (limit.current) clearTimeout(limit.current);
        stream.current?.getTracks().forEach((t) => t.stop());
        setRecording(false);
        setBusy(true);
        setMessage('Распознаю на этом компьютере…');
        try {
          const res = await fetch('/api/transcribe', {
            method: 'POST',
            headers: { 'Content-Type': 'application/octet-stream' },
            body: new Blob(parts),
          });
          const v = (await res.json()) as { text: string; error?: string };
          if (!res.ok) throw Error(v.error || 'Ошибка обработки');
          onText(v.text);
          setMessage(
            v.text
              ? 'Текст добавлен. Проверьте расшифровку.'
              : 'Речь не распознана.',
          );
        } catch (e) {
          setMessage(e instanceof Error ? e.message : 'Ошибка записи.');
        } finally {
          setBusy(false);
        }
      };
      r.start();
      setRecording(true);
      setMessage('Запись · максимум 2 минуты');
      limit.current = setTimeout(
        () => r.state === 'recording' && r.stop(),
        120000,
      );
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Нет доступа к микрофону.');
    }
  }
  return (
    <span className="capture-control">
      <button
        type="button"
        className="subtle"
        disabled={busy}
        onClick={() => (recording ? recorder.current?.stop() : void start())}
      >
        {recording ? <Square size={15} /> : <Mic size={15} />}{' '}
        {recording ? 'Остановить' : 'Голосом'}
      </button>
      {message && <output className="muted">{message}</output>}
    </span>
  );
}
export function ImageInput({ onText }: { onText: (text: string) => void }) {
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState('');
  return (
    <div className="capture-control">
      <label className="subtle file-button">
        <ImagePlus size={15} />
        {busy ? 'Распознаю…' : 'Из фото'}
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp"
          disabled={busy}
          onChange={async (e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (!file) return;
            setBusy(true);
            try {
              const r = await fetch('/api/ocr', {
                method: 'POST',
                headers: { 'Content-Type': 'application/octet-stream' },
                body: file,
              });
              const v = (await r.json()) as { text: string; error?: string };
              if (!r.ok) throw Error(v.error || 'Ошибка обработки');
              onText(v.text);
              setMessage(
                'Проверьте текст: столбцы и время на фото могут распознаваться с ошибками.',
              );
            } catch (err) {
              setMessage(
                err instanceof Error ? err.message : 'Не удалось распознать.',
              );
            } finally {
              setBusy(false);
            }
          }}
        />
      </label>
      {message && <output className="muted">{message}</output>}
    </div>
  );
}
