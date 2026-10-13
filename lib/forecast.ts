import { dayKey, type State, type Flow } from './domain.ts';
export function flowDates(flow: Flow, from: string, until: string) {
  const dates: string[] = [];
  const start = new Date(flow.start_date + 'T12:00:00');
  const first = new Date(
    (from > flow.start_date ? from : flow.start_date) + 'T12:00:00',
  );
  let d = new Date(first);
  if (flow.frequency === 'weekly') {
    const days =
      (Date.UTC(first.getFullYear(), first.getMonth(), first.getDate()) -
        Date.UTC(start.getFullYear(), start.getMonth(), start.getDate())) /
      86400000;
    d = new Date(start);
    d.setDate(d.getDate() + Math.ceil(days / 7) * 7);
  } else
    d = new Date(
      first.getFullYear(),
      first.getMonth(),
      Math.min(
        start.getDate(),
        new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate(),
      ),
      12,
    );
  for (let count = 0; dayKey(d) <= until && count < 20000; count++) {
    const date = dayKey(d);
    if (flow.end_date && date > flow.end_date) break;
    if (date >= from && date >= flow.start_date) dates.push(date);
    if (flow.frequency === 'weekly') d.setDate(d.getDate() + 7);
    else
      d = new Date(
        d.getFullYear(),
        d.getMonth() + 1,
        Math.min(
          start.getDate(),
          new Date(d.getFullYear(), d.getMonth() + 2, 0).getDate(),
        ),
        12,
      );
  }
  return dates;
}
export function forecast(
  state: State,
  from: string,
  until: string,
  postpone?: { id: string; date: string },
) {
  const base = state.settings?.balance_date || from;
  let balance = state.settings?.opening_balance_minor || 0;
  const movements = state.transactions
    .filter((t) => t.type !== 'penalty')
    .map((t) => ({
      id: t.id,
      date:
        t.actual_date ||
        (t.id === postpone?.id ? postpone.date : t.planned_date),
      amount: t.type === 'income' ? t.amount_minor : -t.amount_minor,
      title: t.category,
      flow_id: t.recurring_id || null,
      planned_date: t.planned_date,
      actual: !!t.actual_date,
    }));
  for (const f of state.flows || [])
    if (f.enabled)
      for (const date of flowDates(f, base, until))
        if (
          !state.transactions.some(
            (t) => t.recurring_id === f.id && t.planned_date === date,
          )
        )
          movements.push({
            id: `${f.id}:${date}`,
            date,
            amount: f.type === 'income' ? f.amount_minor : -f.amount_minor,
            title: f.title,
            flow_id: f.id,
            planned_date: date,
            actual: false,
          });
  const result = [];
  balance += movements
    .filter((t) => t.date >= base && t.date < from)
    .reduce((n, t) => n + t.amount, 0);
  for (
    const d = new Date((from > base ? from : base) + 'T12:00:00');
    dayKey(d) <= until;
    d.setDate(d.getDate() + 1)
  ) {
    const date = dayKey(d),
      rows = movements.filter((t) => t.date === date);
    balance += rows.reduce((n, r) => n + r.amount, 0);
    if (date >= from) result.push({ date, balance, rows });
  }
  return result;
}
