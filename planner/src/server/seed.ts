import type { Task } from '../shared/types';
import { addDays, uid, zoned } from '../shared/time';

/** A few example tasks so the app isn't empty on first open. Easy to delete. */
export function seedTasks(now: number, tz: string): Task[] {
  const today = zoned(now, tz).date;
  const mk = (p: Partial<Task> & { title: string }): Task => ({
    id: uid(),
    notes: '',
    priority: 2,
    date: today,
    dueTime: null,
    estimateMin: 30,
    status: 'open',
    subtasks: [],
    startedAt: null,
    completedAt: null,
    createdAt: now,
    updatedAt: now,
    ...p,
  });
  const steps = (...titles: [string, number][]) => titles.map(([title, estimateMin]) => ({ id: uid(), title, done: false, estimateMin }));
  return [
    mk({
      title: 'Welcome: tap me',
      priority: 1,
      estimateMin: 5,
      notes: 'Tap a task to open it. Swipe right to complete, swipe left to reschedule. The ＋ button adds tasks. Delete these examples whenever.',
      subtasks: steps(['Open a task', 1], ['Tick a step', 1], ['Turn on notifications in Settings', 2], ['Try a voice check-in', 1]),
    }),
    mk({ title: 'Gym: push day', priority: 2, dueTime: '18:00', estimateMin: 75, subtasks: steps(['Warm-up', 10], ['Bench 4×8', 20], ['Shoulders', 20], ['Stretch', 10]) }),
    mk({ title: 'Reply to emails', priority: 3, estimateMin: 20 }),
    mk({ title: 'Plan the week', priority: 2, date: addDays(today, 1), dueTime: '10:00', estimateMin: 30 }),
    mk({ title: 'Big deadline', priority: 1, date: addDays(today, 3), dueTime: '12:00', estimateMin: 180, subtasks: steps(['Outline', 30], ['Draft', 90], ['Review', 30], ['Submit', 10]) }),
  ];
}
