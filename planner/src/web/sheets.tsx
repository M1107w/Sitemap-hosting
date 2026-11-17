import { useEffect, useRef, useState } from 'react';
import type { Priority, Task } from '../shared/types';
import { addDays, hm, uid, weekdayOf } from '../shared/time';
import { getState, newTask, putTask, rescheduleTask } from './store';
import { Chip, dateLabel, nowMin, PRIORITY_LABEL, Sheet, today } from './ui';

export function RescheduleSheet({ task, onClose }: { task: Task | null; onClose: () => void }) {
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  useEffect(() => {
    if (task) {
      setDate(task.date);
      setTime(task.dueTime ?? '');
    }
  }, [task]);
  if (!task) return <Sheet open={false} onClose={onClose}>{null}</Sheet>;
  const tz = getState().settings.timezone;
  const t = today(tz);
  const now = nowMin(tz);
  const go = (d: string, time: string | null | undefined, label: string) => {
    rescheduleTask(task.id, d, time, label);
    onClose();
  };
  const plus1h = Math.min(23 * 60 + 59, Math.ceil((now + 60) / 15) * 15);
  const nextMon = addDays(t, ((8 - weekdayOf(t)) % 7) || 7);

  return (
    <Sheet open onClose={onClose} title={`Move “${task.title}”`}>
      <div className="flex flex-wrap gap-2">
        <Chip onClick={() => go(t, hm(plus1h), `${hm(plus1h)}`)}>+1 hour</Chip>
        <Chip onClick={() => go(t, now < 20 * 60 ? '20:00' : hm(Math.min(23 * 60 + 30, plus1h)), 'tonight')}>Tonight</Chip>
        <Chip onClick={() => go(addDays(t, 1), undefined, 'tomorrow')}>Tomorrow</Chip>
        <Chip onClick={() => go(addDays(t, 2), undefined, dateLabel(addDays(t, 2), t))}>{dateLabel(addDays(t, 2), t)}</Chip>
        <Chip onClick={() => go(nextMon, undefined, 'next week')}>Next week</Chip>
        {task.dueTime && <Chip onClick={() => go(task.date, null, 'any time')}>Remove time</Chip>}
      </div>
      <div className="mt-5 flex items-center gap-3">
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="flex-1 rounded-2xl border border-line bg-raised px-3 py-2.5" />
        <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="w-32 rounded-2xl border border-line bg-raised px-3 py-2.5" />
      </div>
      <button
        onClick={() => date && go(date, time || null, `${dateLabel(date, t)}${time ? ' ' + time : ''}`)}
        className="press mt-3 w-full rounded-2xl bg-fg py-3.5 text-[15px] font-medium text-bg"
      >
        Move
      </button>
    </Sheet>
  );
}

const ESTIMATES = [10, 15, 30, 45, 60, 90, 120, 180];

export function TaskEditor({ open, task, defaultDate, onClose }: { open: boolean; task: Task | null; defaultDate: string; onClose: () => void }) {
  const [title, setTitle] = useState('');
  const [priority, setPriority] = useState<Priority>(2);
  const [date, setDate] = useState(defaultDate);
  const [time, setTime] = useState('');
  const [est, setEst] = useState(30);
  const [steps, setSteps] = useState('');
  const [notes, setNotes] = useState('');
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setTitle(task?.title ?? '');
    setPriority(task?.priority ?? 2);
    setDate(task?.date ?? defaultDate);
    setTime(task?.dueTime ?? '');
    setEst(task?.estimateMin ?? 30);
    setSteps(task ? '' : '');
    setNotes(task?.notes ?? '');
    setTimeout(() => !task && titleRef.current?.focus(), 250);
  }, [open, task, defaultDate]);

  const save = () => {
    if (!title.trim()) return;
    const newSteps = steps
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => {
        const m = s.match(/^(.*?)\s+(\d+)\s*m(in)?$/i);
        return { id: uid(), title: m ? m[1] : s, done: false, estimateMin: m ? Number(m[2]) : 0 };
      });
    if (task) {
      putTask({ ...task, title: title.trim(), priority, date, dueTime: time || null, estimateMin: est, notes, subtasks: [...task.subtasks, ...newSteps] });
    } else {
      newTask({ title: title.trim(), priority, date, dueTime: time || null, estimateMin: est, notes, subtasks: newSteps });
    }
    onClose();
  };

  return (
    <Sheet open={open} onClose={onClose} title={task ? 'Edit task' : 'New task'}>
      <input
        ref={titleRef}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && save()}
        placeholder="What needs doing, sir?"
        className="w-full py-1 text-xl font-medium placeholder:text-faint"
      />
      <Label>Priority</Label>
      <div className="grid grid-cols-3 gap-2">
        {([1, 2, 3] as Priority[]).map((p) => (
          <button
            key={p}
            onClick={() => setPriority(p)}
            className={`press rounded-xl border py-2.5 text-sm ${priority === p ? (p === 1 ? 'border-red bg-red text-white' : 'border-fg bg-fg text-bg') : 'border-line bg-raised'}`}
          >
            {PRIORITY_LABEL[p]}
          </button>
        ))}
      </div>
      <Label>When</Label>
      <div className="flex items-center gap-2">
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="flex-1 rounded-2xl border border-line bg-raised px-3 py-2.5" />
        <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="w-32 rounded-2xl border border-line bg-raised px-3 py-2.5" />
      </div>
      <Label>How long</Label>
      <div className="flex flex-wrap gap-2">
        {ESTIMATES.map((m) => (
          <Chip key={m} active={est === m} onClick={() => setEst(m)}>
            {m < 60 ? `${m}m` : `${m / 60}h`}
          </Chip>
        ))}
        <input
          type="number"
          inputMode="numeric"
          value={est}
          onChange={(e) => setEst(Math.max(0, Number(e.target.value)))}
          className="w-20 rounded-full border border-line bg-raised px-3 py-2 text-sm"
          aria-label="Minutes"
        />
      </div>
      <Label>{task ? 'Add steps' : 'Steps'} <span className="font-normal">(one per line, “20m” at the end for time)</span></Label>
      <textarea value={steps} onChange={(e) => setSteps(e.target.value)} rows={3} placeholder={'Outline 20m\nDraft 60m'} className="w-full resize-none rounded-2xl border border-line bg-raised px-3 py-2.5 text-[15px] placeholder:text-faint" />
      <Label>Notes</Label>
      <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="w-full resize-none rounded-2xl border border-line bg-raised px-3 py-2.5 text-[15px]" />
      <button onClick={save} disabled={!title.trim()} className="press mt-4 w-full rounded-2xl bg-fg py-3.5 text-[15px] font-medium text-bg disabled:opacity-40">
        {task ? 'Save' : 'Add task'}
      </button>
    </Sheet>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <div className="mb-2 mt-5 text-[11px] font-medium uppercase tracking-wider text-faint">{children}</div>;
}
