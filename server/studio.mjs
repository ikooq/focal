import ICAL from 'ical.js';

export const defaults = {
  day_start: 9,
  day_end: 19,
  daily_limit: 360,
  buffer_minutes: 10,
  session_minutes: 50,
  motion: 'gentle',
  opening_balance_minor: 0,
};
const key = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const plus = (s, n) => {
  const d = new Date(`${s}T12:00:00`);
  d.setDate(d.getDate() + n);
  return key(d);
};
const at = (s, h) =>
  new Date(`${s}T${String(h).padStart(2, '0')}:00:00`).getTime();

// The scheduler owns placement; language models only suggest editable inputs.
export function planDay(state, input, now = Date.now()) {
  const s = { ...defaults, ...state.settings },
    date = input.date;
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(date || '') ||
    key(new Date(`${date}T12:00:00`)) !== date
  )
    throw Error('Выберите дату.');
  const endHour = Number(input.day_end ?? s.day_end),
    limit = Number(input.daily_limit ?? s.daily_limit),
    block = Number(input.session_minutes ?? s.session_minutes),
    buffer = s.buffer_minutes * 60000;
  if (
    !Number.isInteger(endHour) ||
    endHour <= s.day_start ||
    endHour > 24 ||
    !Number.isInteger(limit) ||
    limit < 15 ||
    limit > 720 ||
    !Number.isInteger(block) ||
    block < 5 ||
    block > 120
  )
    throw Error('Проверьте время и лимиты.');
  const start = at(date, s.day_start),
    end = endHour === 24 ? at(plus(date, 1), 0) : at(date, endHour);
  const ids = new Set(
    input.task_ids ||
      state.tasks
        .filter(
          (t) =>
            t.status === 'pending' &&
            t.board_status !== 'waiting' &&
            !t.blocked_by?.length,
        )
        .map((t) => t.id),
  );
  const tasks = state.tasks
    .filter(
      (t) =>
        ids.has(t.id) &&
        t.status === 'pending' &&
        t.board_status !== 'waiting' &&
        !t.blocked_by?.length &&
        !state.tasks.some(
          (c) => c.parent_task_id === t.id && c.status !== 'completed',
        ),
    )
    .sort(
      (a, b) =>
        (b.is_priority || 0) - (a.is_priority || 0) ||
        (a.deadline || 'z').localeCompare(b.deadline || 'z'),
    );
  const removed = state.events.filter(
    (e) =>
      input.replan &&
      e.task_id &&
      ids.has(e.task_id) &&
      !e.is_fixed &&
      !e.completed_at &&
      Date.parse(e.start_at) >= Math.max(now, start) &&
      Date.parse(e.start_at) < at(plus(date, 1), 0),
  );
  const removedIds = new Set(removed.map((e) => e.id));
  const kept = state.events.filter((e) => !removedIds.has(e.id));
  const busy = kept
    .filter((e) => Date.parse(e.start_at) < end && Date.parse(e.end_at) > start)
    .map((e) => [
      Math.max(start, Date.parse(e.start_at)),
      Math.min(end, Date.parse(e.end_at)),
    ])
    .sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const b of busy) {
    const last = merged.at(-1);
    if (last && last[1] >= b[0]) last[1] = Math.max(last[1], b[1]);
    else merged.push([...b]);
  }
  let budget = Math.max(
    0,
    limit - merged.reduce((a, b) => a + (b[1] - b[0]) / 60000, 0),
  );
  let cursor = Math.ceil(Math.max(now, start) / 300000) * 300000;
  const operations = removed.map((e) => ({
      action: 'event.delete',
      id: e.id,
      scope: 'single',
    })),
    warnings = [],
    blocks = [];
  if (merged.reduce((n, b) => n + (b[1] - b[0]) / 60000, 0) > limit)
    warnings.push(
      'Уже закреплённые события превышают дневной лимит занятости.',
    );
  if (
    kept.some(
      (e) =>
        e.is_fixed &&
        Date.parse(e.start_at) < at(plus(date, 1), 0) &&
        Date.parse(e.end_at) > end &&
        Date.parse(e.end_at) > now,
    )
  )
    warnings.push('После выбранного конца дня остаются закреплённые события.');
  for (const task of tasks) {
    const scheduled = kept
      .filter(
        (e) =>
          e.task_id === task.id &&
          !e.completed_at &&
          Date.parse(e.end_at) > now,
      )
      .reduce(
        (sum, e) =>
          sum +
          (Date.parse(e.end_at) - Math.max(now, Date.parse(e.start_at))) /
            60000,
        0,
      );
    let remaining = Math.max(0, (task.estimated_minutes || 30) - scheduled);
    while (remaining > 0 && budget >= 5) {
      const duration = Math.min(block, remaining, budget),
        ms = duration * 60000,
        deadline = Math.min(
          end,
          task.deadline ? Date.parse(task.deadline) : Infinity,
        );
      for (const b of merged) {
        if (cursor + ms > b[0] - buffer && cursor < b[1] + buffer)
          cursor = b[1] + buffer;
      }
      if (cursor + ms > deadline) break;
      const event = {
        action: 'event.save',
        title: task.title,
        description: 'План дня · блок фокуса',
        task_id: task.id,
        start_at: new Date(cursor).toISOString(),
        end_at: new Date(cursor + ms).toISOString(),
        color: task.brain_hemisphere === 'creative' ? 'violet' : 'emerald',
        reminder_minutes: 5,
        is_fixed: 0,
      };
      operations.push(event);
      blocks.push(event);
      cursor += ms + buffer;
      remaining -= duration;
      budget -= duration;
    }
    if (remaining > 0)
      warnings.push(
        `${task.title}: не помещается ${Math.ceil(remaining)} мин.`,
      );
  }
  return {
    kind: 'schedule',
    summary: `${date}: ${blocks.length} блоков · лимит ${limit} мин. · паузы ${s.buffer_minutes} мин.`,
    operations,
    blocks,
    removed,
    warnings,
    remaining_minutes: budget,
  };
}

export function parseQuick(source, date) {
  return source
    .split(/\n+|(?<=[.!?])\s+(?=[А-ЯЁA-Z])/u)
    .filter((x) => x.trim())
    .slice(0, 100)
    .map((line) => {
      let day = date;
      const explicit = line.match(/\b(\d{4}-\d{2}-\d{2})\b/);
      if (explicit) day = explicit[1];
      else if (/послезавтра/i.test(line)) day = plus(date, 2);
      else if (/завтра/i.test(line)) day = plus(date, 1);
      const time = line.match(
        /(?:^|\s)(?:в\s*)?([01]?\d|2[0-3])[:.]([0-5]\d)(?=\s|$|[,.])/,
      );
      const dur = line.match(/(?:на\s+)?(\d+)\s*(мин|час)/i);
      let duration = dur
        ? Number(dur[1]) * (dur[2].toLowerCase() === 'час' ? 60 : 1)
        : /на час/i.test(line)
          ? 60
          : 30;
      duration = Math.min(1440, Math.max(5, duration));
      const title =
        line
          .replace(/\b\d{4}-\d{2}-\d{2}\b/g, '')
          .replace(/послезавтра|завтра|сегодня/gi, '')
          .replace(time?.[0] || /$^/, ' ')
          .replace(dur?.[0] || /$^/, ' ')
          .replace(/на час/gi, '')
          .trim()
          .replace(/[,.]$/, '') || line;
      return {
        title: title.slice(0, 160),
        date: day,
        time: time ? `${time[1].padStart(2, '0')}:${time[2]}` : '',
        duration,
        kind: time ? 'event' : 'task',
        warning: time
          ? 'Проверьте дату и длительность.'
          : 'Время не распознано — задача без блока в календаре.',
      };
    });
}

export function importICS(source, from, until) {
  if (source.length > 2000000) throw Error('Максимум 2 МБ.');
  const root = new ICAL.Component(ICAL.parse(source));
  if (root.name !== 'vcalendar') throw Error('Ожидается календарь ICS.');
  ICAL.TimezoneService.reset();
  for (const tz of root.getAllSubcomponents('vtimezone'))
    ICAL.TimezoneService.register(
      tz.getFirstPropertyValue('tzid'),
      new ICAL.Timezone(tz),
    );
  const result = [],
    warnings = [];
  const components = root.getAllSubcomponents('vevent');
  const exceptions = components.filter((c) => c.hasProperty('recurrence-id'));
  const min = Date.parse(`${from}T00:00:00`),
    max = Date.parse(`${until}T23:59:59`);
  if (
    !Number.isFinite(min) ||
    !Number.isFinite(max) ||
    max < min ||
    max - min > 366 * 86400000
  )
    throw Error('Период импорта — до одного года.');
  for (const component of components.filter(
    (c) => !c.hasProperty('recurrence-id'),
  )) {
    if (result.length >= 500) {
      warnings.push('Достигнут лимит 500 событий. Сократите период импорта.');
      break;
    }
    if (component.getFirstPropertyValue('status') === 'CANCELLED') continue;
    const tzid = component.getFirstProperty('dtstart')?.getParameter('tzid');
    if (tzid && !ICAL.TimezoneService.has(tzid)) {
      warnings.push(
        `Событие «${String(component.getFirstPropertyValue('summary') || 'Без названия')}» пропущено: часовой пояс ${String(tzid)} не описан в файле VTIMEZONE.`,
      );
      continue;
    }
    const event = new ICAL.Event(component);
    for (const ex of exceptions.filter(
      (c) => c.getFirstPropertyValue('uid') === event.uid,
    ))
      event.relateException(new ICAL.Event(ex));
    const add = (start, end, actual) => {
      const a = start.toJSDate(),
        b = end.toJSDate();
      if (a.getTime() < min || a.getTime() > max || result.length >= 500)
        return;
      if (b <= a) b.setTime(a.getTime() + 1800000);
      result.push({
        action: 'event.save',
        title: (actual.summary || 'Событие').slice(0, 160),
        description: (actual.description || '').slice(0, 10000),
        start_at: a.toISOString(),
        end_at: b.toISOString(),
        color: 'sky',
        reminder_minutes: 5,
        is_fixed: 1,
        external_uid: `${event.uid || 'import'}:${start.toString()}`,
      });
    };
    if (event.isRecurring()) {
      const it = event.iterator();
      let occurrence,
        count = 0;
      while ((occurrence = it.next()) && count++ < 20000) {
        if (occurrence.toJSDate().getTime() > max) break;
        const detail = event.getOccurrenceDetails(occurrence);
        if (
          detail.item.component.getFirstPropertyValue('status') !== 'CANCELLED'
        )
          add(detail.startDate, detail.endDate, detail.item);
        if (result.length >= 500) break;
      }
      if (count >= 20000)
        warnings.push(
          `Серия «${event.summary}»: слишком много повторов; импорт ограничен.`,
        );
    } else add(event.startDate, event.endDate, event);
  }
  return {
    kind: 'import',
    summary: `Импорт ICS: ${result.length} событий`,
    operations: result,
    blocks: result,
    removed: [],
    warnings,
  };
}
export function exportICS(events) {
  const root = new ICAL.Component(['vcalendar', [], []]);
  root.updatePropertyWithValue('version', '2.0');
  root.updatePropertyWithValue('prodid', '-//focal//Local calendar//RU');
  for (const row of events) {
    const c = new ICAL.Component('vevent');
    const e = new ICAL.Event(c);
    e.uid = `${row.id}@focal.local`;
    e.summary = row.title;
    e.description = row.description || '';
    e.startDate = ICAL.Time.fromJSDate(new Date(row.start_at), true);
    e.endDate = ICAL.Time.fromJSDate(new Date(row.end_at), true);
    root.addSubcomponent(c);
  }
  return root.toString();
}
