import { motion, AnimatePresence } from 'framer-motion';
import { useMemo, useState } from 'react';
import type { Debrief, Task } from '../shared/types';
import { addDays, weekdayOf } from '../shared/time';
import { updateDebrief, useStore } from './store';
import { navigate } from './router';
import { dateLabel, Icon, sortTasks, spring, today } from './ui';

const WEEK = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

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
  const monthName = new Date(first + 'T12:00:00').toLocaleDateString(undefined, { month: 'long' });
  const year = first.slice(0, 4);
  const upcoming = debriefs.filter((d) => d.status === 'scheduled' && d.date >= t).slice(0, 4);
  const monthTasks = Object.values(tasks).filter((x) => x.date.startsWith(month) && x.status !== 'discarded');
  const monthDone = monthTasks.filter((x) => x.status === 'done').length;

  return (
    <div className="mx-auto max-w-3xl px-3 pb-36 pt-safe">
      <header className="flex items-end justify-between px-1 pb-4 pt-5">
        <div>
          <div className="text-[13px] text-muted">
            {year} · {monthDone}/{monthTasks.length} done
          </div>
          <h1 className="mt-0.5 text-[28px] font-medium leading-tight tracking-tight">{monthName}</h1>
        </div>
        <div className="flex items-center gap-1 pb-1">
          {month !== t.slice(0, 7) && (
            <button onClick={() => (setDir(0), setMonth(t.slice(0, 7)))} className="press rounded-full bg-raised px-3 py-1.5 text-[12.5px]">
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

      <div className="grid grid-cols-7 gap-1 pb-1.5 text-center text-[11px] font-medium text-faint">
        {WEEK.map((w, i) => (
          <div key={i}>{w}</div>
        ))}
      </div>

      <AnimatePresence mode="popLayout" initial={false} custom={dir}>
        <motion.div
          key={month}
          initial={{ opacity: 0, x: dir * 40 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: dir * -40 }}
          transition={{ duration: 0.24, ease: [0.2, 0.8, 0.2, 1] }}
          style={{ willChange: 'transform' }}
          drag="x"
          dragConstraints={{ left: 0, right: 0 }}
          dragElastic={0.18}
          onDragEnd={(_, i) => (i.offset.x < -60 ? shift(1) : i.offset.x > 60 ? shift(-1) : null)}
          className="grid grid-cols-7 gap-1"
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

      <div className="mt-3 flex items-center gap-4 px-1 text-[11px] text-faint">
        <span className="flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-red" /> high priority
        </span>
        <span className="flex items-center gap-1.5">
          <Icon name="brief" className="h-3 w-3 text-purple" /> debrief
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-[3px] w-4 rounded-full bg-accent" /> how busy
        </span>
      </div>

      {upcoming.length > 0 && (
        <section className="mt-6">
          <div className="mb-2 px-1 text-[11px] font-medium uppercase tracking-wider text-faint">Upcoming debriefs</div>
          <div className="overflow-hidden rounded-[24px] border border-line/70 bg-card">
            {upcoming.map((d, i) => (
              <DebriefRow key={d.id} d={d} t={t} first={i === 0} />
            ))}
          </div>
          <p className="mt-2 px-1 text-[12px] text-faint">Planned from your calendar, sir: start of the week, plus the night before big days.</p>
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
      className={`press relative flex min-h-[76px] flex-col rounded-[14px] bg-card p-1.5 text-left sm:min-h-[100px] sm:p-2 ${inMonth ? '' : 'opacity-30'} ${isToday ? 'ring-1 ring-fg/40' : ''}`}
    >
      <div className="flex items-center justify-between">
        <span className={`grid h-6 min-w-6 place-items-center rounded-full px-1 text-[12px] ${isToday ? 'bg-fg font-semibold text-bg' : isPast ? 'text-faint' : 'text-fg/90'}`}>
          {Number(date.slice(8))}
        </span>
        {debrief && <Icon name="brief" className="h-3 w-3 text-purple" />}
      </div>
      {top && (
        <div className={`mt-1 line-clamp-2 break-words text-[10px] leading-[1.25] sm:text-[12px] ${allDone ? 'text-faint line-through' : top.priority === 1 ? 'font-medium text-red' : 'text-fg/80'}`}>
          {top.title}
        </div>
      )}
      <div className="mt-auto">
        {open.length > 1 && <div className="text-[10px] text-faint">+{open.length - 1}</div>}
        {load > 0 && (
          <div className="mt-0.5 h-[3px] overflow-hidden rounded-full bg-line">
            <div className={`h-full rounded-full ${load >= heavy ? 'bg-red' : 'bg-accent'}`} style={{ width: `${Math.min(100, (load / heavy) * 100)}%` }} />
          </div>
        )}
      </div>
    </button>
  );
}

function DebriefRow({ d, t, first }: { d: Debrief; t: string; first: boolean }) {
  const [edit, setEdit] = useState(false);
  const [date, setDate] = useState(d.date);
  const [time, setTime] = useState(d.time);
  return (
    <div className={`px-4 py-3 ${first ? '' : 'border-t border-line/70'}`}>
      <button onClick={() => setEdit(!edit)} className="flex w-full items-center gap-3 text-left">
        <span className="grid h-9 w-9 place-items-center rounded-xl bg-purple/[0.14] text-purple">
          <Icon name="brief" className="h-[18px] w-[18px]" />
        </span>
        <div className="flex-1">
          <div className="text-[14px] font-medium">
            {dateLabel(d.date, t)} · {d.time}
          </div>
          <div className="text-[12px] text-muted">{d.reason}</div>
        </div>
        <motion.span animate={{ rotate: edit ? 180 : 0 }} transition={spring} className="text-faint">
          <Icon name="chevron" className="h-4 w-4" />
        </motion.span>
      </button>
      <AnimatePresence initial={false}>
        {edit && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={spring} className="overflow-hidden">
            <div className="flex flex-wrap items-center gap-2 pt-3">
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="rounded-xl border border-line bg-raised px-2 py-1.5 text-sm" />
              <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="rounded-xl border border-line bg-raised px-2 py-1.5 text-sm" />
              <button onClick={() => (updateDebrief(d.id, { date, time }), setEdit(false))} className="press rounded-xl bg-fg px-3 py-1.5 text-sm text-bg">
                Save
              </button>
              <button onClick={() => updateDebrief(d.id, { status: 'cancelled' })} className="press rounded-xl px-3 py-1.5 text-sm text-red">
                Cancel it
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
