'use client';
import { useFocalData } from '@/hooks/use-focal-data';
import FocusOverlay from './focus-overlay';
import TaskFields from './task-fields';
import TaskHub, { TrashView, readyTask } from './task-hub';
import QuickCapture from './quick-capture';
import { DayCapacity, ResumeWork, EstimateInsights } from './workflow-insights';
import DayFinish from './day-finish';
import PersonalSettings from './personal-settings';
import { useEffect, useRef, useState, type SubmitEvent } from 'react';
import Link from 'next/link';
import {
  ArrowUpRight,
  Check,
  Focus,
  Headphones,
  LayoutDashboard,
  ListTodo,
  Plus,
  Sparkles,
  Wallet,
  Zap,
  Activity,
  CalendarDays,
  FileText,
  Download,
  DatabaseBackup,
  MoreHorizontal,
  Trash2,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { NativeSelect } from '@/components/ui/native-select';
import { createFocusAudio } from '@/lib/audio';
import Planner from './planner';
import Notes from './notes';
import TodayPlan from './today-plan';
import ScheduledNow from './reminders';
import { WeeklyReview } from './planning-tools';
import QuickSearch from './quick-search';
import BackupManager from './backup-manager';
import NoteEditor from './note-editor';
import LifeSpace, { TaskWorkspace } from './life-space';
import { Studio, ForecastPanel } from './deferred';
import Motion from './motion';
import { WeekScene } from './time-machine';
import { focusInRange } from '@/lib/planning';
import { atLocalTime, addDays } from '@/lib/calendar';
import {
  currency,
  dayKey,
  energyProfile,
  rankTasks,
  shortDate,
  txDate,
  type Task,
  type Note,
} from '@/lib/domain';
import {
  EnergyGraph,
  CashCalendar,
  TransactionRow,
  Blank,
  Field,
} from './sections';

type Modal = 'task' | 'energy' | 'transaction' | 'start' | 'cancel' | null;
const audioLabels: Record<string, string> = {
  none: 'Тишина',
  binaural: 'Бинауральный тон',
  isochronic: 'Изохронный пульс',
  baroque: 'Барочная миниатюра',
};
const phases: Record<string, string> = {
  preparation: 'Подготовка',
  work: 'Глубокий фокус',
  break: 'Перерыв',
  completed: 'Цикл завершён',
  cancelled: 'Сессия прервана',
};
const tabs = [
  { id: 'overview', label: 'Сегодня', icon: LayoutDashboard },
  { id: 'tasks', label: 'Задачи', icon: ListTodo },
  { id: 'calendar', label: 'Календарь', icon: CalendarDays },
  { id: 'notes', label: 'Заметки', icon: FileText },
  { id: 'energy', label: 'Энергия', icon: Activity },
  { id: 'finance', label: 'Финансы', icon: Wallet },
  { id: 'life', label: 'Привычки и решения', icon: ListTodo },
  { id: 'studio', label: 'Помощник', icon: Sparkles },
  { id: 'review', label: 'Обзор недели', icon: Activity },
  { id: 'inbox', label: 'Входящие', icon: FileText },
  { id: 'trash', label: 'Корзина', icon: Trash2 },
  { id: 'settings', label: 'Настройки', icon: DatabaseBackup },
];
export default function Dashboard() {
  const [captureOpen, setCaptureOpen] = useState(false);
  const [hubFilter, setHubFilter] = useState('open');
  const [hubKey, setHubKey] = useState(0);
  const [finishDay, setFinishDay] = useState(false);
  const [tab, setTab] = useState('overview'),
    [modal, setModal] = useState<Modal>(null),
    [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [energy, setEnergy] = useState(5);
  const [plannerDate, setPlannerDate] = useState(''),
    [plannerTask, setPlannerTask] = useState<string | undefined>();
  const [startPreset, setStartPreset] = useState('standard');
  const [workspaceTask, setWorkspaceTask] = useState<string | null>(null);
  const [plannerEvent, setPlannerEvent] = useState<string | undefined>(),
    [globalNote, setGlobalNote] = useState<Note | null | undefined>(),
    [backupOpen, setBackupOpen] = useState(false);
  const [month, setMonth] = useState<Date | null>(null),
    [selectedDay, setSelectedDay] = useState('');
  const [focusId, setFocusId] = useState<string | null>(null),
    [audioEnabled, setAudioEnabled] = useState(false);
  const {
    data,
    now,
    busy,
    error,
    setError,
    notice,
    setNotice,
    refresh,
    mutate,
    serverOffset,
  } = useFocalData(setFocusId);
  const audio = useRef<Awaited<ReturnType<typeof createFocusAudio>> | null>(
    null,
  );
  useEffect(() => {
    const initialize = setTimeout(() => {
      const date = new Date();
      const requestedTab = window.location.hash.slice(1);
      if (tabs.some((t) => t.id === requestedTab)) setTab(requestedTab);
      setMonth(new Date(date.getFullYear(), date.getMonth(), 1));
      setSelectedDay(dayKey());
      setPlannerDate(dayKey());
    }, 0);
    return () => {
      clearTimeout(initialize);
      audio.current?.close();
    };
  }, []);
  useEffect(() => {
    const handle = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.code === 'Space') {
        e.preventDefault();
        setCaptureOpen(true);
      }
    };
    window.addEventListener('keydown', handle);
    return () => window.removeEventListener('keydown', handle);
  }, []);
  const hasData = !!data;
  useEffect(() => {
    if (hasData) window.history.replaceState(null, '', `#${tab}`);
  }, [tab, hasData]);
  const session = data?.sessions.find((s) => s.id === focusId),
    activeSession = data?.sessions.find((s) =>
      ['preparation', 'work', 'break'].includes(s.phase),
    );
  const remaining =
    session && now
      ? Math.max(
          0,
          Math.ceil((Date.parse(session.phase_ends_at) - now.getTime()) / 1000),
        )
      : 0;
  useEffect(() => {
    if (
      session &&
      !session.paused_at &&
      ['preparation', 'work', 'break'].includes(session.phase)
    ) {
      const timer = setTimeout(
        () => void refresh(),
        Math.max(
          0,
          Date.parse(session.phase_ends_at) - Date.now() - serverOffset.current,
        ),
      );
      return () => clearTimeout(timer);
    }
  }, [session, remaining, refresh, serverOffset]);
  const audible =
    audioEnabled &&
    session?.phase === 'work' &&
    !session.paused_at &&
    remaining > 0;
  useEffect(() => {
    audio.current?.set(session?.audio_type || 'none', audible);
  }, [session?.audio_type, audible]);
  function openTask(task: Task | null = null) {
    setSelectedTask(task);
    setModal('task');
    setError('');
  }
  function startTask(task: Task) {
    setSelectedTask(task);
    setModal('start');
    setError('');
    setStartPreset('standard');
  }
  function scheduleTask(id: string) {
    setPlannerTask(id);
    setTab('calendar');
  }
  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget));
    let payload: Record<string, unknown> = {};
    if (modal === 'task')
      payload = {
        action: 'task.save',
        ...values,
        id: selectedTask?.id,
        required_energy: Number(values.required_energy),
        estimated_minutes: Number(values.estimated_minutes || 30),
        recurrence:
          values.repeat_mode && values.repeat_mode !== 'none'
            ? {
                mode: values.repeat_mode,
                every: Number(values.repeat_every || 1),
                day: Number(values.repeat_day || 1),
              }
            : null,
        deadline:
          typeof values.deadline === 'string' && values.deadline
            ? new Date(values.deadline).toISOString()
            : null,
      };
    if (modal === 'energy')
      payload = { action: 'energy.add', energy_level: energy };
    if (modal === 'transaction')
      payload = {
        action: 'transaction.add',
        ...values,
        actual_date: values.settled === 'yes' ? values.planned_date : null,
      };
    if (modal === 'start') {
      payload = {
        action: 'session.start',
        task_id: selectedTask?.id,
        ...values,
        dopamine_debt_duration: Number(values.dopamine_debt_duration),
        work_duration: Number(values.work_duration),
        break_duration: Number(values.break_duration),
      };
      if (values.audio_type !== 'none')
        try {
          audio.current?.close();
          audio.current = await createFocusAudio();
          setAudioEnabled(true);
        } catch {
          setNotice('Звук недоступен. Сессия начнётся в тишине.');
        }
    }
    if (modal === 'cancel')
      payload = { action: 'session.cancel', id: session?.id };
    const result = await mutate(
      payload,
      modal === 'start'
        ? 'Сессия началась'
        : modal === 'energy'
          ? 'Энергия отмечена'
          : 'Сохранено',
    );
    if (result) {
      setModal(null);
      if (payload.action === 'session.start')
        setFocusId(
          result.sessions.find((s) =>
            ['preparation', 'work', 'break'].includes(s.phase),
          )?.id || null,
        );
    }
  }
  async function toggleAudio() {
    if (!audio.current)
      try {
        audio.current = await createFocusAudio();
      } catch {
        setError('Браузер не смог включить звук.');
        return;
      }
    setAudioEnabled((v) => !v);
  }
  const view = data && now ? energyProfile(data.energy_logs, now) : null,
    pending = data ? rankTasks(data.tasks, view?.value ?? null) : [];
  const suggested = pending.filter(
    (t) => !t.planned_date || !now || t.planned_date <= dayKey(now),
  );
  const recommendation =
    view?.value != null
      ? suggested.find((t) => t.required_energy <= view.value!)
      : suggested[0];
  const today = now ? dayKey(now) : '',
    monthKey = month ? dayKey(month).slice(0, 7) : '';
  const monthTransactions =
    data?.transactions.filter(
      (t) => t.type !== 'penalty' && txDate(t).startsWith(monthKey),
    ) || [];
  const income = monthTransactions
      .filter((t) => t.type === 'income')
      .reduce((a, t) => a + t.amount_minor, 0),
    expenses = monthTransactions
      .filter((t) => t.type !== 'income')
      .reduce((a, t) => a + t.amount_minor, 0);
  const completedToday =
    data?.tasks.filter(
      (t) => t.completed_at && dayKey(new Date(t.completed_at)) === today,
    ).length || 0;
  const focusMinutes =
    data && now
      ? Math.round(
          focusInRange(
            data.sessions,
            atLocalTime(now, 0),
            addDays(atLocalTime(now, 0), 1),
            now,
          ),
        )
      : 0;
  const editTime = selectedTask?.deadline
    ? (() => {
        const d = new Date(selectedTask.deadline!);
        return `${dayKey(d)}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
      })()
    : '';
  const energyCard = (
    <section className="panel energy-card">
      <div className="panel-heading">
        <span className="eyebrow">
          <Zap size={15} /> ЭНЕРГИЯ СЕЙЧАС
        </span>
        <i className="dot green" />
      </div>
      <div className="energy-display">
        <h2 className="energy-number">
          {view?.value ?? '—'}
          <small>/ 10</small>
        </h2>
        <span className="energy-state">
          {view?.value == null
            ? 'Прислушайтесь к себе'
            : view.value >= 8
              ? 'На подъёме'
              : view.value >= 6
                ? 'В рабочем ритме'
                : 'Бережный режим'}
        </span>
      </div>
      <div className="energy-bars" aria-hidden="true">
        {Array.from({ length: 10 }, (_, i) => (
          <span key={i} className={i < (view?.value ?? 0) ? 'lit' : ''} />
        ))}
      </div>
      <p className="muted">{view?.source || 'Какой у вас запас энергии?'}</p>
      <button
        className="secondary full-width"
        onClick={() => {
          setEnergy(view?.value ?? 5);
          setModal('energy');
        }}
      >
        <Plus size={16} /> Отметить энергию
      </button>
    </section>
  );
  const calendar =
    data && month ? (
      <CashCalendar
        data={data}
        month={month}
        onMonth={setMonth}
        today={today}
        selectedDay={selectedDay}
        onSelectDay={setSelectedDay}
        onAdd={() => setModal('transaction')}
        busy={busy}
        onSettle={(id) =>
          void mutate(
            { action: 'transaction.settle', id },
            'Операция проведена сегодня',
          )
        }
      />
    ) : null;
  return (
    <Tabs
      value={tab}
      onValueChange={(value) => setTab(String(value))}
      className="app-shell"
    >
      <Motion
        mode={data?.settings?.motion || 'gentle'}
        paused={!!session}
        view={tab}
      />
      <div
        className={session ? 'background-app blacked-out' : 'background-app'}
        inert={session ? true : undefined}
      >
        <header className="topbar">
          <Link className="brand" href="/">
            <Focus />
            focal<span className="brand-dot">.</span>
          </Link>
          <TabsList variant="line" className="main-nav">
            {tabs
              .filter((t) =>
                ['overview', 'tasks', 'calendar', 'notes'].includes(t.id),
              )
              .map((t) => (
                <TabsTrigger key={t.id} value={t.id}>
                  <t.icon size={16} />
                  {t.label}
                </TabsTrigger>
              ))}
          </TabsList>
          <button
            className="icon-button quick-capture-trigger"
            aria-label="Быстрый ввод"
            title="Быстрый ввод · Ctrl+Shift+Space"
            onClick={() => setCaptureOpen(true)}
          >
            <Plus size={20} />
          </button>
          <details className="more-nav">
            <summary>
              <MoreHorizontal size={18} />
              {['overview', 'tasks', 'calendar', 'notes'].includes(tab)
                ? 'Ещё'
                : tabs.find((t) => t.id === tab)?.label || 'Ещё'}
            </summary>
            <div className="more-menu">
              {tabs
                .filter(
                  (t) =>
                    !['overview', 'tasks', 'calendar', 'notes'].includes(
                      t.id,
                    ) && !data?.settings?.hidden_sections?.includes(t.id),
                )
                .map((t) => (
                  <button
                    key={t.id}
                    className={tab === t.id ? 'selected' : ''}
                    onClick={(e) => {
                      setTab(t.id);
                      e.currentTarget
                        .closest('details')
                        ?.removeAttribute('open');
                    }}
                  >
                    <t.icon size={17} />
                    {t.label}
                  </button>
                ))}
            </div>
          </details>
          {data && (
            <QuickSearch
              data={data}
              disabled={!!session}
              commands={[
                {
                  id: 'focus',
                  label: activeSession
                    ? 'Вернуться к текущему фокусу'
                    : 'Начать фокус',
                  run: () => {
                    if (activeSession) setFocusId(activeSession.id);
                    else if (recommendation) startTask(recommendation);
                    else openTask();
                  },
                },
                {
                  id: 'overdue',
                  label: 'Показать просроченные задачи',
                  run: () => {
                    setHubFilter('overdue');
                    setHubKey((k) => k + 1);
                    setTab('tasks');
                  },
                },
                {
                  id: 'capture',
                  label: 'Записать мысль или задачу',
                  run: () => setCaptureOpen(true),
                },
                ...(selectedTask && readyTask(selectedTask)
                  ? [
                      {
                        id: 'tomorrow',
                        label:
                          'Перенести выбранную задачу на завтра: ' +
                          selectedTask.title,
                        run: () =>
                          void mutate({
                            action: 'task.plan',
                            id: selectedTask.id,
                            planned_date: dayKey(
                              addDays(new Date(data.server_now), 1),
                            ),
                            is_priority: false,
                          }),
                      },
                    ]
                  : []),
              ]}
              onTask={(task) => {
                if (task.status === 'pending') openTask(task);
                else {
                  setTab('tasks');
                  setWorkspaceTask(task.id);
                }
              }}
              onNote={setGlobalNote}
              onEvent={(event) => {
                setPlannerDate(dayKey(new Date(event.start_at)));
                setPlannerEvent(event.id);
                setTab('calendar');
              }}
              onDate={(date) => {
                setPlannerDate(date);
                setTab('calendar');
              }}
              onCreate={(kind) => {
                if (kind === 'task') openTask();
                else if (kind === 'note') setGlobalNote(null);
                else {
                  setPlannerDate(today);
                  setPlannerEvent('new');
                  setTab('calendar');
                }
              }}
            />
          )}
          <span className="local-label">
            <i />
            Локально на устройстве
          </span>
        </header>
        <main className="workspace">
          <div className="page-heading">
            <div>
              <p className="eyebrow">
                {now
                  ? now.toLocaleDateString('ru-RU', {
                      weekday: 'long',
                      day: 'numeric',
                      month: 'long',
                    })
                  : 'ВАШЕ ПРОСТРАНСТВО'}
              </p>
              <h1>{tabs.find((t) => t.id === tab)?.label || 'Сегодня'}</h1>
            </div>
            {['overview', 'tasks', 'finance', 'energy'].includes(tab) && (
              <button
                className="primary"
                onClick={() =>
                  tab === 'finance'
                    ? setModal('transaction')
                    : tab === 'energy'
                      ? setModal('energy')
                      : openTask()
                }
              >
                <Plus size={17} />
                {tab === 'finance'
                  ? 'Добавить операцию'
                  : tab === 'energy'
                    ? 'Отметить энергию'
                    : 'Новая задача'}
              </button>
            )}
          </div>
          {error && !modal && (
            <div className="error-banner" role="alert">
              {error}
              <button
                className="text-action"
                onClick={() => {
                  setError('');
                  void refresh();
                }}
              >
                Повторить
              </button>
            </div>
          )}
          {!data ? (
            <section className="panel empty-panel">
              <Focus />
              <p>Открываем ваше пространство…</p>
            </section>
          ) : (
            <>
              {now && (
                <ScheduledNow
                  data={data}
                  now={now}
                  mutate={mutate}
                  busy={busy}
                  onStart={startTask}
                  onCalendar={() => {
                    setPlannerDate(today);
                    setTab('calendar');
                  }}
                />
              )}
              {activeSession && (
                <button
                  className="resume-banner"
                  onClick={() => setFocusId(activeSession.id)}
                >
                  <span>
                    <i className="dot green" />
                    {phases[activeSession.phase]} ·{' '}
                    {
                      data.tasks.find((t) => t.id === activeSession.task_id)
                        ?.title
                    }
                  </span>
                  <span>
                    Вернуться к таймеру <ArrowUpRight size={16} />
                  </span>
                </button>
              )}
              <TabsContent value="overview">
                <DayCapacity data={data} mutate={mutate} busy={busy} />
                <ResumeWork
                  data={data}
                  onStart={startTask}
                  onOpen={(t) => {
                    setWorkspaceTask(t.id);
                    setSelectedTask(t);
                  }}
                  disabled={!!activeSession || busy}
                />
                <TodayPlan
                  data={data}
                  date={today}
                  mutate={mutate}
                  busy={busy}
                  onStart={startTask}
                  onSchedule={scheduleTask}
                  onAdd={() => openTask()}
                />
                <section
                  className={
                    data.events.some(
                      (e) =>
                        !e.completed_at &&
                        Date.parse(e.end_at) > (now?.getTime() || 0),
                    )
                      ? 'panel next-event'
                      : 'no-upcoming'
                  }
                >
                  {data.events.some(
                    (e) =>
                      !e.completed_at &&
                      Date.parse(e.end_at) > (now?.getTime() || 0),
                  ) && <h2>Ближайшее событие</h2>}
                  {(() => {
                    const event = data.events.find(
                      (e) =>
                        !e.completed_at &&
                        Date.parse(e.end_at) > (now?.getTime() || 0),
                    );
                    return event ? (
                      <>
                        <h3>{event.title}</h3>
                        <p className="muted">
                          {new Date(event.start_at).toLocaleString('ru-RU', {
                            day: 'numeric',
                            month: 'short',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </p>
                        <button
                          className="secondary"
                          onClick={() => {
                            setPlannerDate(dayKey(new Date(event.start_at)));
                            setPlannerEvent(event.id);
                            setTab('calendar');
                          }}
                        >
                          Открыть в календаре
                        </button>
                      </>
                    ) : (
                      <p className="muted">Ближайших встреч нет.</p>
                    );
                  })()}
                </section>
                {!data.tasks.some(
                  (t) =>
                    t.planned_date === today &&
                    t.is_priority &&
                    t.status === 'pending',
                ) &&
                  recommendation && (
                    <section className="panel">
                      <h2>Начать с одного дела</h2>
                      <p>{recommendation.title}</p>
                      <button
                        className="primary"
                        disabled={!!activeSession}
                        onClick={() => startTask(recommendation)}
                      >
                        Начать фокус
                      </button>
                    </section>
                  )}
                <div className="day-summary">
                  <span>
                    {focusMinutes} мин фокуса · {completedToday} задач завершено
                  </span>
                  <button
                    className="secondary"
                    onClick={() => setFinishDay(true)}
                  >
                    Завершить день
                  </button>
                </div>
              </TabsContent>
              <TabsContent value="review">
                <EstimateInsights data={data} mutate={mutate} busy={busy} />
                {now && <WeeklyReview data={data} now={now} />}
                <EnergyGraph
                  logs={data.energy_logs}
                  now={now!}
                  onAdd={() => setModal('energy')}
                />
              </TabsContent>
              <TabsContent value="calendar">
                <details className="panel">
                  <summary>Объёмная неделя</summary>
                  <WeekScene
                    data={data}
                    date={plannerDate || today}
                    onDate={setPlannerDate}
                  />
                </details>
                {plannerDate && (
                  <Planner
                    data={data}
                    date={plannerDate}
                    onDate={setPlannerDate}
                    mutate={mutate}
                    busy={busy}
                    error={error}
                    initialTaskId={plannerTask}
                    initialEventId={plannerEvent}
                    onEventUsed={() => setPlannerEvent(undefined)}
                    onInitialUsed={() => setPlannerTask(undefined)}
                    onOpenNotes={(date) => {
                      setPlannerDate(date);
                      setTab('notes');
                    }}
                  />
                )}
              </TabsContent>
              <TabsContent value="notes">
                {plannerDate && (
                  <Notes
                    notes={data.notes}
                    date={plannerDate}
                    onDate={setPlannerDate}
                    mutate={mutate}
                    busy={busy}
                    error={error}
                    onSchedule={scheduleTask}
                  />
                )}
              </TabsContent>
              <TabsContent value="tasks">
                <TaskHub
                  key={hubKey}
                  data={data}
                  mutate={mutate}
                  busy={busy}
                  initialFilter={hubFilter}
                  onAdd={() => openTask()}
                  onOpen={(t) => setWorkspaceTask(t.id)}
                  onStart={startTask}
                  onSchedule={scheduleTask}
                />
                <details className="panel">
                  <summary>Проекты</summary>
                  <LifeSpace
                    data={data}
                    mutate={mutate}
                    busy={busy}
                    onTask={(task) => setWorkspaceTask(task.id)}
                    mode="projects"
                  />
                </details>
                {data.sessions.length > 0 && (
                  <>
                    <div className="section-heading">
                      <h2>Последние сессии</h2>
                      <span className="muted">
                        Цикл не закрывает задачу автоматически
                      </span>
                    </div>
                    <section className="panel">
                      {data.sessions.slice(0, 8).map((s) => (
                        <div className="history-row" key={s.id}>
                          <Focus size={17} />
                          <div>
                            <p>
                              {
                                data.tasks.find((t) => t.id === s.task_id)
                                  ?.title
                              }
                            </p>
                            <span className="muted">
                              {shortDate(s.started_at)} · {s.work_duration} мин
                              работы
                            </span>
                          </div>
                          <span
                            className={
                              s.is_successful === 1 ? 'green-text' : 'muted'
                            }
                          >
                            {phases[s.phase]}
                          </span>
                        </div>
                      ))}
                    </section>
                  </>
                )}
              </TabsContent>
              <TabsContent value="energy">
                <div className="energy-page-grid">
                  <EnergyGraph
                    logs={data.energy_logs}
                    now={now!}
                    onAdd={() => setModal('energy')}
                  />
                  {energyCard}
                </div>
                <div className="section-heading">
                  <h2>Отметки энергии</h2>
                  <span className="muted">Шкала от 1 до 10</span>
                </div>
                <section className="panel">
                  {data.energy_logs.length ? (
                    data.energy_logs.slice(0, 30).map((log) => (
                      <div className="history-row" key={log.id}>
                        <Zap size={17} />
                        <div>
                          <p>
                            {shortDate(log.logged_at)} ·{' '}
                            {new Date(log.logged_at).toLocaleTimeString(
                              'ru-RU',
                              { hour: '2-digit', minute: '2-digit' },
                            )}
                          </p>
                          <span className="muted">Ваша отметка</span>
                        </div>
                        <span className="green-text">
                          {log.energy_level} / 10
                        </span>
                      </div>
                    ))
                  ) : (
                    <Blank title="У каждого свой ритм" icon={<Activity />}>
                      Отмечайте состояние в течение дня. Когда накопятся данные,
                      появится средняя энергия по часам.
                    </Blank>
                  )}
                </section>
              </TabsContent>
              <TabsContent value="finance">
                <details className="panel">
                  <summary>Условные штрафы — отдельно от бюджета</summary>
                  {data.transactions
                    .filter((t) => t.type === 'penalty')
                    .map((t) => (
                      <div className="history-row" key={t.id}>
                        <span>
                          {t.category} · {currency(t.amount_minor)}
                        </span>
                        <button
                          className="subtle"
                          disabled={busy}
                          onClick={() => {
                            if (
                              window.confirm(
                                'Вы действительно потратили эту сумму? Записать её как реальный расход сегодня?',
                              )
                            )
                              void mutate(
                                { action: 'penalty.settle', id: t.id },
                                'Расход проведён',
                              );
                          }}
                        >
                          Записать фактический расход
                        </button>
                      </div>
                    ))}
                </details>
                <ForecastPanel data={data} mutate={mutate} />
                <div className="finance-stats">
                  <section className="panel">
                    <span className="stat-label">
                      Приход за выбранный месяц
                    </span>
                    <strong className="green-text">+{currency(income)}</strong>
                    <span className="muted">Плановые и проведённые</span>
                  </section>
                  <section className="panel">
                    <span className="stat-label">
                      Расход за выбранный месяц
                    </span>
                    <strong className="red-text">−{currency(expenses)}</strong>
                    <span className="muted">Без условных штрафов</span>
                  </section>
                  <section className="panel">
                    <span className="stat-label">Денежный поток</span>
                    <strong>{currency(income - expenses)}</strong>
                    <span className="muted">Приход минус расход</span>
                  </section>
                </div>
                <div className="finance-grid">
                  {calendar}
                  <section className="panel">
                    <div className="panel-heading">
                      <h2>Операции месяца</h2>
                      <span className="count">{monthTransactions.length}</span>
                    </div>
                    {monthTransactions.length ? (
                      monthTransactions.map((tx) => (
                        <TransactionRow
                          key={tx.id}
                          tx={tx}
                          busy={busy}
                          onSettle={(id) =>
                            void mutate(
                              { action: 'transaction.settle', id },
                              'Операция проведена сегодня',
                            )
                          }
                        />
                      ))
                    ) : (
                      <Blank title="У месяца пока нет планов" icon={<Wallet />}>
                        Добавьте ожидаемый доход или расход. Они появятся в
                        календаре.
                      </Blank>
                    )}
                    <button
                      className="secondary full-width"
                      onClick={() => setModal('transaction')}
                    >
                      <Plus size={16} /> Добавить операцию
                    </button>
                    <p className="footnote">
                      Условные штрафы не влияют на остаток. Банковские списания
                      не выполняются.
                    </p>
                  </section>
                </div>
              </TabsContent>
              <TabsContent value="life">
                <LifeSpace
                  data={data}
                  mutate={mutate}
                  busy={busy}
                  onTask={(task) => setWorkspaceTask(task.id)}
                />
              </TabsContent>
              <TabsContent value="inbox">
                <LifeSpace
                  mode="inbox"
                  data={data}
                  mutate={mutate}
                  busy={busy}
                  onTask={(t) => setWorkspaceTask(t.id)}
                />
              </TabsContent>
              <TabsContent value="trash">
                <TrashView data={data} mutate={mutate} busy={busy} />
              </TabsContent>
              <TabsContent value="settings">
                <PersonalSettings data={data} mutate={mutate} busy={busy} />
                <Studio
                  mode="settings"
                  data={data}
                  mutate={mutate}
                  onTask={startTask}
                  onNote={setGlobalNote}
                  onCalendar={setPlannerDate}
                />
                <button
                  className="secondary"
                  onClick={() => setBackupOpen(true)}
                >
                  Резервные копии и восстановление
                </button>
              </TabsContent>
              <TabsContent value="studio">
                <Studio
                  data={data}
                  mutate={mutate}
                  onTask={(task) => setWorkspaceTask(task.id)}
                  onNote={(note) => setGlobalNote(note)}
                  onCalendar={(date) => {
                    setPlannerDate(date);
                    setTab('calendar');
                  }}
                />
              </TabsContent>
            </>
          )}
        </main>
        <footer className="app-footer">
          <span>
            <Focus size={14} />
            focal. · Пространство внимания
          </span>
          <a className="text-action" href="/api/backup" download>
            <Download size={14} />
            Скачать резервную копию
          </a>
          <button
            className="text-action"
            onClick={() => {
              setError('');
              setBackupOpen(true);
            }}
            disabled={!data}
          >
            <DatabaseBackup size={15} />
            Восстановить данные
          </button>
          <span>Ваши данные остаются на этом устройстве</span>
        </footer>
      </div>
      {data && finishDay && (
        <DayFinish
          data={data}
          mutate={mutate}
          close={() => setFinishDay(false)}
        />
      )}
      {data && backupOpen && (
        <BackupManager
          data={data}
          mutate={mutate}
          busy={busy}
          error={error}
          close={() => setBackupOpen(false)}
          onRestored={() => {
            setBackupOpen(false);
            setGlobalNote(undefined);
            setPlannerEvent(undefined);
            setPlannerTask(undefined);
            setModal(null);
            setFocusId(null);
            setAudioEnabled(false);
            setTab('overview');
          }}
        />
      )}
      {globalNote !== undefined && (
        <NoteEditor
          key={globalNote?.id || 'new'}
          note={globalNote}
          date={plannerDate || today}
          mutate={mutate}
          busy={busy}
          error={error}
          onClose={() => setGlobalNote(undefined)}
          onSchedule={scheduleTask}
        />
      )}
      {session && data && (
        <FocusOverlay
          error={modal ? '' : error}
          refresh={refresh}
          session={session}
          data={data}
          busy={busy}
          mutate={mutate}
          onClose={() => {
            setFocusId(null);
            setAudioEnabled(false);
          }}
          onCancel={() => setModal('cancel')}
          audioEnabled={audioEnabled}
          toggleAudio={toggleAudio}
        />
      )}

      <Dialog
        open={modal !== null}
        onOpenChange={(open) => {
          if (!open && !busy) setModal(null);
        }}
      >
        <DialogContent className="focal-dialog" showCloseButton={!busy}>
          <DialogTitle>
            {modal === 'task'
              ? selectedTask
                ? 'Редактировать задачу'
                : 'Новая задача'
              : modal === 'energy'
                ? 'Как вы себя чувствуете?'
                : modal === 'transaction'
                  ? 'Новая операция'
                  : modal === 'start'
                    ? 'Один цикл. Одна задача.'
                    : session?.phase === 'break'
                      ? 'Закончить отдых?'
                      : 'Прервать сессию?'}
          </DialogTitle>
          <DialogDescription>
            {modal === 'task'
              ? 'Оцените нагрузку и задайте срок.'
              : modal === 'energy'
                ? 'Нет правильного значения. Отметьте своё состояние сейчас.'
                : modal === 'transaction'
                  ? 'Укажите сумму в тенге и дату операции.'
                  : modal === 'start'
                    ? selectedTask?.title
                    : session?.phase === 'break'
                      ? 'Рабочая часть уже завершена. Штрафа не будет.'
                      : data?.tasks.find((t) => t.id === session?.task_id)
                            ?.penalty_minor
                        ? `Задача останется доступной для продолжения. Условный штраф ${currency(data.tasks.find((t) => t.id === session?.task_id)!.penalty_minor)} сохранится отдельно от бюджета.`
                        : 'Отработанное время сохранится. Задача останется доступной для продолжения.'}
          </DialogDescription>
          <form
            key={`${modal}-${selectedTask?.id || 'new'}`}
            className="modal-form"
            onSubmit={submit}
          >
            {modal === 'task' && (
              <TaskFields selectedTask={selectedTask} editTime={editTime} />
            )}
            {modal === 'energy' && (
              <>
                <div className="energy-picker-number">
                  {energy}
                  <span>/ 10</span>
                </div>
                <Slider
                  aria-label="Уровень энергии"
                  min={1}
                  max={10}
                  step={1}
                  value={[energy]}
                  onValueChange={(v) => setEnergy(Array.isArray(v) ? v[0] : v)}
                />
                <div className="slider-labels">
                  <span>Мало сил</span>
                  <span>Много сил</span>
                </div>
              </>
            )}
            {modal === 'transaction' && (
              <>
                <div className="form-pair">
                  <Field label="Тип">
                    <NativeSelect name="type">
                      <option value="income">Приход</option>
                      <option value="expense">Расход</option>
                    </NativeSelect>
                  </Field>
                  <Field label="Сумма · ₸">
                    <input
                      name="amount"
                      required
                      inputMode="decimal"
                      pattern="[0-9]{1,9}([.,][0-9]{1,2})?"
                      placeholder="0,00"
                    />
                  </Field>
                </div>
                <Field label="Категория / назначение">
                  <input
                    name="category"
                    required
                    maxLength={160}
                    placeholder="Зарплата, продукты, аренда…"
                  />
                </Field>
                <Field label="Дата">
                  <input
                    name="planned_date"
                    type="date"
                    required
                    defaultValue={selectedDay || today}
                  />
                </Field>
                <label className="switch-field" htmlFor="transaction-settled">
                  <span>Операция уже проведена</span>
                  <Switch id="transaction-settled" name="settled" value="yes" />
                </label>
              </>
            )}
            {modal === 'start' && (
              <>
                {data?.checkpoints?.find(
                  (c) => c.task_id === selectedTask?.id,
                ) && (
                  <blockquote className="resume-card">
                    <small>Продолжите с прошлого места</small>
                    <p>
                      {
                        data.checkpoints.find(
                          (c) => c.task_id === selectedTask?.id,
                        )?.summary
                      }
                    </p>
                    <strong>
                      {
                        data.checkpoints.find(
                          (c) => c.task_id === selectedTask?.id,
                        )?.next_step
                      }
                    </strong>
                  </blockquote>
                )}
                <Field label="Режим старта">
                  <NativeSelect
                    value={startPreset}
                    onChange={(e) => setStartPreset(e.target.value)}
                  >
                    <option value="standard">Обычный · 10 / 50 / 10</option>
                    <option value="quick">
                      Короткий · сразу 15 минут работы
                    </option>
                    <option value="tiny">Первый шаг · сразу 5 минут</option>
                  </NativeSelect>
                </Field>
                <div className="form-triple" key={startPreset}>
                  <Field label="Подготовка">
                    <input
                      name="dopamine_debt_duration"
                      type="number"
                      min="0"
                      max="20"
                      required
                      defaultValue={startPreset === 'standard' ? '10' : '0'}
                    />
                  </Field>
                  <Field label="Фокус">
                    <input
                      name="work_duration"
                      type="number"
                      min="1"
                      max="120"
                      required
                      defaultValue={
                        startPreset === 'standard'
                          ? '50'
                          : startPreset === 'quick'
                            ? '15'
                            : '5'
                      }
                    />
                  </Field>
                  <Field label="Отдых">
                    <input
                      name="break_duration"
                      type="number"
                      min="1"
                      max="60"
                      required
                      defaultValue={startPreset === 'standard' ? '10' : '5'}
                    />
                  </Field>
                </div>
                <p className="footnote">
                  Длительность этапов в минутах. Подготовка — спокойный переход
                  к работе.
                </p>
                <Field label="Звуковое сопровождение">
                  <NativeSelect name="audio_type">
                    {Object.entries(audioLabels).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </NativeSelect>
                </Field>
                <p className="footnote">
                  <Headphones size={14} />
                  Звук включается во время работы. Для бинаурального тона нужны
                  наушники. Барочная миниатюра — синтезированный мотив.
                </p>
                {!!selectedTask?.penalty_minor && (
                  <p className="stake-note">
                    Ставка за прерывание или пропуск срока:{' '}
                    {currency(selectedTask.penalty_minor)} · только учёт
                  </p>
                )}
              </>
            )}
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <div className="modal-actions">
              <button
                className="secondary"
                disabled={busy}
                type="button"
                onClick={() => setModal(null)}
              >
                Отмена
              </button>
              <button
                className={
                  modal === 'cancel' && session?.phase !== 'break'
                    ? 'danger-button'
                    : 'primary'
                }
                disabled={busy}
              >
                {busy
                  ? 'Сохраняем…'
                  : modal === 'start'
                    ? 'Начать фокус'
                    : modal === 'cancel'
                      ? session?.phase === 'break'
                        ? 'Закончить отдых'
                        : data?.tasks.find((t) => t.id === session?.task_id)
                              ?.penalty_minor
                          ? 'Прервать с условным штрафом'
                          : 'Закончить сессию'
                      : modal === 'energy'
                        ? 'Сохранить отметку'
                        : 'Сохранить'}
              </button>
            </div>
          </form>
          {modal === 'task' && selectedTask && data && (
            <TaskWorkspace
              task={
                data.tasks.find((t) => t.id === selectedTask.id) || selectedTask
              }
              data={data}
              mutate={mutate}
            />
          )}
        </DialogContent>
      </Dialog>
      <QuickCapture
        open={captureOpen}
        setOpen={setCaptureOpen}
        mutate={mutate}
      />
      <Dialog
        open={!!workspaceTask}
        onOpenChange={(open) => {
          if (!open) setWorkspaceTask(null);
        }}
      >
        <DialogContent className="focal-dialog">
          <DialogTitle>
            {data?.tasks.find((t) => t.id === workspaceTask)?.title || 'Задача'}
          </DialogTitle>
          <DialogDescription>
            Материалы, проект и точка продолжения.
          </DialogDescription>
          {data && data.tasks.find((t) => t.id === workspaceTask) && (
            <>
              {data.notes.some(
                (n) =>
                  n.id ===
                  data.tasks.find((t) => t.id === workspaceTask)
                    ?.source_note_id,
              ) && (
                <button
                  className="text-action"
                  onClick={() => {
                    const note = data.notes.find(
                      (n) =>
                        n.id ===
                        data.tasks.find((t) => t.id === workspaceTask)
                          ?.source_note_id,
                    );
                    if (note) {
                      setWorkspaceTask(null);
                      setGlobalNote(note);
                    }
                  }}
                >
                  <FileText size={15} />
                  Исходная заметка
                </button>
              )}
              <TaskWorkspace
                task={data.tasks.find((t) => t.id === workspaceTask)!}
                data={data}
                mutate={mutate}
              />
              {data.tasks.find((t) => t.id === workspaceTask)?.status ===
                'pending' && (
                <div className="inline-fields">
                  <button
                    className="primary"
                    disabled={
                      busy ||
                      !!activeSession ||
                      !readyTask(
                        data.tasks.find((t) => t.id === workspaceTask)!,
                      )
                    }
                    onClick={() => {
                      const t = data.tasks.find((t) => t.id === workspaceTask)!;
                      setWorkspaceTask(null);
                      startTask(t);
                    }}
                  >
                    Начать фокус
                  </button>
                  <button
                    className="secondary"
                    onClick={() => {
                      const t = data.tasks.find((t) => t.id === workspaceTask)!;
                      setWorkspaceTask(null);
                      openTask(t);
                    }}
                  >
                    Редактировать
                  </button>
                </div>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>
      {notice && !session && (
        <output className="notice">
          <Check size={16} />
          {notice}
        </output>
      )}
    </Tabs>
  );
}
