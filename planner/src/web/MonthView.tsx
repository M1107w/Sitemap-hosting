import { motion, AnimatePresence } from 'framer-motion';
import { useMemo, useState } from 'react';
import type { Debrief, Task } from '../shared/types';
import { addDays, weekdayOf } from '../shared/time';
import { updateDebrief, useStore } from './store';
import { navigate } from './router';
import { dateLabel, Icon, sortTasks, today } from './ui';

const WEEK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function MonthView() {
  const tasks = useStore((s) => s.tasks);
  const settings = useStore((s) => s.settings);
  const debriefs = useStore((s) => s.debriefs);
  const t = today(settings.timezone);
  const [month, setMonth] = useState(t.slice(0, 7)); // YYYY-MM
  const [dir, setDir] = useState(0);

  const byDate = useMemo(() => {
    const m = new Map<string, Task[]>();
    for (const x of Object.values(tasks)) {
      if (x.status === 'discarded') continue;
      const list = m.get(x.date) ?? [];
      list.push(x);
      m.set(x.date, list);
    }
    for (const list of m.values()) list.sort((a, b) => (a.status === 'open' ? 0 : 1) - (b.status === 'open' ? 0 : 1) || sortTasks(a, b));
    return m;
  }, [tasks]);
  const debriefDates = new Set(debriefs.filter((d) => d.status === 'scheduled').map((d) => d.date));

  const first = `${month}-01`;
  const start = addDays(first, -((weekdayOf(first) + 6) % 7)); // Monday-first grid
  const days = Array.from({ length: 42 }, (_, i) => addDays(start, i));
  const rows = days[35].slice(0, 7) === month ? 6 : 5;
  const shift = (n: number) => {
    const [y, m] = month.split('-').map(Number);
    const d = new Date(Date.UTC(y, m - 1 + n, 1));
    setDir(n);
    setMonth(d.toISOString().slice(0, 7));
  };
  const label = new Date(first + 'T12:00:00').toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const upcoming = debriefs.filter((d) => d.status === 'scheduled' && d.date >= t).slice(0, 4);

  return (
    <div className="mx-auto max-w-3xl px-3 pb-28 pt-safe">
      <header className="flex items-end justify-between px-1 pb-4 pt-4">
        <h1 className="text-[30px] font-semibold leading-tight tracking-tight">{label}</h1>
        <div className="flex items-center gap-1 pb-1">
          {month !== t.slice(0, 7) && (
            <button onClick={() => (setDir(0), setMonth(t.slice(0, 7)))} className="press rounded-full border border-line px-3 py-1.5 text-[13px]">
              Today
            </button>
          )}
          <button aria-label="Previous month" onClick={() => shift(-1)} className="press grid h-9 w-9 place-items-center rounded-full text-muted">
            <Icon name="left" />
          </button>
          <button aria-label="Next month" onClick={() => shift(1)} className="press grid h-9 w-9 place-items-center rounded-full text-muted">
            <Icon name="right" />
          </button>
        </div>
      </header>

      <div className="grid grid-cols-7 pb-1.5 text-center text-[11px] font-medium uppercase tracking-wide text-muted">
        {WEEK.map((w) => (
          <div key={w}>{w}</div>
        ))}
      </div>

      <AnimatePresence mode="popLayout" initial={false} custom={dir}>
        <motion.div
          key={month}
          custom={dir}
          initial={{ opacity: 0, x: dir * 40 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: dir * -40 }}
          transition={{ duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }}
          drag="x"
          dragConstraints={{ left: 0, right: 0 }}
          dragElastic={0.2}
          onDragEnd={(_, i) => (i.offset.x < -60 ? shift(1) : i.offset.x > 60 ? shift(-1) : null)}
          className="grid grid-cols-7 overflow-hidden rounded-2xl border border-line bg-line"
          style={{ gap: 1 }}
        >
          {days.slice(0, rows * 7).map((d) => (
            <DayCell
              key={d}
              date={d}
              inMonth={d.slice(0, 7) === month}
              isToday={d === t}
              isPast={d < t}
              tasks={byDate.get(d) ?? []}
              heavy={settings.heavyDayMin}
              debrief={debriefDates.has(d)}
            />
          ))}
        </motion.div>
      </AnimatePresence>

      <div className="mt-3 flex items-center gap-4 px-1 text-[11px] text-muted">
        <span className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-accent" /> high priority</span>
        <span className="flex items-center gap-1.5"><Icon name="phone" className="h-3 w-3" /> debrief</span>
        <span className="flex items-center gap-1.5"><span className="h-[3px] w-4 rounded-full bg-fg/40" /> workload</span>
      </div>

      {upcoming.length > 0 && (
        <section className="mt-8 px-1">
          <div className="mb-2 text-[12px] font-medium uppercase tracking-wide text-muted">Upcoming debriefs</div>
          <div className="divide-y divide-line rounded-2xl border border-line bg-card">
            {upcoming.map((d) => (
              <DebriefRow key={d.id} d={d} t={t} />
            ))}
          </div>
          <p className="mt-2 text-[12px] text-muted">Planned from your calendar: start of the week, plus the night before big days. Edit or cancel one and it stays how you set it.</p>
        </section>
      )}
    </div>
  );
}

function DayCell({ date, inMonth, isToday, isPast, tasks, heavy, debrief }: { date: string; inMonth: boolean; isToday: boolean; isPast: boolean; tasks: Task[]; heavy: number; debrief: boolean }) {
  const open = tasks.filter((x) => x.status === 'open');
  const top = open[0] ?? tasks[0];
  const load = open.reduce((a, x) => a + x.estimateMin, 0);
  const allDone = tasks.length > 0 && open.length === 0;
  return (
    <button
      onClick={() => navigate(`/day/${date}`)}
      className={`relative flex min-h-[78px] flex-col bg-card p-1.5 text-left transition-colors active:bg-bg sm:min-h-[104px] sm:p-2 ${inMonth ? '' : 'opacity-40'}`}
    >
      <div className="flex items-center justify-between">
        <span className={`grid h-6 min-w-6 place-items-center rounded-full px-1 text-[12px] ${isToday ? 'bg-fg font-semibold text-bg' : isPast ? 'text-muted' : ''}`}>
          {Number(date.slice(8))}
        </span>
        {debrief && <Icon name="phone" className="h-3 w-3 text-muted" />}
      </div>
      {top && (
        <div
          className={`mt-1 line-clamp-2 hyphens-auto text-[10.5px] leading-[1.25] sm:text-[12px] ${
            allDone ? 'text-muted line-through' : top.priority === 1 ? 'font-medium text-accent' : ''
          }`}
        >
          {top.title}
        </div>
      )}
      <div className="mt-auto">
        {open.length > 1 && <div className="text-[10px] text-muted">+{open.length - 1}</div>}
        {load > 0 && (
          <div className="mt-0.5 h-[3px] overflow-hidden rounded-full bg-line">
            <div className={`h-full rounded-full ${load >= heavy ? 'bg-accent/70' : 'bg-fg/40'}`} style={{ width: `${Math.min(100, (load / heavy) * 100)}%` }} />
          </div>
        )}
      </div>
    </button>
  );
}

function DebriefRow({ d, t }: { d: Debrief; t: string }) {
  const [edit, setEdit] = useState(false);
  const [date, setDate] = useState(d.date);
  const [time, setTime] = useState(d.time);
  return (
    <div className="px-4 py-3">
      <div className="flex items-center gap-3">
        <div className="flex-1">
          <div className="text-[14px]">
            {dateLabel(d.date, t)} · {d.time}
          </div>
          <div className="text-[12px] text-muted">{d.reason}</div>
        </div>
        <button onClick={() => setEdit(!edit)} className="press text-[13px] text-muted">
          {edit ? 'Close' : 'Change'}
        </button>
      </div>
      {edit && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="rounded-lg border border-line px-2 py-1.5 text-sm" />
          <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="rounded-lg border border-line px-2 py-1.5 text-sm" />
          <button onClick={() => (updateDebrief(d.id, { date, time }), setEdit(false))} className="press rounded-lg bg-fg px-3 py-1.5 text-sm text-bg">
            Save
          </button>
          <button onClick={() => updateDebrief(d.id, { status: 'cancelled' })} className="press rounded-lg px-3 py-1.5 text-sm text-accent">
            Cancel it
          </button>
        </div>
      )}
    </div>
  );
}
