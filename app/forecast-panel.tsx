'use client';
import { useState, type SubmitEvent } from 'react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceLine,
} from 'recharts';
import { forecast } from '@/lib/forecast';
import { currency, dayKey, type State, type Mutate } from '@/lib/domain';
import { addDays } from '@/lib/calendar';
import { Field } from './sections';
export default function ForecastPanel({
  data,
  mutate,
  postpone,
}: {
  data: State;
  mutate: Mutate;
  postpone?: { id: string; date: string };
}) {
  const today = dayKey(new Date(data.server_now)),
    until = dayKey(addDays(new Date(today + 'T12:00:00'), 30));
  const [selected, setSelected] = useState(today),
    [busy, setBusy] = useState(false);
  const rows = forecast(data, today, until),
    scenario = postpone ? forecast(data, today, until, postpone) : null,
    chart = rows.map((r, i) => ({ ...r, scenario: scenario?.[i]?.balance })),
    day = rows.find((r) => r.date === selected),
    lowest = rows.length ? Math.min(...rows.map((r) => r.balance)) : 0;
  async function save(e: SubmitEvent<HTMLFormElement>, action: string) {
    e.preventDefault();
    const form = e.currentTarget;
    setBusy(true);
    const result = await mutate(
      { action, ...Object.fromEntries(new FormData(form)) },
      'Финансовый план сохранён',
    );
    if (result && action === 'flow.save') form.reset();
    setBusy(false);
  }
  return (
    <section className="panel forecast-panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">ВЗГЛЯД НА 30 ДНЕЙ</span>
          <h3>Прогноз остатка</h3>
        </div>
        <strong className={lowest < 0 ? 'negative' : 'accent-text'}>
          Минимум {currency(lowest)}
        </strong>
      </div>
      <p className="muted">
        Остаток на начало выбранной даты + проведённые и плановые операции +
        регулярные платежи. Это расчёт по вашим данным.
      </p>
      <div className="forecast-chart">
        <ResponsiveContainer width="100%" height={230}>
          <AreaChart data={chart}>
            <defs>
              <linearGradient id="cashFuture" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#10b981" stopOpacity={0.3} />
                <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis
              dataKey="date"
              tickFormatter={(d) => String(d).slice(5)}
              tick={{ fill: '#71717a', fontSize: 11 }}
            />
            <YAxis
              tickFormatter={(v) => `${Math.round(Number(v) / 100000)}к`}
              tick={{ fill: '#71717a', fontSize: 11 }}
              width={42}
            />
            <Tooltip
              formatter={(v) => currency(Number(v))}
              contentStyle={{
                background: '#101311',
                border: '1px solid #25352d',
                borderRadius: 8,
              }}
            />
            <ReferenceLine y={0} stroke="#71717a" />
            <Area
              name="Базовый прогноз"
              type="monotone"
              dataKey="balance"
              stroke="#10b981"
              fill="url(#cashFuture)"
              isAnimationActive={false}
            />
            {scenario && (
              <Area
                name="Сценарий"
                type="monotone"
                dataKey="scenario"
                stroke="#a78bfa"
                fill="transparent"
                isAnimationActive={false}
              />
            )}
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <details>
        <summary>Начальный остаток и регулярные платежи</summary>
        <form
          className="inline-fields"
          onSubmit={(e) => void save(e, 'settings.save')}
        >
          <Field label="Остаток на начало дня, ₸">
            <input
              name="opening_balance"
              inputMode="decimal"
              defaultValue={(data.settings?.opening_balance_minor || 0) / 100}
              required
            />
          </Field>
          <Field label="Дата остатка">
            <input
              type="date"
              name="balance_date"
              max={today}
              defaultValue={data.settings?.balance_date || today}
              required
            />
          </Field>
          <button className="secondary" disabled={busy}>
            Сохранить
          </button>
        </form>
        <form
          className="stack-form"
          onSubmit={(e) => void save(e, 'flow.save')}
        >
          <h3>Регулярный платёж</h3>
          <div className="inline-fields">
            <input
              name="title"
              aria-label="Название платежа"
              placeholder="Аренда / зарплата"
              maxLength={160}
              required
            />
            <select name="type" aria-label="Тип платежа">
              <option value="expense">Расход</option>
              <option value="income">Доход</option>
            </select>
            <input
              name="amount"
              aria-label="Сумма платежа"
              placeholder="Сумма, ₸"
              inputMode="decimal"
              required
            />
          </div>
          <div className="inline-fields">
            <Field label="Повтор">
              <select name="frequency">
                <option value="monthly">Ежемесячно</option>
                <option value="weekly">Еженедельно</option>
              </select>
            </Field>
            <Field label="Первый платёж">
              <input
                type="date"
                name="start_date"
                defaultValue={today}
                required
              />
            </Field>
            <Field label="Последний день (необязательно)">
              <input type="date" name="end_date" />
            </Field>
            <button className="primary" disabled={busy}>
              Добавить
            </button>
          </div>
        </form>
        {data.flows?.map((f) => (
          <div className="material-row" key={f.id}>
            <strong>{f.title}</strong>
            <span>
              {currency(f.amount_minor)} ·{' '}
              {f.frequency === 'monthly' ? 'месяц' : 'неделя'}
            </span>
            <button
              className="subtle"
              disabled={busy}
              onClick={() =>
                void mutate({
                  action: 'flow.toggle',
                  id: f.id,
                  enabled: !f.enabled,
                })
              }
            >
              {f.enabled ? 'Приостановить' : 'Возобновить'}
            </button>
          </div>
        ))}
      </details>
      <Field label="Операции на дату">
        <input
          type="date"
          min={today}
          max={until}
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
        />
      </Field>
      {day?.rows.map((r) => (
        <div className="material-row" key={r.id}>
          <span>{r.title}</span>
          <strong>{currency(r.amount)}</strong>
          {r.flow_id && !r.actual && r.date <= today && (
            <button
              className="subtle"
              onClick={() =>
                void mutate({
                  action: 'flow.settle',
                  id: r.flow_id,
                  date: r.planned_date,
                  actual_date: today,
                })
              }
            >
              Проведено
            </button>
          )}
          <small>{r.actual ? 'Проведено' : 'План'}</small>
        </div>
      ))}
      {!day?.rows.length && <p className="muted">На этот день операций нет.</p>}
    </section>
  );
}
