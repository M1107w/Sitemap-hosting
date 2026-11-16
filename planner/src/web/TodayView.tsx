import { AnimatePresence, LayoutGroup, motion } from 'framer-motion';
import { useMemo, useState } from 'react';
import type { Task } from '../shared/types';
import { addDays, toMin } from '../shared/time';
import { setSleep, useStore } from './store';
import { TaskCard } from './TaskCard';
import { RescheduleSheet, TaskEditor } from './sheets';
import { dateLabel, fmtDur, Icon, nowMin, remainingMin, sortTasks, today } from './ui';
import { navigate } from './router';

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
  const [editing, setEditing] = useState<Task | null>(null);
  const [adding, setAdding] = useState(false);
  const [showDone, setShowDone] = useState(false);

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
  const quiet = checkin && checkin.quietUntil > Date.now();

  const d = new Date(date + 'T12:00:00');
  return (
    <div className="mx-auto max-w-lg px-4 pb-28 pt-safe">
      <header className="flex items-end justify-between pb-1 pt-4">
        <div>
          <div className="text-[13px] text-muted">{d.toLocaleDateString(undefined, { day: 'numeric', month: 'long' })}</div>
          <h1 className="text-[30px] font-semibold leading-tight tracking-tight">{isToday ? 'Today' : dateLabel(date, t)}</h1>
        </div>
        <div className="flex items-center gap-1 pb-1">
          {!isToday && (
            <button onClick={() => navigate('/')} className="press rounded-full border border-line px-3 py-1.5 text-[13px]">
              Today
            </button>
          )}
          <button aria-label="Previous day" onClick={() => navigate(`/day/${addDays(date, -1)}`)} className="press grid h-9 w-9 place-items-center rounded-full text-muted">
            <Icon name="left" />
          </button>
          <button aria-label="Next day" onClick={() => navigate(`/day/${addDays(date, 1)}`)} className="press grid h-9 w-9 place-items-center rounded-full text-muted">
            <Icon name="right" />
          </button>
          {isToday && (
            <button
              aria-label={quiet ? 'Wake up: allow check-ins' : "I'm going to sleep"}
              onClick={() => setSleep(!quiet)}
              className={`press grid h-9 w-9 place-items-center rounded-full ${quiet ? 'bg-fg text-bg' : 'text-muted'}`}
            >
              <Icon name="moon" className="h-[18px] w-[18px]" />
            </button>
          )}
        </div>
      </header>

      <div className="mb-4 text-[13px] text-muted">
        {total === 0 ? 'Nothing planned' : `${open.length + carried.length} to do · ${fmtDur(planned)} planned · ${fmtDur(free)} free`}
        {quiet && ' · quiet till ' + settings.wakeTime}
      </div>
      {total > 0 && (
        <div className="mb-5 h-[3px] overflow-hidden rounded-full bg-line">
          <motion.div className="h-full rounded-full bg-ok" initial={false} animate={{ width: `${(done.length / total) * 100}%` }} transition={{ duration: 0.4 }} />
        </div>
      )}

      {debrief && (
        <button
          onClick={() => navigate(`/call?mode=debrief&debrief=${debrief.id}`)}
          className="press mb-4 flex w-full items-center gap-3 rounded-2xl border border-dashed border-line px-4 py-3 text-left"
        >
          <Icon name="phone" className="h-4 w-4 text-muted" />
          <div className="flex-1 text-[14px]">
            Debrief at {debrief.time}
            <div className="text-[12px] text-muted">{debrief.reason}</div>
          </div>
          <span className="text-[12px] text-muted">Start now</span>
        </button>
      )}

      <LayoutGroup>
        {carried.length > 0 && <SectionLabel>Carried over</SectionLabel>}
        <div className="space-y-2.5">
          <AnimatePresence initial={false}>
            {carried.map((x) => (
              <Item key={x.id}>
                <TaskCard
                  task={x}
                  overdueLabel={dateLabel(x.date, t).toLowerCase()}
                  expanded={expanded === x.id}
                  onToggle={() => setExpanded(expanded === x.id ? null : x.id)}
                  onReschedule={() => setMoving(x)}
                  onEdit={() => setEditing(x)}
                />
              </Item>
            ))}
          </AnimatePresence>
        </div>
        {carried.length > 0 && open.length > 0 && <SectionLabel>{isToday ? 'Today' : ''}</SectionLabel>}
        <div className="space-y-2.5">
          <AnimatePresence initial={false}>
            {open.map((x) => (
              <Item key={x.id}>
                <TaskCard
                  task={x}
                  overdueLabel={isToday && x.dueTime && toMin(x.dueTime) < nowMin(settings.timezone) ? 'overdue' : undefined}
                  expanded={expanded === x.id}
                  onToggle={() => setExpanded(expanded === x.id ? null : x.id)}
                  onReschedule={() => setMoving(x)}
                  onEdit={() => setEditing(x)}
                />
              </Item>
            ))}
          </AnimatePresence>
        </div>

        {total === 0 && (
          <motion.button initial={{ opacity: 0 }} animate={{ opacity: 1 }} onClick={() => setAdding(true)} className="press mt-10 w-full py-10 text-center text-muted">
            <div className="text-[15px]">A clear day.</div>
            <div className="mt-1 text-[13px]">Tap to add something</div>
          </motion.button>
        )}

        {done.length > 0 && (
          <motion.div layout className="mt-6">
            <button onClick={() => setShowDone(!showDone)} className="press py-2 text-[13px] text-muted">
              {showDone ? 'Hide' : 'Show'} done ({done.length})
            </button>
            <AnimatePresence>
              {showDone && (
                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="space-y-2.5 overflow-hidden">
                  {done.map((x) => (
                    <TaskCard
                      key={x.id}
                      task={x}
                      expanded={expanded === x.id}
                      onToggle={() => setExpanded(expanded === x.id ? null : x.id)}
                      onReschedule={() => setMoving(x)}
                      onEdit={() => setEditing(x)}
                    />
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        )}
      </LayoutGroup>

      <RescheduleSheet task={moving} onClose={() => setMoving(null)} />
      <TaskEditor open={adding || !!editing} task={editing} defaultDate={date} onClose={() => (setAdding(false), setEditing(null))} />
      <AnimatePresence>{!(expanded && tasks[expanded]?.date === date && tasks[expanded]?.status !== 'discarded') && <AddButton onClick={() => setAdding(true)} />}</AnimatePresence>
    </div>
  );
}

function Item({ children }: { children: React.ReactNode }) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: 60, height: 0, marginTop: 0, transition: { duration: 0.2 } }}
      transition={{ type: 'spring', stiffness: 500, damping: 40 }}
    >
      {children}
    </motion.div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  if (!children) return <div className="h-4" />;
  return <div className="mb-2 mt-5 text-[12px] font-medium uppercase tracking-wide text-muted first:mt-0">{children}</div>;
}

export function AddButton({ onClick }: { onClick: () => void }) {
  return (
    <motion.button
      initial={{ scale: 0.6, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      exit={{ scale: 0.6, opacity: 0 }}
      transition={{ type: 'spring', stiffness: 500, damping: 30 }}
      aria-label="Add task"
      onClick={onClick}
      className="press fixed bottom-[calc(env(safe-area-inset-bottom)+76px)] right-5 z-30 grid h-14 w-14 place-items-center rounded-full bg-fg text-bg shadow-lg"
    >
      <Icon name="plus" className="h-6 w-6" stroke={2.2} />
    </motion.button>
  );
}
