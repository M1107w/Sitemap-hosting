import { AnimatePresence, LayoutGroup, motion } from 'framer-motion';
import { useEffect, useMemo, useState } from 'react';
import type { Settings, Task } from '../shared/types';
import { addDays, toMin } from '../shared/time';
import { openEditor, useStore } from './store';
import { TaskCard } from './TaskCard';
import { RescheduleSheet } from './sheets';
import { BlockBar, dateLabel, fmtDur, greetingFor, Icon, nowMin, remainingMin, sortTasks, spring, today } from './ui';
import { navigate } from './router';

/** The one-liner from the assistant at the top of the day. */
function assistantLine(open: Task[], carried: Task[], done: number, s: Settings, quiet: boolean, isToday: boolean, dayName: string) {
  if (quiet) return <>Quiet mode's on till <b>{s.wakeTime}</b>, sir. Sleep well.</>;
  if (!isToday) {
    const n = open.length;
    return n ? <>{n} lined up for {dayName}, sir. About <b>{fmtDur(open.reduce((a, t) => a + t.estimateMin, 0))}</b> of work.</> : <>Nothing planned for {dayName} yet, sir.</>;
  }
  const now = nowMin(s.timezone);
  const all = [...carried, ...open];
  if (!all.length) return done ? <>All done for today, sir. Nicely handled.</> : <>Nothing planned yet, sir. Tap <b>+</b> to add something.</>;
  const overdue = all.find((t) => t.dueTime && toMin(t.dueTime) < now) ?? carried[0];
  if (overdue) return <><b>{overdue.title}</b> {overdue.dueTime && overdue.date === today(s.timezone) ? <>was due at <b>{overdue.dueTime}</b></> : 'is overdue'}, sir. Swipe it left if you want to move it.</>;
  const next = open.filter((t) => t.dueTime).sort((a, b) => a.dueTime!.localeCompare(b.dueTime!))[0];
  if (next) {
    const mins = toMin(next.dueTime!) - now;
    if (mins <= 120) return <>Your <b>{next.title}</b> is up at <b>{next.dueTime}</b>, sir. That leaves you <b>{fmtDur(mins)}</b>.</>;
    return <>Next up is <b>{next.title}</b> at <b>{next.dueTime}</b>, sir. Plenty of time.</>;
  }
  return <>Top of the list: <b>{all.sort(sortTasks)[0].title}</b>, sir. Whenever you're ready.</>;
}

export function TodayView({ date: dateProp, focusTask }: { date?: string; focusTask?: string | null }) {
  const tasks = useStore((s) => s.tasks);
  const settings = useStore((s) => s.settings);
  const checkin = useStore((s) => s.checkin);
  const debriefs = useStore((s) => s.debriefs);
  const t = today(settings.timezone);
  const date = dateProp || t;
  const isToday = date === t;
  const [expanded, setExpanded] = useState<string | null>(focusTask ?? null);
  const [moving, setMoving] = useState<Task | null>(null);
  const [showDone, setShowDone] = useState(false);
  const [, tick] = useState(0);
  useEffect(() => {
    const h = setInterval(() => tick((n) => n + 1), 60_000); // keep "x minutes" fresh
    return () => clearInterval(h);
  }, []);

  const { open, carried, done } = useMemo(() => {
    const all = Object.values(tasks);
    return {
      open: all.filter((x) => x.date === date && x.status === 'open').sort(sortTasks),
      carried: isToday ? all.filter((x) => x.date < date && x.status === 'open').sort(sortTasks) : [],
      done: all.filter((x) => x.date === date && x.status === 'done').sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0)),
    };
  }, [tasks, date, isToday]);

  const planned = [...open, ...carried].reduce((a, x) => a + remainingMin(x), 0);
  const dayEnd = toMin(settings.windDown);
  const free = isToday ? Math.max(0, dayEnd - nowMin(settings.timezone) - planned) : Math.max(0, dayEnd - toMin(settings.wakeTime) - planned);
  const total = open.length + done.length + carried.length;
  const debrief = debriefs.find((d) => d.date === date && d.status === 'scheduled');
  const quiet = !!checkin && checkin.quietUntil > Date.now();
  const d = new Date(date + 'T12:00:00');
  const dayName = dateLabel(date, t);

  return (
    <div className="mx-auto max-w-lg px-4 pb-36 pt-safe">
      <header className="flex items-end justify-between pb-1 pt-5">
        <div className="min-w-0">
          <div className="text-[13px] text-muted">{d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}</div>
          <h1 className="mt-0.5 truncate text-[28px] font-medium leading-tight tracking-tight">{isToday ? greetingFor(nowMin(settings.timezone)) : dayName}</h1>
        </div>
        <div className="flex shrink-0 items-center gap-1 pb-1">
          {!isToday && (
            <button onClick={() => navigate('/')} className="press rounded-full bg-raised px-3 py-1.5 text-[12.5px]">
              Today
            </button>
          )}
          <button aria-label="Previous day" onClick={() => navigate(`/day/${addDays(date, -1)}`)} className="press grid h-9 w-9 place-items-center rounded-full text-muted">
            <Icon name="left" />
          </button>
          <button aria-label="Next day" onClick={() => navigate(`/day/${addDays(date, 1)}`)} className="press grid h-9 w-9 place-items-center rounded-full text-muted">
            <Icon name="right" />
          </button>
        </div>
      </header>

      {/* Summary card */}
      <motion.section layout="position" transition={spring} className="mt-4 rounded-[24px] border border-line/70 bg-card p-5">
        <div className="text-[34px] font-light leading-none tracking-tight">{fmtDur(planned)}</div>
        <div className="mt-2 text-[13px] text-muted">
          planned · {fmtDur(free)} free{quiet ? ' · quiet mode' : ''}
        </div>
        <BlockBar value={total ? done.length / total : 0} className="mt-5" />
        <div className="mt-2 flex justify-between text-[12px] text-muted">
          <span>
            {done.length} of {total} done
          </span>
          <span>{total ? Math.round((done.length / total) * 100) : 0}%</span>
        </div>
        <p className="mt-4 text-[14.5px] leading-relaxed text-fg/85 [&_b]:font-medium [&_b]:text-fg">
          {assistantLine(open, carried, done.length, settings, quiet, isToday, dayName.toLowerCase())}
        </p>
      </motion.section>

      {debrief && (
        <button
          onClick={() => navigate(`/call?mode=debrief&debrief=${debrief.id}`)}
          className="press mt-3 flex w-full items-center gap-3 rounded-[20px] border border-line/70 bg-card px-4 py-3 text-left"
        >
          <span className="grid h-10 w-10 place-items-center rounded-[13px] bg-purple/[0.14] text-purple">
            <Icon name="brief" />
          </span>
          <div className="flex-1">
            <div className="text-[14.5px] font-medium">Debrief at {debrief.time}</div>
            <div className="text-[12px] text-muted">{debrief.reason}</div>
          </div>
          <span className="text-[12px] text-muted">Start</span>
        </button>
      )}

      {/* Task list */}
      <LayoutGroup>
        {total > 0 && (
          <motion.section layout="position" transition={spring} className="mt-3 rounded-[24px] border border-line/70 bg-card p-1.5">
            {carried.length > 0 && <Label>Carried over</Label>}
            <AnimatePresence initial={false}>
              {carried.map((x) => (
                <Item key={x.id}>
                  <TaskCard
                    task={x}
                    overdueLabel={dateLabel(x.date, t).toLowerCase()}
                    expanded={expanded === x.id}
                    onToggle={() => setExpanded(expanded === x.id ? null : x.id)}
                    onReschedule={() => setMoving(x)}
                    onEdit={() => openEditor(date, x)}
                  />
                </Item>
              ))}
            </AnimatePresence>
            {carried.length > 0 && open.length > 0 && <Label>{isToday ? 'Today' : ''}</Label>}
            <AnimatePresence initial={false}>
              {open.map((x) => (
                <Item key={x.id}>
                  <TaskCard
                    task={x}
                    overdueLabel={isToday && x.dueTime && toMin(x.dueTime) < nowMin(settings.timezone) ? x.dueTime : undefined}
                    expanded={expanded === x.id}
                    onToggle={() => setExpanded(expanded === x.id ? null : x.id)}
                    onReschedule={() => setMoving(x)}
                    onEdit={() => openEditor(date, x)}
                  />
                </Item>
              ))}
            </AnimatePresence>
            {open.length === 0 && carried.length === 0 && <div className="px-4 py-5 text-center text-[13.5px] text-muted">Everything's ticked off.</div>}
          </motion.section>
        )}

        {total === 0 && (
          <motion.button
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            onClick={() => openEditor(date)}
            className="press mt-3 w-full rounded-[24px] border border-dashed border-line py-10 text-center"
          >
            <div className="text-[15px]">A clear day.</div>
            <div className="mt-1 text-[13px] text-muted">Tap to add something</div>
          </motion.button>
        )}

        {done.length > 0 && (
          <motion.div layout="position" transition={spring} className="mt-4">
            <button onClick={() => setShowDone(!showDone)} className="press flex items-center gap-1 px-2 py-2 text-[13px] text-muted">
              {showDone ? 'Hide' : 'Show'} done ({done.length})
              <motion.span animate={{ rotate: showDone ? 180 : 0 }} transition={spring}>
                <Icon name="chevron" className="h-4 w-4" />
              </motion.span>
            </button>
            <AnimatePresence initial={false}>
              {showDone && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={spring}
                  className="overflow-hidden rounded-[24px] border border-line/70 bg-card p-1.5"
                >
                  {done.map((x) => (
                    <TaskCard
                      key={x.id}
                      task={x}
                      expanded={expanded === x.id}
                      onToggle={() => setExpanded(expanded === x.id ? null : x.id)}
                      onReschedule={() => setMoving(x)}
                      onEdit={() => openEditor(date, x)}
                    />
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        )}
      </LayoutGroup>

      <RescheduleSheet task={moving} onClose={() => setMoving(null)} />
    </div>
  );
}

function Item({ children }: { children: React.ReactNode }) {
  return (
    <motion.div
      layout="position"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: 60, transition: { duration: 0.18 } }}
      transition={spring}
    >
      {children}
    </motion.div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  if (!children) return <div className="h-2" />;
  return <div className="px-3 pb-1 pt-3 text-[11px] font-medium uppercase tracking-wider text-faint">{children}</div>;
}
