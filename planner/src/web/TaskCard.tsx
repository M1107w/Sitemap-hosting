import { AnimatePresence, motion, useMotionValue, useTransform, animate } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';
import type { Task } from '../shared/types';
import { uid } from '../shared/time';
import { completeTask, discardTask, patchTask } from './store';
import { fmtDur, Icon, remainingMin, spring, TaskIcon, taskStyle, TINT } from './ui';
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
  const doneOpacity = useTransform(x, [24, 90], [0, 1]);
  const moveOpacity = useTransform(x, [-90, -24], [1, 0]);
  const dragged = useRef(false);
  const isDone = task.status === 'done';
  const stepsDone = task.subtasks.filter((s) => s.done).length;
  const progress = task.subtasks.length ? stepsDone / task.subtasks.length : isDone ? 1 : task.startedAt ? 0.15 : 0.04;
  const left = remainingMin(task);
  const tint = TINT[taskStyle(task).tint];

  return (
    <div className="relative">
      {/* swipe hints behind the row */}
      <div className="absolute inset-0 flex items-center justify-between px-4 text-[13px] font-medium">
        <motion.span style={{ opacity: doneOpacity }} className="flex items-center gap-1.5 text-green">
          <Icon name="check" className="h-4 w-4" /> Done
        </motion.span>
        <motion.span style={{ opacity: moveOpacity }} className="flex items-center gap-1.5 text-muted">
          Move <Icon name="clock" className="h-4 w-4" />
        </motion.span>
      </div>

      <motion.div
        style={{ x }}
        drag={expanded ? false : 'x'}
        dragDirectionLock
        dragConstraints={{ left: 0, right: 0 }}
        dragElastic={0.5}
        onDragStart={() => (dragged.current = true)}
        onDragEnd={(_, info) => {
          setTimeout(() => (dragged.current = false), 50);
          if (info.offset.x > 90) {
            animate(x, 420, { duration: 0.2, ease: [0.2, 0.8, 0.2, 1] }).then(() => {
              completeTask(task.id);
              x.set(0);
            });
          } else if (info.offset.x < -90) {
            animate(x, 0, spring);
            onReschedule();
          }
        }}
        className={`gpu relative rounded-[20px] transition-colors duration-200 ${expanded ? 'bg-raised' : 'bg-card'}`}
      >
        <div className="flex items-center gap-3.5 px-3 py-3" onClick={() => !dragged.current && onToggle()}>
          <div className={isDone ? 'opacity-40' : ''}>
            <TaskIcon task={task} />
          </div>
          <div className="min-w-0 flex-1">
            <div className={`truncate text-[15px] font-medium leading-snug ${isDone ? 'text-muted line-through' : ''}`}>{task.title}</div>
            <div className="mt-[7px] h-[3px] overflow-hidden rounded-full bg-line">
              <motion.div
                className={`h-full origin-left rounded-full ${tint.bar}`}
                initial={false}
                animate={{ scaleX: Math.max(0.04, progress) }}
                transition={spring}
                style={{ width: '100%' }}
              />
            </div>
          </div>
          <div className="shrink-0 self-start pt-0.5 text-right">
            <div className={`text-[13px] ${overdueLabel ? 'text-red' : 'text-muted'}`}>{overdueLabel ?? task.dueTime ?? 'any time'}</div>
            <div className="mt-0.5 text-[11.5px] text-faint">
              {task.subtasks.length ? `${stepsDone}/${task.subtasks.length} · ` : ''}
              {fmtDur(left)}
            </div>
          </div>
        </div>

        <AnimatePresence initial={false}>
          {expanded && (
            <motion.div
              key="detail"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ ...spring, opacity: { duration: 0.16 } }}
              className="overflow-hidden"
            >
              <Detail task={task} onReschedule={onReschedule} onEdit={onEdit} />
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}

function Detail({ task, onReschedule, onEdit }: { task: Task; onReschedule: () => void; onEdit: () => void }) {
  const [step, setStep] = useState('');
  const [notes, setNotes] = useState(task.notes);
  useEffect(() => setNotes(task.notes), [task.notes]);
  const tint = TINT[taskStyle(task).tint];

  const addStep = () => {
    const title = step.trim();
    if (!title) return;
    const m = title.match(/^(.*?)\s+(\d+)\s*m(in)?$/i);
    patchTask(task.id, { subtasks: [...task.subtasks, { id: uid(), title: m ? m[1] : title, done: false, estimateMin: m ? Number(m[2]) : 0 }] });
    setStep('');
  };

  return (
    <div className="px-3 pb-3">
      {task.priority === 1 && <div className="mb-2 ml-[54px] text-[11px] font-medium uppercase tracking-wider text-red">High priority</div>}
      <div className="ml-[54px] space-y-0.5">
        {task.subtasks.map((s, i) => (
          <motion.div
            key={s.id}
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.03, duration: 0.18 }}
            className="flex items-center gap-3 py-1.5"
          >
            <button
              onClick={() => patchTask(task.id, { subtasks: task.subtasks.map((x) => (x.id === s.id ? { ...x, done: !x.done } : x)), startedAt: task.startedAt ?? Date.now() })}
              className={`press grid h-5 w-5 shrink-0 place-items-center rounded-[6px] border ${s.done ? `border-transparent ${tint.bar} text-bg` : 'border-faint'}`}
              aria-label={s.done ? 'Untick step' : 'Tick step'}
            >
              {s.done && <Icon name="check" className="h-3.5 w-3.5" stroke={3} />}
            </button>
            <span className={`flex-1 text-[14px] ${s.done ? 'text-muted line-through' : ''}`}>{s.title}</span>
            {s.estimateMin > 0 && <span className="text-[12px] text-faint">{fmtDur(s.estimateMin)}</span>}
            <button onClick={() => patchTask(task.id, { subtasks: task.subtasks.filter((x) => x.id !== s.id) })} className="text-faint" aria-label="Remove step">
              <Icon name="x" className="h-3.5 w-3.5" />
            </button>
          </motion.div>
        ))}
        <div className="flex items-center gap-3 py-1.5">
          <span className="grid h-5 w-5 place-items-center text-faint">
            <Icon name="plus" className="h-4 w-4" />
          </span>
          <input
            value={step}
            onChange={(e) => setStep(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addStep()}
            onBlur={addStep}
            placeholder="Add a step"
            className="flex-1 text-[14px] placeholder:text-faint"
          />
        </div>
      </div>

      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        onBlur={() => notes !== task.notes && patchTask(task.id, { notes })}
        placeholder="Notes"
        rows={Math.min(10, Math.max(2, notes.split('\n').reduce((a, l) => a + Math.max(1, Math.ceil(l.length / 38)), 0)))}
        className="mt-2 w-full resize-none rounded-2xl bg-bg/70 px-3.5 py-3 text-[14px] leading-relaxed placeholder:text-faint"
      />

      <div className="mt-3 grid grid-cols-4 gap-2">
        <Action
          icon="check"
          label={task.status === 'done' ? 'Undo' : 'Done'}
          hot
          onClick={() => (task.status === 'done' ? patchTask(task.id, { status: 'open', completedAt: null }) : completeTask(task.id))}
        />
        <Action icon="clock" label="Move" onClick={onReschedule} />
        <Action icon="talk" label="Talk" onClick={() => navigate(`/call?mode=checkin&task=${task.id}`)} />
        <Action icon="trash" label="Drop" onClick={() => discardTask(task.id)} />
      </div>
      <button onClick={onEdit} className="press mt-2 w-full py-2 text-center text-[12.5px] text-faint">
        Edit details
      </button>
    </div>
  );
}

function Action({ icon, label, onClick, hot }: { icon: Parameters<typeof Icon>[0]['name']; label: string; onClick: () => void; hot?: boolean }) {
  return (
    <button onClick={onClick} className={`press flex flex-col items-center gap-1 rounded-2xl py-2.5 text-[12px] ${hot ? 'bg-fg text-bg' : 'bg-bg/70 text-muted'}`}>
      <Icon name={icon} className={`h-[18px] w-[18px] ${hot ? '' : 'text-fg'}`} />
      {label}
    </button>
  );
}
