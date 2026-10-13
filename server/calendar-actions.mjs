import { randomUUID } from 'node:crypto';

const DAY = 86400000;
const dateKey = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const civilDay = (d) =>
  Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY;
const localDay = (key) => new Date(`${key}T00:00:00`);
const addDays = (d, n) =>
  new Date(
    d.getFullYear(),
    d.getMonth(),
    d.getDate() + n,
    d.getHours(),
    d.getMinutes(),
    d.getSeconds(),
    d.getMilliseconds(),
  );

export function occurrences(start, rule, validate) {
  if (!rule || rule.frequency === 'none') return [new Date(start)];
  const { choice, dateOnly, integer, fail } = validate;
  const frequency = choice(rule.frequency, ['daily', 'weekly']);
  const interval = integer(rule.interval ?? 1, 1, 12);
  const until = dateOnly(rule.until);
  const first = new Date(start);
  if (
    until < dateKey(first) ||
    civilDay(localDay(until)) - civilDay(first) > 730
  )
    fail('Выберите окончание повторов в пределах двух лет после начала.');
  const days =
    frequency === 'weekly'
      ? [...new Set(rule.weekdays || [first.getDay()])].map((d) =>
          integer(d, 0, 6),
        )
      : [];
  if (frequency === 'weekly' && !days.length) fail('Выберите дни недели.');
  const monday = civilDay(first) - ((first.getDay() + 6) % 7);
  const result = [];
  for (
    let cursor = first, offset = 0;
    dateKey(cursor) <= until;
    cursor = addDays(first, ++offset)
  ) {
    const selected =
      frequency === 'daily'
        ? offset % interval === 0
        : days.includes(cursor.getDay()) &&
          Math.floor((civilDay(cursor) - monday) / 7) % interval === 0;
    if (selected) result.push(cursor);
  }
  if (!result.length) fail('В выбранном периоде нет повторов.');
  if (result.length > 730)
    fail('В серии может быть не больше 730 событий. Сократите период.');
  return result;
}

export function templateEvents(template, week, validate) {
  const date = localDay(validate.dateOnly(week));
  if (date.getDay() !== 1)
    validate.fail('Неделя должна начинаться в понедельник.');
  return JSON.parse(template.blocks_json).map((block) => {
    const start = addDays(date, block.day);
    start.setHours(block.hour, block.minute, 0, 0);
    return {
      ...block,
      start_at: start.toISOString(),
      end_at: new Date(start.getTime() + block.duration * 60000).toISOString(),
    };
  });
}

export function calendarActions(db, user, ctx) {
  const { text, integer, choice, dateOnly, timestamp, taskById, now, fail } =
    ctx;
  const eventById = (id) =>
    db
      .prepare('SELECT * FROM calendar_events WHERE id=? AND user_id=?')
      .get(text(id), user.id) || fail('Событие не найдено.');
  const templateById = (id) =>
    db
      .prepare('SELECT * FROM week_templates WHERE id=? AND user_id=?')
      .get(text(id), user.id) || fail('Шаблон не найден.');
  const insert = (v, series = null) =>
    db
      .prepare(
        'INSERT INTO calendar_events(id,user_id,title,description,start_at,end_at,color,task_id,reminder_minutes,series_id,created_at,updated_at,is_fixed) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',
      )
      .run(
        randomUUID(),
        user.id,
        v.title,
        v.description,
        v.start_at,
        v.end_at,
        v.color,
        v.task_id ?? null,
        v.reminder_minutes ?? 0,
        series,
        now(),
        now(),
        v.is_fixed ?? (v.task_id ? 0 : 1),
      );
  const values = (input, old) => {
    const start = timestamp(input.start_at),
      end = timestamp(input.end_at);
    if (end <= start || Date.parse(end) - Date.parse(start) > 7 * DAY)
      fail('Окончание должно быть позже начала; максимум — 7 дней.');
    const task = input.task_id ? taskById(input.task_id) : null;
    if (
      task &&
      task.id !== old?.task_id &&
      !['pending', 'active'].includes(task.status)
    )
      fail('Для расписания выберите задачу в работе.');
    const description =
      typeof input.description === 'string' ? input.description : '';
    if (description.length > 10000) fail('Описание слишком длинное.');
    return {
      title: task ? task.title : text(input.title),
      description,
      start_at: start,
      end_at: end,
      color: choice(input.color, ['emerald', 'sky', 'violet', 'rose', 'amber']),
      task_id: task?.id || null,
      is_fixed:
        input.is_fixed === undefined
          ? (old?.is_fixed ?? (task ? 0 : 1))
          : integer(input.is_fixed, 0, 1),
      reminder_minutes: integer(
        input.reminder_minutes ?? old?.reminder_minutes ?? 0,
        0,
        30,
      ),
    };
  };
  const update = (id, v, exception) =>
    db
      .prepare(
        'UPDATE calendar_events SET title=?,description=?,start_at=?,end_at=?,color=?,task_id=?,reminder_minutes=?,series_exception=?,snoozed_until=NULL,reminder_dismissed_at=NULL,updated_at=? WHERE id=?',
      )
      .run(
        v.title,
        v.description,
        v.start_at,
        v.end_at,
        v.color,
        v.task_id,
        v.reminder_minutes,
        exception,
        now(),
        id,
      );
  return (input) => {
    switch (input.action) {
      case 'event.save': {
        const old = input.id ? eventById(input.id) : null;
        const v = values(input, old);
        if (![0, 5, 15, 30].includes(v.reminder_minutes))
          fail('Выберите напоминание за 0, 5, 15 или 30 минут.');
        if (old) {
          if (old.completed_at) fail('Сначала верните событие в план.');
          if (input.scope === 'series' && old.series_id) {
            const before = new Date(old.start_at),
              after = new Date(v.start_at),
              delta = civilDay(after) - civilDay(before),
              duration = Date.parse(v.end_at) - Date.parse(v.start_at);
            const events = db
              .prepare(
                'SELECT * FROM calendar_events WHERE user_id=? AND series_id=? AND completed_at IS NULL AND series_exception=0',
              )
              .all(user.id, old.series_id);
            if (!events.some((e) => e.id === old.id)) events.push(old);
            for (const event of events) {
              const shifted = addDays(new Date(event.start_at), delta);
              shifted.setHours(after.getHours(), after.getMinutes(), 0, 0);
              update(
                event.id,
                {
                  ...v,
                  start_at: shifted.toISOString(),
                  end_at: new Date(shifted.getTime() + duration).toISOString(),
                },
                event.series_exception,
              );
            }
          } else update(old.id, v, old.series_id ? 1 : 0);
        } else {
          const starts = occurrences(v.start_at, input.recurrence, ctx);
          let series = null;
          if (input.recurrence && input.recurrence.frequency !== 'none') {
            series = randomUUID();
            db.prepare('INSERT INTO event_series VALUES(?,?,?,?)').run(
              series,
              user.id,
              JSON.stringify(input.recurrence),
              now(),
            );
          }
          const duration = Date.parse(v.end_at) - Date.parse(v.start_at);
          for (const start of starts)
            insert(
              {
                ...v,
                start_at: start.toISOString(),
                end_at: new Date(start.getTime() + duration).toISOString(),
              },
              series,
            );
        }
        return true;
      }
      case 'event.move':
      case 'event.resize': {
        const event = eventById(input.id);
        if (event.completed_at) fail('Сначала верните событие в план.');
        const start =
          input.action === 'event.move'
            ? timestamp(input.start_at)
            : event.start_at;
        const end =
          input.action === 'event.resize'
            ? timestamp(input.end_at)
            : new Date(
                Date.parse(start) +
                  Date.parse(event.end_at) -
                  Date.parse(event.start_at),
              ).toISOString();
        const v = values({ ...event, start_at: start, end_at: end }, event);
        update(event.id, v, event.series_id ? 1 : 0);
        return true;
      }
      case 'event.duplicate': {
        const old = eventById(input.id),
          start = timestamp(input.start_at);
        insert({
          ...old,
          start_at: start,
          end_at: new Date(
            Date.parse(start) +
              Date.parse(old.end_at) -
              Date.parse(old.start_at),
          ).toISOString(),
        });
        return true;
      }
      case 'event.complete': {
        const event = eventById(input.id);
        db.prepare(
          'UPDATE calendar_events SET completed_at=?,updated_at=?,snoozed_until=NULL,reminder_dismissed_at=NULL WHERE id=?',
        ).run(input.completed === false ? null : now(), now(), event.id);
        return true;
      }
      case 'event.delete': {
        const event = eventById(input.id);
        if (input.scope === 'series' && event.series_id)
          db.prepare(
            'DELETE FROM calendar_events WHERE user_id=? AND series_id=? AND completed_at IS NULL AND (series_exception=0 OR id=?)',
          ).run(user.id, event.series_id, event.id);
        else db.prepare('DELETE FROM calendar_events WHERE id=?').run(event.id);
        return true;
      }
      case 'event.snooze': {
        const event = eventById(input.id);
        if (event.completed_at) fail('Событие уже завершено.');
        const until = new Date(
          Date.parse(now()) + integer(input.minutes, 1, 60) * 60000,
        ).toISOString();
        if (until >= event.end_at)
          fail('Напоминание должно быть до окончания события.');
        db.prepare(
          'UPDATE calendar_events SET snoozed_until=?,reminder_dismissed_at=NULL WHERE id=?',
        ).run(until, event.id);
        return true;
      }
      case 'event.dismiss': {
        const event = eventById(input.id);
        db.prepare(
          'UPDATE calendar_events SET reminder_dismissed_at=? WHERE id=?',
        ).run(now(), event.id);
        return true;
      }
      case 'template.save': {
        const from = localDay(dateOnly(input.week_start));
        if (from.getDay() !== 1) fail('Выберите начало недели.');
        const to = addDays(from, 7);
        const events = db
          .prepare(
            'SELECT * FROM calendar_events WHERE user_id=? AND start_at>=? AND start_at<? ORDER BY start_at',
          )
          .all(user.id, from.toISOString(), to.toISOString());
        if (!events.length) fail('В этой неделе нет событий для шаблона.');
        if (events.length > 200) fail('В шаблоне может быть до 200 блоков.');
        const blocks = events.map((e) => {
          const d = new Date(e.start_at);
          return {
            title: e.title,
            description: e.description,
            color: e.color,
            reminder_minutes: e.reminder_minutes,
            day: civilDay(d) - civilDay(from),
            hour: d.getHours(),
            minute: d.getMinutes(),
            duration: (Date.parse(e.end_at) - Date.parse(e.start_at)) / 60000,
          };
        });
        db.prepare('INSERT INTO week_templates VALUES(?,?,?,?,?)').run(
          randomUUID(),
          user.id,
          text(input.name, 80),
          JSON.stringify(blocks),
          now(),
        );
        return true;
      }
      case 'template.delete': {
        const template = templateById(input.id);
        db.prepare('DELETE FROM week_templates WHERE id=?').run(template.id);
        return true;
      }
      case 'template.apply': {
        const template = templateById(input.id);
        const blocks = templateEvents(template, input.week_start, ctx);
        const existing = db
          .prepare('SELECT * FROM calendar_events WHERE user_id=?')
          .all(user.id);
        const selected = [];
        for (const block of blocks) {
          const exact = existing.some(
            (e) =>
              e.title === block.title &&
              e.start_at === block.start_at &&
              e.end_at === block.end_at,
          );
          if (exact) continue;
          const conflict = [...existing, ...selected].some(
            (e) =>
              !e.completed_at &&
              e.start_at < block.end_at &&
              e.end_at > block.start_at,
          );
          if (conflict && input.conflicts === 'skip') continue;
          if (conflict && input.conflicts !== 'allow')
            fail('Есть пересечения. Выберите, как применить шаблон.');
          selected.push(block);
        }
        if (!selected.length)
          fail(
            'Нет новых блоков: они уже добавлены или пересекаются с планом.',
          );
        for (const block of selected) insert(block);
        return true;
      }
      default:
        return false;
    }
  };
}
