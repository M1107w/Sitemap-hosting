import { AnimatePresence, motion, useMotionValue, useTransform, animate } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';
import type { Task } from '../shared/types';
import { uid } from '../shared/time';
import { completeTask, discardTask, patchTask } from './store';
import { fmtDur, Icon, PriorityDot, remainingMin, spring } from './ui';
import { navigate } from './router';

interface Props {
  task: Task;
  expanded: boolean;
  onToggle: () => void;
  onReschedule: () => void;
  onEdit: () => void;
  overdueLabel?: string;
}

export function TaskCard({ task, expanded, onToggle, onReschedule, onEdit, overdueLabel }: Props) {
  const x = useMotionValue(0);
  const doneOpacity = useTransform(x, [20, 90], [0, 1]);
  const moveOpacity = useTransform(x, [-90, -20], [1, 0]);
  const dragged = useRef(false);
  const isDone = task.status === 'done';
  const stepsDone = task.subtasks.filter((s) => s.done).length;
  const left = remainingMin(task);

  return (
    <motion.div layout="position" transition={spring} className="relative">
      {/* swipe backdrop */}
      <div className="absolute inset-0 flex items-center justify-between rounded-2xl px-5 text-sm font-medium">
        <motion.span style={{ opacity: doneOpacity }} className="flex items-center gap-1.5 text-ok">
          <Icon name="check" /> Done
        </motion.span>
        <motion.span style={{ opacity: moveOpacity }} className="flex items-center gap-1.5 text-muted">
          Move <Icon name="clock" />
        </motion.span>
      </div>
      <motion.div
        layout
        transition={spring}
        style={{ x }}
        drag={expanded ? false : 'x'}
        dragDirectionLock
        dragConstraints={{ left: 0, right: 0 }}
        dragElastic={0.5}
        onDragStart={() => (dragged.current = true)}
        onDragEnd={(_, info) => {
          setTimeout(() => (dragged.current = false), 50);
          if (info.offset.x > 90) {
            animate(x, 400, { duration: 0.18 }).then(() => {
              completeTask(task.id);
              x.set(0);
            });
          } else if (info.offset.x < -90) {
            animate(x, 0, spring);
            onReschedule();
          }
        }}
        className={`relative rounded-2xl border border-line bg-card ${expanded ? 'shadow-[0_8px_30px_rgba(0,0,0,0.06)]' : ''}`}
      >
        <motion.div layout="position" className="flex items-start gap-3 px-4 py-3.5" onClick={() => !dragged.current && onToggle()}>
          <PriorityDot p={task.priority} className="mt-[7px] shrink-0" />
          <div className="min-w-0 flex-1">
            <div className={`text-[15px] leading-snug ${isDone ? 'text-muted line-through' : ''}`}>{task.title}</div>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[13px] text-muted">
              {overdueLabel && <span className="text-accent">{overdueLabel}</span>}
              {task.dueTime && <span>{task.dueTime}</span>}
              <span>{fmtDur(left)}{left !== task.estimateMin ? ' left' : ''}</span>
              {task.subtasks.length > 0 && (
                <span>
                  {stepsDone}/{task.subtasks.length} steps
                </span>
              )}
              {task.startedAt && !isDone && <span className="text-ok">in progress</span>}
            </div>
            {task.subtasks.length > 0 && !expanded && (
              <div className="mt-2 h-[3px] overflow-hidden rounded-full bg-line">
                <motion.div className="h-full rounded-full bg-fg/60" animate={{ width: `${(stepsDone / task.subtasks.length) * 100}%` }} />
              </div>
            )}
          </div>
          <button
            aria-label={isDone ? 'Mark as not done' : 'Complete'}
            onClick={(e) => {
              e.stopPropagation();
              if (isDone) patchTask(task.id, { status: 'open', completedAt: null });
              else completeTask(task.id);
            }}
            className={`press -mr-1 grid h-8 w-8 shrink-0 place-items-center rounded-full border ${isDone ? 'border-ok bg-ok text-white' : 'border-line text-transparent hover:text-muted'}`}
          >
            <Icon name="check" className="h-4 w-4" stroke={2.4} />
          </button>
        </motion.div>

        <AnimatePresence initial={false}>
          {expanded && (
            <motion.div
              key="detail"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ ...spring, opacity: { duration: 0.15 } }}
              className="overflow-hidden"
            >
              <Detail task={task} onReschedule={onReschedule} onEdit={onEdit} />
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </motion.div>
  );
}

function Detail({ task, onReschedule, onEdit }: { task: Task; onReschedule: () => void; onEdit: () => void }) {
  const [step, setStep] = useState('');
  const [notes, setNotes] = useState(task.notes);
  useEffect(() => setNotes(task.notes), [task.notes]);

  const addStep = () => {
    const title = step.trim();
    if (!title) return;
    const m = title.match(/^(.*?)\s+(\d+)\s*m(in)?$/i);
    patchTask(task.id, {
      subtasks: [...task.subtasks, { id: uid(), title: m ? m[1] : title, done: false, estimateMin: m ? Number(m[2]) : 0 }],
    });
    setStep('');
  };

  return (
    <div className="px-4 pb-4">
      <div className="ml-5 space-y-0.5">
        {task.subtasks.map((s, i) => (
          <motion.div
            key={s.id}
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.03, duration: 0.18 }}
            className="group flex items-center gap-3 py-1.5"
          >
            <button
              onClick={() => patchTask(task.id, { subtasks: task.subtasks.map((x) => (x.id === s.id ? { ...x, done: !x.done } : x)), startedAt: task.startedAt ?? Date.now() })}
              className={`press grid h-[18px] w-[18px] shrink-0 place-items-center rounded-md border ${s.done ? 'border-fg bg-fg text-bg' : 'border-muted/60'}`}
              aria-label={s.done ? 'Untick step' : 'Tick step'}
            >
              {s.done && <Icon name="check" className="h-3 w-3" stroke={3} />}
            </button>
            <span className={`flex-1 text-[14px] ${s.done ? 'text-muted line-through' : ''}`}>{s.title}</span>
            {s.estimateMin > 0 && <span className="text-[12px] text-muted">{fmtDur(s.estimateMin)}</span>}
            <button
              onClick={() => patchTask(task.id, { subtasks: task.subtasks.filter((x) => x.id !== s.id) })}
              className="text-muted opacity-40 hover:opacity-100"
              aria-label="Remove step"
            >
              <Icon name="x" className="h-3.5 w-3.5" />
            </button>
          </motion.div>
        ))}
        <div className="flex items-center gap-3 py-1.5">
          <span className="grid h-[18px] w-[18px] place-items-center text-muted">
            <Icon name="plus" className="h-3.5 w-3.5" />
          </span>
          <input
            value={step}
            onChange={(e) => setStep(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addStep()}
            onBlur={addStep}
            placeholder="Add a step  (e.g. “Draft intro 20m”)"
            className="flex-1 text-[14px] placeholder:text-muted/70"
          />
        </div>
      </div>

      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        onBlur={() => notes !== task.notes && patchTask(task.id, { notes })}
        placeholder="Notes"
        rows={Math.min(10, Math.max(2, notes.split('\n').reduce((a, l) => a + Math.max(1, Math.ceil(l.length / 38)), 0)))}
        className="mt-3 w-full resize-none rounded-xl bg-bg px-3 py-2.5 text-[14px] leading-relaxed placeholder:text-muted/70"
      />

      <div className="mt-3 grid grid-cols-4 gap-2">
        <Action icon="check" label={task.status === 'done' ? 'Undo' : 'Done'} onClick={() => (task.status === 'done' ? patchTask(task.id, { status: 'open', completedAt: null }) : completeTask(task.id))} />
        <Action icon="clock" label="Move" onClick={onReschedule} />
        <Action icon="edit" label="Edit" onClick={onEdit} />
        <Action icon="trash" label="Drop" onClick={() => discardTask(task.id)} />
      </div>
      {task.status === 'open' && (
        <button onClick={() => navigate(`/call?mode=checkin&task=${task.id}`)} className="press mt-2 flex w-full items-center justify-center gap-2 rounded-xl py-2.5 text-[13px] text-muted">
          <Icon name="talk" className="h-4 w-4" /> Talk this one through
        </button>
      )}
    </div>
  );
}

function Action({ icon, label, onClick }: { icon: Parameters<typeof Icon>[0]['name']; label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="press flex flex-col items-center gap-1 rounded-xl bg-bg py-2.5 text-[12px] text-muted">
      <Icon name={icon} className="h-[18px] w-[18px] text-fg" />
      {label}
    </button>
  );
}
