'use client';
import { useState, type ReactNode } from 'react';
import {
  Activity,
  ArrowDownLeft,
  ArrowUpRight,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  ListTodo,
  Pencil,
  Play,
  Plus,
  Sparkles,
  Zap,
  CalendarDays,
  RotateCcw,
  Star,
  FileText,
} from 'lucide-react';
import { Empty, EmptyTitle, EmptyDescription } from '@/components/ui/empty';
import {
  dayKey,
  currency,
  energyProfile,
  shortDate,
  txDate,
  type EnergyLog,
  type State,
  type Task,
  type Transaction,
} from '@/lib/domain';

export function Blank({
  title,
  children,
  icon,
}: {
  title: string;
  children: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <Empty className="empty-panel">
      {icon}
      <EmptyTitle>{title}</EmptyTitle>
      <EmptyDescription>{children}</EmptyDescription>
    </Empty>
  );
}
export function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="form-field">
      <span>{label}</span>
      {children}
    </label>
  );
}
export function TaskList({
  tasks,
  busy,
  hasActive,
  onAdd,
  onEdit,
  onStart,
  onComplete,
  onSchedule,
  onReopen,
  onPriority,
  onOpenNote,
  onWorkspace,
}: {
  tasks: Task[];
  busy: boolean;
  hasActive: boolean;
  onAdd: () => void;
  onEdit: (t: Task) => void;
  onStart: (t: Task) => void;
  onComplete: (id: string) => void;
  onSchedule?: (task: Task) => void;
  onReopen?: (id: string) => void;
  onPriority?: (task: Task) => void;
  onOpenNote?: (id: string) => void;
  onWorkspace?: (task: Task) => void;
}) {
  return (
    <section className="panel task-list">
      {!tasks.length ? (
        <Blank title="Пока здесь тихо" icon={<ListTodo />}>
          <button className="text-action" onClick={onAdd}>
            Добавить задачу
          </button>
        </Blank>
      ) : (
        tasks.map((task) => (
          <div className="task-row" key={task.id}>
            <button
              className={`task-check ${task.status === 'completed' ? 'checked' : ''}`}
              disabled={
                busy ||
                task.status !== 'pending' ||
                task.board_status === 'waiting' ||
                !!task.blocked_by?.length
              }
              onClick={() => onComplete(task.id)}
              aria-label={`Завершить: ${task.title}`}
            >
              {task.status === 'completed' && <Check size={14} />}
            </button>
            <div className="task-description">
              <div className="task-title">{task.title}</div>
              <div className="task-meta">
                {onWorkspace && (
                  <button
                    className="text-action"
                    onClick={() => onWorkspace(task)}
                  >
                    <FileText size={13} />
                    Материалы и продолжение
                  </button>
                )}
                <span
                  className={
                    task.brain_hemisphere === 'creative'
                      ? 'violet-text'
                      : 'green-text'
                  }
                >
                  {task.brain_hemisphere === 'creative' ? (
                    <Sparkles size={12} />
                  ) : (
                    <Activity size={12} />
                  )}
                  {task.brain_hemisphere === 'creative'
                    ? 'Творчество'
                    : 'Аналитика'}
                </span>
                <span>
                  <Zap size={12} />
                  {task.required_energy}/10
                </span>
                <span>
                  <Clock3 size={12} />
                  {task.deadline
                    ? shortDate(task.deadline) +
                      ' · ' +
                      new Date(task.deadline).toLocaleTimeString('ru-RU', {
                        hour: '2-digit',
                        minute: '2-digit',
                      })
                    : 'Без срока'}
                </span>
                {task.penalty_minor > 0 && (
                  <span>Ставка {currency(task.penalty_minor)}</span>
                )}
                <span>{task.estimated_minutes || 30} мин</span>
                {task.source_note_id && onOpenNote && (
                  <button
                    className="text-action"
                    onClick={() => onOpenNote(task.source_note_id!)}
                  >
                    <FileText size={14} />
                    Исходная заметка
                  </button>
                )}
                {task.planned_date && (
                  <span>
                    <CalendarDays size={12} />
                    {shortDate(task.planned_date + 'T12:00:00')}
                  </span>
                )}
              </div>
            </div>
            {task.status === 'pending' && (
              <div className="row-actions">
                {onPriority && (
                  <button
                    className={`icon-button ${task.is_priority && task.planned_date === dayKey() ? 'green-text' : ''}`}
                    title="Главное на сегодня"
                    aria-label={`Главное на сегодня: ${task.title}`}
                    disabled={busy}
                    onClick={() => onPriority(task)}
                  >
                    <Star size={15} />
                  </button>
                )}
                {onSchedule && (
                  <button
                    className="icon-button"
                    title="Выбрать время"
                    aria-label={`Запланировать: ${task.title}`}
                    onClick={() => onSchedule(task)}
                  >
                    <CalendarDays size={15} />
                  </button>
                )}
                <button
                  className="icon-button edit-task"
                  aria-label={`Редактировать: ${task.title}`}
                  onClick={() => onEdit(task)}
                >
                  <Pencil size={15} />
                </button>
                <button
                  className="icon-button task-play"
                  disabled={hasActive || busy}
                  onClick={() => onStart(task)}
                  aria-label={`Начать фокус: ${task.title}`}
                >
                  <Play size={15} />
                </button>
              </div>
            )}
            {task.deadline &&
              !!task.deadline_notified_at &&
              ['pending', 'active'].includes(task.status) && (
                <span className="status-small">
                  Просрочено · можно продолжить или изменить срок
                </span>
              )}
            {task.status === 'failed' && (
              <span className="red-text status-small">Не выполнено</span>
            )}
            {['completed', 'failed'].includes(task.status) && onReopen && (
              <button
                className="secondary"
                disabled={busy}
                onClick={() => onReopen(task.id)}
              >
                <RotateCcw size={14} />
                Вернуть
              </button>
            )}
          </div>
        ))
      )}
    </section>
  );
}
export function EnergyGraph({
  logs,
  now,
  onAdd,
}: {
  logs: EnergyLog[];
  now: Date;
  onAdd: () => void;
}) {
  const [mode, setMode] = useState('week');
  const week = energyProfile(logs, now).points;
  const todayLogs = logs
    .filter((l) => dayKey(new Date(l.logged_at)) === dayKey(now))
    .sort((a, b) => a.logged_at.localeCompare(b.logged_at));
  const points =
    mode === 'week'
      ? week
          .filter((p) => p.value !== null)
          .map((p) => ({
            x: (p.hour / 23) * 650 + 34,
            y: 170 - p.value! * 14,
            label: `${p.hour}:00 · ${p.value!.toFixed(1)}/10`,
          }))
      : todayLogs.map((l) => {
          const d = new Date(l.logged_at);
          return {
            x: ((d.getHours() + d.getMinutes() / 60) / 24) * 650 + 34,
            y: 170 - l.energy_level * 14,
            label: `${d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })} · ${l.energy_level}/10`,
          };
        });
  return (
    <section className="panel graph-panel">
      <div className="panel-heading">
        <h2>Ритм энергии</h2>
        <div className="segmented">
          <button
            className={mode === 'today' ? 'selected' : ''}
            onClick={() => setMode('today')}
          >
            Сегодня
          </button>
          <button
            className={mode === 'week' ? 'selected' : ''}
            onClick={() => setMode('week')}
          >
            7 дней
          </button>
        </div>
      </div>
      <div className="graph-wrap">
        <svg
          viewBox="0 0 714 210"
          aria-label="График энергии от 1 до 10 по часам"
        >
          <title>График энергии от 1 до 10 по часам</title>
          <defs>
            <linearGradient id="energy-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#10b981" stopOpacity=".25" />
              <stop offset="100%" stopColor="#10b981" stopOpacity="0" />
            </linearGradient>
          </defs>
          {[2, 5, 8, 10].map((v) => (
            <g key={v}>
              <line
                x1="34"
                y1={170 - v * 14}
                x2="684"
                y2={170 - v * 14}
                stroke="#252c27"
                strokeDasharray="3 6"
              />
              <text x="8" y={175 - v * 14} fill="#85918a" fontSize="12">
                {v}
              </text>
            </g>
          ))}
          {[0, 4, 8, 12, 16, 20, 23].map((h) => (
            <text
              key={h}
              x={(h / 23) * 650 + 24}
              y="199"
              fill="#85918a"
              fontSize="12"
            >
              {String(h).padStart(2, '0')}
            </text>
          ))}
          {points.length > 1 && (
            <>
              <path
                d={`M ${points[0].x} 178 ${points.map((p) => `L ${p.x} ${p.y}`).join(' ')} L ${points[points.length - 1].x} 178 Z`}
                fill="url(#energy-fill)"
              />
              <polyline
                points={points.map((p) => `${p.x},${p.y}`).join(' ')}
                fill="none"
                stroke="#34d399"
                strokeWidth="2.5"
                strokeLinejoin="round"
              />
            </>
          )}
          {points.map((p, i) => (
            <circle key={i} cx={p.x} cy={p.y} r="4" fill="#57dbaa">
              <title>{p.label}</title>
            </circle>
          ))}
        </svg>
        {!points.length && (
          <div className="graph-empty">
            <Activity size={23} />
            <span>Ваш ритм начинается с первой отметки</span>
            <button className="text-action" onClick={onAdd}>
              Отметить энергию <ArrowUpRight size={14} />
            </button>
          </div>
        )}
      </div>
      <div className="graph-footer">
        <span>
          <i className="dot green" />
          {mode === 'week'
            ? 'Среднее по часам за 7 дней'
            : 'Ваши отметки сегодня'}
        </span>
        <span>Линия соединяет отметки</span>
      </div>
    </section>
  );
}
export function TransactionRow({
  tx,
  busy,
  onSettle,
}: {
  tx: Transaction;
  busy: boolean;
  onSettle: (id: string) => void;
}) {
  return (
    <div className="transaction-row">
      <span
        className={`transaction-icon ${tx.type === 'income' ? 'income' : 'expense'}`}
      >
        {tx.type === 'income' ? (
          <ArrowDownLeft size={17} />
        ) : (
          <ArrowUpRight size={17} />
        )}
      </span>
      <div className="transaction-description">
        <span>{tx.category}</span>
        <small>
          {shortDate(txDate(tx) + 'T12:00:00')} ·{' '}
          {tx.type === 'penalty'
            ? 'Штраф · учёт'
            : tx.actual_date
              ? 'Проведено'
              : 'Запланировано'}
        </small>
      </div>
      <span className={tx.type === 'income' ? 'green-text' : 'red-text'}>
        {tx.type === 'income' ? '+' : '−'}
        {currency(tx.amount_minor)}
      </span>
      {!tx.actual_date && (
        <button
          className="icon-button"
          aria-label={`Провести: ${tx.category}`}
          disabled={busy}
          onClick={() => onSettle(tx.id)}
        >
          <Check size={17} />
        </button>
      )}
    </div>
  );
}
export function CashCalendar({
  data,
  month,
  onMonth,
  today,
  selectedDay,
  onSelectDay,
  onAdd,
  busy,
  onSettle,
}: {
  data: State;
  month: Date;
  onMonth: (d: Date) => void;
  today: string;
  selectedDay: string;
  onSelectDay: (d: string) => void;
  onAdd: () => void;
  busy: boolean;
  onSettle: (id: string) => void;
}) {
  const monthKey = dayKey(month).slice(0, 7),
    transactions = data.transactions.filter(
      (t) => t.type !== 'penalty' && txDate(t).startsWith(monthKey),
    );
  const tasks = data.tasks.filter(
    (t) => t.deadline && dayKey(new Date(t.deadline)).startsWith(monthKey),
  );
  const first = (month.getDay() + 6) % 7,
    days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate(),
    count = Math.ceil((first + days) / 7) * 7;
  const dayTx = transactions.filter((t) => txDate(t) === selectedDay),
    dayTasks = tasks.filter(
      (t) => dayKey(new Date(t.deadline!)) === selectedDay,
    ),
    maxAmount = Math.max(1, ...transactions.map((t) => t.amount_minor));
  function changeMonth(delta: number) {
    onMonth(new Date(month.getFullYear(), month.getMonth() + delta, 1));
    onSelectDay('');
  }
  return (
    <section className="panel calendar-panel">
      <div className="panel-heading">
        <h2>Календарь кэшфлоу</h2>
        <div className="calendar-controls">
          <button
            className="icon-button"
            aria-label="Предыдущий месяц"
            onClick={() => changeMonth(-1)}
          >
            <ChevronLeft size={16} />
          </button>
          <span>
            {month.toLocaleDateString('ru-RU', {
              month: 'long',
              year: 'numeric',
            })}
          </span>
          <button
            className="icon-button"
            aria-label="Следующий месяц"
            onClick={() => changeMonth(1)}
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </div>
      <div className="calendar-week">
        {['ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ', 'ВС'].map((d) => (
          <span key={d}>{d}</span>
        ))}
      </div>
      <div className="calendar-grid">
        {Array.from({ length: count }, (_, i) => {
          const n = i - first + 1,
            valid = n > 0 && n <= days,
            date = dayKey(new Date(month.getFullYear(), month.getMonth(), n));
          const tx = transactions.filter((t) => txDate(t) === date),
            taskCount = tasks.filter(
              (t) => dayKey(new Date(t.deadline!)) === date,
            ).length;
          const plus = tx
              .filter((t) => t.type === 'income')
              .reduce((a, t) => a + t.amount_minor, 0),
            minus = tx
              .filter((t) => t.type !== 'income')
              .reduce((a, t) => a + t.amount_minor, 0);
          return (
            <button
              disabled={!valid}
              key={i}
              className={`calendar-day ${date === today ? 'today' : ''} ${date === selectedDay ? 'selected' : ''}`}
              onClick={() => onSelectDay(date)}
              aria-label={`${date}: приход ${currency(plus)}, расход ${currency(minus)}, задач ${taskCount}`}
              aria-pressed={date === selectedDay}
            >
              {valid && (
                <>
                  <span className="day-number">{n}</span>
                  {plus > 0 && (
                    <span
                      className="day-amount green-text"
                      style={{
                        background: `rgb(16 185 129 / ${0.07 + 0.16 * Math.min(1, plus / maxAmount)})`,
                      }}
                    >
                      +{compactMoney(plus)}
                    </span>
                  )}
                  {minus > 0 && (
                    <span
                      className="day-amount red-text"
                      style={{
                        background: `rgb(240 100 120 / ${0.06 + 0.14 * Math.min(1, minus / maxAmount)})`,
                      }}
                    >
                      −{compactMoney(minus)}
                    </span>
                  )}
                  {taskCount > 0 && (
                    <span className="day-tasks">{taskCount} зад.</span>
                  )}
                </>
              )}
            </button>
          );
        })}
      </div>
      <div className="graph-footer">
        <span>
          <i className="dot green" />
          Приход <i className="dot red" />
          Расход <i className="dot violet" />
          Задачи
        </span>
        <button className="text-action" onClick={onAdd}>
          <Plus size={13} />
          Операция
        </button>
      </div>
      {selectedDay && (
        <div className="day-details">
          <div className="panel-heading">
            <span>
              {new Date(selectedDay + 'T12:00:00').toLocaleDateString('ru-RU', {
                day: 'numeric',
                month: 'long',
              })}
            </span>
            <span className="muted">
              {dayTx.length} операций · {dayTasks.length} задач
            </span>
          </div>
          {!dayTx.length && !dayTasks.length ? (
            <p className="muted">Свободный день. Добавьте плановую операцию.</p>
          ) : (
            <>
              {dayTx.map((tx) => (
                <TransactionRow
                  key={tx.id}
                  tx={tx}
                  busy={busy}
                  onSettle={onSettle}
                />
              ))}
              {dayTasks.map((t) => (
                <div className="day-task" key={t.id}>
                  <i className="dot violet" />
                  {t.title}
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </section>
  );
}
function compactMoney(minor: number) {
  const v = minor / 100;
  return v >= 1000000
    ? `${(v / 1000000).toFixed(1)}м`
    : v >= 1000
      ? `${Number((v / 1000).toFixed(1))}к`
      : v.toLocaleString('ru-RU');
}
