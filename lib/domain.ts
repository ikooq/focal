import { workIntervals } from './session-time.ts';
export type Task = {
  id: string;
  title: string;
  brain_hemisphere: 'analytical' | 'creative';
  required_energy: number;
  penalty_minor: number;
  deadline: string | null;
  board_status?: 'planned' | 'doing' | 'waiting';
  waiting_reason?: string;
  tags_json?: string;
  dependencies_json?: string;
  recurrence_json?: string | null;
  recurrence_next_id?: string | null;
  estimate_applied_at?: string | null;
  series_key?: string | null;
  blocked_by?: string[];
  deadline_notified_at?: string | null;
  status: 'pending' | 'active' | 'completed' | 'failed';
  completed_at: string | null;
  planned_date?: string | null;
  is_priority?: number;
  estimated_minutes?: number;
  source_note_id?: string | null;
  project_id?: string | null;
  parent_task_id?: string | null;
  created_at?: string;
};
export type EnergyLog = { id: string; energy_level: number; logged_at: string };
export type Session = {
  paused_at?: string | null;
  pauses_json?: string;
  id: string;
  task_id: string;
  dopamine_debt_duration: number;
  work_duration: number;
  break_duration: number;
  audio_type: string;
  phase: 'preparation' | 'work' | 'break' | 'completed' | 'cancelled';
  phase_ends_at: string;
  started_at: string;
  is_successful: number | null;
  ended_at?: string | null;
};
export type Transaction = {
  id: string;
  type: 'income' | 'expense' | 'penalty';
  amount_minor: number;
  category: string;
  planned_date: string;
  actual_date: string | null;
  recurring_id?: string | null;
};
export type State = {
  trash?: {
    id: string;
    title: string;
    deleted_at: string;
    trash_batch: string;
    kind: string;
  }[];
  auto_backup?: {
    last_at: string | null;
    error: string | null;
    folder: string | null;
  };
  server_now: string;
  user: { username: string };
  tasks: Task[];
  energy_logs: EnergyLog[];
  sessions: Session[];
  transactions: Transaction[];
  notes: Note[];
  events: CalendarEvent[];
  templates: WeekTemplate[];
  calendar_undo: { label: string; created_at: string } | null;
  projects?: Project[];
  habits?: Habit[];
  habit_checks?: { id: string; habit_id: string; check_date: string }[];
  decisions?: Decision[];
  checkpoints?: Checkpoint[];
  thoughts?: Thought[];
  resources?: Material[];
  flows?: Flow[];
  settings?: Settings;
};
export type Project = {
  id: string;
  title: string;
  description: string;
  target_date: string | null;
  color: string;
  archived: number;
};
export type Habit = {
  id: string;
  title: string;
  target_per_week: number;
  archived: number;
  color: string;
};
export type Decision = {
  id: string;
  title: string;
  reasons: string;
  expected: string;
  outcome: string;
  decided_on: string;
  review_on: string | null;
  reviewed_at: string | null;
};
export type Checkpoint = {
  id: string;
  task_id: string;
  session_id: string | null;
  summary: string;
  next_step: string;
  created_at: string;
};
export type Thought = {
  id: string;
  task_id: string | null;
  session_id: string | null;
  body: string;
  created_at: string;
  resolved_at: string | null;
};
export type Material = {
  id: string;
  task_id: string | null;
  note_id: string | null;
  title: string;
  url: string | null;
  mime: string | null;
  size: number;
  created_at: string;
};
export type Flow = {
  id: string;
  title: string;
  type: 'income' | 'expense';
  amount_minor: number;
  frequency: 'weekly' | 'monthly';
  start_date: string;
  end_date: string | null;
  enabled: number;
};
export type Settings = {
  saved_views?: {
    id: string;
    name: string;
    filter: { query: string; tag: string; project: string; status: string };
  }[];
  hidden_sections?: string[];
  hidden_life_sections?: string[];
  auto_backup?: boolean;
  backup_folder?: string;
  day_start?: number;
  day_end?: number;
  daily_limit?: number;
  buffer_minutes?: number;
  session_minutes?: number;
  opening_balance_minor?: number;
  balance_date?: string;
  motion?: 'full' | 'gentle' | 'off';
};
export type Note = {
  id: string;
  title: string;
  body: string;
  note_date: string;
  created_at: string;
  updated_at: string;
};
export type TemplateBlock = {
  title: string;
  description: string;
  color: CalendarEvent['color'];
  reminder_minutes: number;
  day: number;
  hour: number;
  minute: number;
  duration: number;
};
export type WeekTemplate = {
  id: string;
  name: string;
  blocks_json: string;
  created_at: string;
};
export type CalendarEvent = {
  id: string;
  title: string;
  description: string;
  start_at: string;
  end_at: string;
  color: 'emerald' | 'sky' | 'violet' | 'rose' | 'amber';
  task_id: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  series_id?: string | null;
  series_exception?: number;
  reminder_minutes?: number;
  snoozed_until?: string | null;
  reminder_dismissed_at?: string | null;
  is_fixed?: number;
  external_uid?: string | null;
};
export type Mutate = (
  payload: Record<string, unknown>,
  message?: string,
) => Promise<State | null>;
export const dayKey = (date = new Date()) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
export const currency = (minor: number) =>
  new Intl.NumberFormat('ru-RU', {
    style: 'currency',
    currency: 'KZT',
    maximumFractionDigits: minor % 100 ? 2 : 0,
  }).format(minor / 100);
export const shortDate = (date: string) =>
  new Date(date).toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'short',
  });
export const txDate = (tx: Transaction) => tx.actual_date || tx.planned_date;
export const signed = (tx: Transaction) =>
  tx.type === 'penalty'
    ? 0
    : tx.type === 'income'
      ? tx.amount_minor
      : -tx.amount_minor;
export function energyProfile(logs: EnergyLog[], now = new Date()) {
  const buckets: Record<string, number[]> = {};
  for (const l of logs) {
    const d = new Date(l.logged_at);
    if (
      d.getTime() > now.getTime() ||
      now.getTime() - d.getTime() > 7 * 86400000
    )
      continue;
    const key = `${dayKey(d)}|${d.getHours()}`;
    (buckets[key] ||= []).push(l.energy_level);
  }
  const daily = Array.from({ length: 24 }, () => [] as number[]);
  Object.entries(buckets).forEach(([k, v]) =>
    daily[Number(k.split('|')[1])].push(
      v.reduce((a, b) => a + b, 0) / v.length,
    ),
  );
  const points = daily.map((v, hour) => ({
    hour,
    value: v.length ? v.reduce((a, b) => a + b, 0) / v.length : null,
    days: v.length,
  }));
  const current = points[now.getHours()];
  const latest = logs
    .filter((l) => new Date(l.logged_at).getTime() <= now.getTime())
    .sort((a, b) => b.logged_at.localeCompare(a.logged_at))[0];
  const fresh =
    latest &&
    now.getTime() - new Date(latest.logged_at).getTime() < 2 * 3600000;
  const value =
    current.days >= 2
      ? Math.round(current.value!)
      : fresh
        ? latest.energy_level
        : null;
  const source =
    current.days >= 2
      ? `Среднее в этот час · ${current.days} дн. из 7`
      : fresh
        ? 'По последней отметке за 2 часа'
        : 'Отметьте энергию для подбора';
  return { points, value, source, latest };
}
export function rankTasks(tasks: Task[], energy: number | null) {
  return tasks
    .filter(
      (t) =>
        t.status === 'pending' &&
        t.board_status !== 'waiting' &&
        !t.blocked_by?.length,
    )
    .sort((a, b) => {
      if (energy !== null) {
        const fitA = a.required_energy <= energy,
          fitB = b.required_energy <= energy;
        if (fitA !== fitB) return fitA ? -1 : 1;
        if (energy >= 8 && a.required_energy !== b.required_energy)
          return b.required_energy - a.required_energy;
      }
      return (a.deadline || '9999').localeCompare(b.deadline || '9999');
    });
}
export function focusMinutesToday(sessions: Session[], today: Date) {
  const start = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
  ).getTime();
  const end = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate() + 1,
  ).getTime();
  return Math.round(
    sessions
      .filter((s) => s.is_successful === 1)
      .reduce((total, s) => {
        return (
          total +
          workIntervals(
            s,
            new Date(s.ended_at || '9999-01-01T00:00:00Z'),
          ).reduce(
            (sum, work) =>
              sum +
              Math.max(
                0,
                Math.min(end, work.end) - Math.max(start, work.start),
              ) /
                60000,
            0,
          )
        );
      }, 0),
  );
}
