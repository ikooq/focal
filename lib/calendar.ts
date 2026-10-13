import type { CalendarEvent } from './domain';

export const atLocalTime = (date: Date, hour = 9, minute = 0) =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate(), hour, minute);
export const addDays = (date: Date, days: number) =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
export function weekStart(date: Date) {
  return addDays(date, -((date.getDay() + 6) % 7));
}
export function localInput(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}T${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}
export type EventSegment = {
  event: CalendarEvent;
  start: number;
  end: number;
  lane: number;
  columns: number;
};
export const visualEnd = (segment: EventSegment) =>
  Math.min(1440, Math.max(segment.end, segment.start + 15));
export const dropTime = (
  day: Date,
  pointerMinutes: number,
  grabOffsetMinutes: number,
) =>
  atLocalTime(
    day,
    0,
    Math.round((pointerMinutes - grabOffsetMinutes) / 15) * 15,
  );
export function daySegments(
  events: CalendarEvent[],
  date: Date,
): EventSegment[] {
  const start = atLocalTime(date, 0).getTime(),
    end = addDays(date, 1).getTime();
  const segments = events
    .filter((e) => Date.parse(e.start_at) < end && Date.parse(e.end_at) > start)
    .map((event) => {
      const from = new Date(Math.max(start, Date.parse(event.start_at))),
        to = new Date(Math.min(end, Date.parse(event.end_at)));
      return {
        event,
        start: from.getHours() * 60 + from.getMinutes(),
        end: to.getTime() === end ? 1440 : to.getHours() * 60 + to.getMinutes(),
        lane: 0,
        columns: 1,
      };
    })
    .sort(
      (a, b) =>
        a.start - b.start ||
        b.end - a.end ||
        a.event.id.localeCompare(b.event.id),
    );
  let group: EventSegment[] = [],
    groupEnd = -1;
  const place = () => {
    const ends: number[] = [];
    for (const item of group) {
      let lane = ends.findIndex((end) => end <= item.start);
      if (lane < 0) lane = ends.length;
      ends[lane] = visualEnd(item);
      item.lane = lane;
    }
    for (const item of group) item.columns = ends.length;
  };
  for (const item of segments) {
    if (item.start >= groupEnd) {
      place();
      group = [];
      groupEnd = -1;
    }
    group.push(item);
    groupEnd = Math.max(groupEnd, visualEnd(item));
  }
  place();
  return segments;
}
