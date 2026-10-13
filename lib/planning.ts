import { workIntervals } from './session-time.ts';
import {
  dayKey,
  type State,
  type Task,
  type Session,
  type WeekTemplate,
  type CalendarEvent,
  type TemplateBlock,
} from './domain.ts';
import { addDays, atLocalTime, weekStart } from './calendar.ts';

export function focusInRange(
  sessions: Session[],
  start: Date,
  end: Date,
  now: Date,
) {
  return sessions.reduce(
    (sum, s) =>
      sum +
      workIntervals(s, now).reduce(
        (n, work) =>
          n +
          Math.max(
            0,
            Math.min(end.getTime(), work.end) -
              Math.max(start.getTime(), work.start),
          ) /
            60000,
        0,
      ),
    0,
  );
}
export function learnedEstimate(data: State, task: Task, now: Date) {
  const samples = data.tasks
    .filter(
      (t) =>
        t.status === 'completed' &&
        t.brain_hemisphere === task.brain_hemisphere &&
        t.completed_at &&
        Date.parse(t.completed_at) <= now.getTime(),
    )
    .map((t) => {
      const actual = data.sessions
        .filter((s) => s.task_id === t.id)
        .reduce((sum, s) => {
          return (
            sum +
            workIntervals(s, now).reduce(
              (n, v) => n + (v.end - v.start) / 60000,
              0,
            )
          );
        }, 0);
      return actual > 0 ? actual / (t.estimated_minutes || 30) : null;
    })
    .filter((n): n is number => n !== null)
    .sort((a, b) => a - b);
  const ratio =
    samples.length >= 3
      ? Math.max(0.5, Math.min(2, samples[Math.floor(samples.length / 2)]))
      : 1;
  return {
    minutes: Math.max(
      5,
      Math.ceil(((task.estimated_minutes || 30) * ratio) / 5) * 5,
    ),
    samples: samples.length,
    ratio,
  };
}
export function hourHistory(data: State, hour: number, now: Date) {
  const days = new Map<string, number[]>();
  for (const log of data.energy_logs) {
    const d = new Date(log.logged_at);
    if (
      d.getTime() > now.getTime() ||
      d.getTime() < now.getTime() - 28 * 86400000 ||
      d.getHours() !== hour
    )
      continue;
    const key = dayKey(d);
    days.set(key, [...(days.get(key) || []), log.energy_level]);
  }
  const values = [...days.values()].map(
    (v) => v.reduce((a, b) => a + b, 0) / v.length,
  );
  return {
    value:
      values.length >= 2
        ? values.reduce((a, b) => a + b, 0) / values.length
        : null,
    days: values.length,
  };
}
export function suggestSlots(
  data: State,
  task: Task,
  date: string,
  hours: { start: number; end: number },
  now: Date,
) {
  const day = new Date(`${date}T00:00:00`),
    duration = learnedEstimate(data, task, now);
  const slots = [];
  for (
    let minute = hours.start * 60;
    minute + duration.minutes <= hours.end * 60;
    minute += 15
  ) {
    const start = atLocalTime(day, 0, minute),
      end = new Date(start.getTime() + duration.minutes * 60000);
    if (
      start < now ||
      (task.deadline && end.getTime() > Date.parse(task.deadline))
    )
      continue;
    if (
      data.events.some(
        (e) =>
          Date.parse(e.start_at) < end.getTime() &&
          Date.parse(e.end_at) > start.getTime(),
      )
    )
      continue;
    const history = hourHistory(data, start.getHours(), now);
    const score =
      history.value === null
        ? 0
        : history.value >= task.required_energy
          ? 20 - Math.abs(history.value - task.required_energy)
          : history.value - task.required_energy;
    slots.push({
      start,
      end,
      energy: history.value,
      days: history.days,
      score,
      duration,
    });
  }
  const selected: typeof slots = [];
  for (const slot of slots.sort(
    (a, b) => b.score - a.score || a.start.getTime() - b.start.getTime(),
  )) {
    if (!selected.some((s) => s.start < slot.end && s.end > slot.start))
      selected.push(slot);
    if (selected.length === 6) break;
  }
  return selected;
}
export function freeMinutes(
  events: CalendarEvent[],
  date: string,
  hours: { start: number; end: number },
) {
  const d = new Date(`${date}T00:00:00`),
    from = atLocalTime(d, hours.start).getTime(),
    to = atLocalTime(d, hours.end).getTime();
  const blocks = events
    .map((e) => [
      Math.max(from, Date.parse(e.start_at)),
      Math.min(to, Date.parse(e.end_at)),
    ])
    .filter(([a, b]) => a < b)
    .sort((a, b) => a[0] - b[0]);
  let occupied = 0,
    cursor = from;
  for (const [a, b] of blocks) {
    occupied += Math.max(0, b - Math.max(a, cursor));
    cursor = Math.max(cursor, b);
  }
  return Math.max(0, (to - from - occupied) / 60000);
}
export function previewTemplate(
  template: WeekTemplate,
  date: string,
  events: CalendarEvent[],
  policy = 'skip',
) {
  const week = weekStart(new Date(`${date}T00:00:00`));
  const blocks = JSON.parse(template.blocks_json) as TemplateBlock[];
  const preview = blocks.map((b) => {
    const start = atLocalTime(addDays(week, b.day), b.hour, b.minute);
    return {
      ...b,
      start_at: start.toISOString(),
      end_at: new Date(start.getTime() + b.duration * 60000).toISOString(),
    };
  });
  const accepted: typeof preview = [];
  return preview.map((b) => {
    const duplicate = events.some(
      (e) =>
        e.title === b.title &&
        e.start_at === b.start_at &&
        e.end_at === b.end_at,
    );
    const conflict = [...events, ...accepted].some(
      (e) =>
        !('completed_at' in e && e.completed_at) &&
        e.start_at < b.end_at &&
        e.end_at > b.start_at,
    );
    if (!duplicate && (policy === 'allow' || !conflict)) accepted.push(b);
    return { ...b, duplicate, conflict };
  });
}
export function weeklyReview(data: State, date: string, now: Date) {
  const start = weekStart(new Date(`${date}T00:00:00`)),
    end = addDays(start, 7);
  const days = Array.from({ length: 7 }, (_, i) => {
    const day = addDays(start, i),
      next = addDays(day, 1);
    const events = data.events.filter(
      (e) =>
        Date.parse(e.start_at) < next.getTime() &&
        Date.parse(e.end_at) > day.getTime(),
    );
    const planned = events.reduce(
      (sum, e) =>
        sum +
        Math.max(
          0,
          Math.min(next.getTime(), Date.parse(e.end_at)) -
            Math.max(day.getTime(), Date.parse(e.start_at)),
        ) /
          60000,
      0,
    );
    const logs = data.energy_logs.filter(
      (l) => dayKey(new Date(l.logged_at)) === dayKey(day),
    );
    return {
      date: dayKey(day),
      planned,
      focus: focusInRange(data.sessions, day, next, now),
      energy: logs.length
        ? logs.reduce((sum, l) => sum + l.energy_level, 0) / logs.length
        : null,
    };
  });
  const completed = data.tasks.filter(
    (t) =>
      t.completed_at &&
      Date.parse(t.completed_at) >= start.getTime() &&
      Date.parse(t.completed_at) < end.getTime(),
  );
  const estimates = completed
    .map((t) => {
      const actual = data.sessions
        .filter((s) => s.task_id === t.id)
        .reduce((sum, s) => {
          return (
            sum +
            workIntervals(s, now).reduce(
              (n, v) => n + (v.end - v.start) / 60000,
              0,
            )
          );
        }, 0);
      return { task: t, actual, estimate: t.estimated_minutes || 30 };
    })
    .filter((t) => t.actual > 0);
  const blocks = data.events.filter(
    (e) =>
      Date.parse(e.start_at) >= start.getTime() &&
      Date.parse(e.start_at) < end.getTime(),
  );
  return {
    days,
    completed: completed.length,
    blocks: blocks.length,
    done: blocks.filter((e) => e.completed_at).length,
    overdue: blocks.filter(
      (e) => !e.completed_at && Date.parse(e.end_at) < now.getTime(),
    ).length,
    estimates,
  };
}
