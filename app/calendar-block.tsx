'use client';
import { useRef, useState } from 'react';
import { Check, Repeat2 } from 'lucide-react';
import { type EventSegment, atLocalTime, visualEnd } from '@/lib/calendar';
import { type Mutate } from '@/lib/domain';
const time = (v: string) =>
  new Date(v).toLocaleTimeString('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
  });
export default function CalendarBlock({
  segment: s,
  day,
  busy,
  mutate,
  onOpen,
  onDrag,
}: {
  segment: EventSegment;
  day: Date;
  busy: boolean;
  mutate: Mutate;
  onOpen: () => void;
  onDrag: (id: string | null) => void;
}) {
  const resize = useRef<{ y: number; end: number; pointer: number } | null>(
      null,
    ),
    [preview, setPreview] = useState<number | null>(null);
  const event = s.event;
  const newEnd = (y: number) =>
    Math.max(
      Date.parse(event.start_at) + 60000,
      Math.min(
        Date.parse(event.start_at) + 7 * 86400000,
        resize.current!.end +
          Math.round((y - resize.current!.y) / 1.2 / 15) * 15 * 60000,
      ),
    );
  const canResize =
    !event.completed_at &&
    s.end - s.start >= 40 &&
    Date.parse(event.end_at) <= atLocalTime(day, 24).getTime();
  return (
    <div
      className={`time-event color-${event.color} ${event.completed_at ? 'completed' : ''} ${s.end - s.start < 35 ? 'compact' : ''} ${canResize ? 'resizable' : ''}`}
      draggable={!busy && !event.completed_at}
      onDragStart={(e) => {
        if (resize.current) {
          e.preventDefault();
          return;
        }
        e.dataTransfer.setData('application/focal-event', event.id);
        e.dataTransfer.effectAllowed = 'move';
        const segmentOffset =
          (atLocalTime(day, 0, s.start).getTime() -
            Date.parse(event.start_at)) /
          60000;
        const grab =
          (e.clientY - e.currentTarget.getBoundingClientRect().top) / 1.2;
        e.dataTransfer.setData(
          'application/focal-grab-offset',
          String(segmentOffset + grab),
        );
        onDrag(event.id);
      }}
      onDragEnd={() => onDrag(null)}
      style={{
        top: s.start * 1.2 + 1,
        height:
          preview === null
            ? Math.max(1, (visualEnd(s) - s.start) * 1.2 - 2)
            : Math.max(
                18,
                ((preview - atLocalTime(day, 0, s.start).getTime()) / 60000) *
                  1.2 -
                  2,
              ),
        left: `calc(${(s.lane / s.columns) * 100}% + 3px)`,
        width: `calc(${100 / s.columns}% - 6px)`,
      }}
    >
      <button
        className="event-open"
        onClick={onOpen}
        aria-label={`${event.title}, ${time(event.start_at)}–${time(event.end_at)}${event.completed_at ? ', выполнено' : ''}${event.series_id ? ', повторяется' : ''}`}
        title={`${event.title}\n${time(event.start_at)}–${time(event.end_at)}`}
      >
        <span className="event-title">
          {event.completed_at && <Check size={12} />}{' '}
          {event.series_id && <Repeat2 size={12} />} {event.title}
        </span>
        <span className="event-time">
          {time(event.start_at)}–
          {time(
            preview === null ? event.end_at : new Date(preview).toISOString(),
          )}
        </span>
        {s.end - s.start >= 60 && event.task_id && (
          <span className="event-kind">Задача</span>
        )}
      </button>
      {canResize && (
        <button
          className="event-resize"
          disabled={busy}
          draggable={false}
          aria-label={`Изменить длительность: ${event.title}. Стрелки вверх и вниз — по 15 минут; точное время в карточке события.`}
          title="Потяните край для изменения длительности"
          onDragStart={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          onPointerDown={(e) => {
            if (busy) return;
            e.preventDefault();
            e.stopPropagation();
            resize.current = {
              y: e.clientY,
              end: Date.parse(event.end_at),
              pointer: e.pointerId,
            };
            e.currentTarget.setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            if (resize.current) setPreview(newEnd(e.clientY));
          }}
          onPointerCancel={() => {
            resize.current = null;
            setPreview(null);
          }}
          onPointerUp={(e) => {
            if (!resize.current) return;
            const end = newEnd(e.clientY);
            resize.current = null;
            setPreview(null);
            if (e.currentTarget.hasPointerCapture(e.pointerId))
              e.currentTarget.releasePointerCapture(e.pointerId);
            if (end !== Date.parse(event.end_at))
              void mutate(
                {
                  action: 'event.resize',
                  id: event.id,
                  end_at: new Date(end).toISOString(),
                },
                'Длительность изменена',
              );
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
              e.preventDefault();
              if (busy) return;
              const end = Math.max(
                Date.parse(event.start_at) + 60000,
                Date.parse(event.end_at) +
                  (e.key === 'ArrowDown' ? 15 : -15) * 60000,
              );
              void mutate(
                {
                  action: 'event.resize',
                  id: event.id,
                  end_at: new Date(end).toISOString(),
                },
                'Длительность изменена',
              );
            }
          }}
        >
          <span />
        </button>
      )}
    </div>
  );
}
