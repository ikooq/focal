import type { Session } from './domain.ts';

/** Actual work segments, excluding pauses and preserving midnight boundaries. */
export function workIntervals(s: Session, now: Date) {
  const pauses: { start: string; end: string; phase: string }[] = JSON.parse(
    s.pauses_json || '[]',
  );
  const duration = (p: { start: string; end: string }) =>
    Math.max(0, Date.parse(p.end) - Date.parse(p.start));
  const start =
    Date.parse(s.started_at) +
    s.dopamine_debt_duration * 60000 +
    pauses
      .filter((p) => p.phase === 'preparation')
      .reduce((n, p) => n + duration(p), 0);
  if (s.phase === 'preparation') return [];
  const workPauses = pauses.filter((p) => p.phase === 'work');
  const end = Math.min(
    start +
      s.work_duration * 60000 +
      workPauses.reduce((n, p) => n + duration(p), 0),
    now.getTime(),
    s.ended_at ? Date.parse(s.ended_at) : Infinity,
    s.paused_at ? Date.parse(s.paused_at) : Infinity,
  );
  const segments: { start: number; end: number }[] = [];
  let cursor = start;
  for (const p of workPauses) {
    const until = Math.min(end, Date.parse(p.start));
    if (until > cursor) segments.push({ start: cursor, end: until });
    cursor = Math.max(cursor, Date.parse(p.end));
  }
  if (end > cursor) segments.push({ start: cursor, end });
  return segments;
}
