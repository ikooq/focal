import type { CalendarEvent } from './domain.ts';
export function reminderFor(event: CalendarEvent, now: Date) {
  const start = Date.parse(event.start_at),
    end = Date.parse(event.end_at),
    current = now.getTime();
  if (event.completed_at || current >= end) return null;
  const trigger = event.snoozed_until
    ? Date.parse(event.snoozed_until)
    : current >= start
      ? start
      : start - (event.reminder_minutes || 0) * 60000;
  if (
    current < trigger ||
    (event.reminder_dismissed_at &&
      Date.parse(event.reminder_dismissed_at) >= trigger)
  )
    return null;
  return {
    event,
    trigger,
    key: `${event.id}:${event.start_at}:${trigger}`,
    upcoming: current < start,
    minutes: Math.max(0, Math.ceil((start - current) / 60000)),
  };
}
