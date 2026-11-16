// Pure scheduling logic: reminders, debrief planning, check-in decisions.
// Kept free of I/O so it can be unit-tested.
import type { CheckinState, Debrief, Settings, Task } from '../shared/types';
import { addDays, toEpoch, toMin, weekdayOf, zoned, uid } from '../shared/time';

const MIN = 60_000;

// ---------------------------------------------------------------- reminders

/** Epoch ms when a task is due, or null if it has no time. */
export function dueAtOf(task: Task, tz: string): number | null {
  if (!task.dueTime) return null;
  return toEpoch(task.date, task.dueTime, tz);
}

/** Stop nagging this long after the due time (overnight safety net). */
export const NAG_LIMIT_MS = 24 * 60 * MIN;

/**
 * Which alarm step applies at `now`:
 *  -1 = nothing yet, 0 = heads-up (lead), 1 = due now, 2+ = snooze repeats.
 * Snooze runs every `snoozeEveryMin`, then every `snoozeFastEveryMin` once
 * `snoozeFastAfterMin` have passed since the due time.
 */
export function reminderIndexAt(dueAt: number, now: number, s: Settings): number {
  const lead = Math.max(0, s.reminderLeadMin) * MIN;
  if (now < dueAt - lead) return -1;
  if (now < dueAt) return lead > 0 ? 0 : -1;
  const elapsed = now - dueAt;
  const every = Math.max(1, s.snoozeEveryMin) * MIN;
  const fastAfter = Math.max(0, s.snoozeFastAfterMin) * MIN;
  const fastEvery = Math.max(1, s.snoozeFastEveryMin) * MIN;
  if (elapsed < fastAfter) return 1 + Math.floor(elapsed / every);
  return 1 + Math.ceil(fastAfter / every) + Math.floor((elapsed - fastAfter) / fastEvery);
}

export interface ReminderMessage {
  title: string;
  body: string;
}

export function reminderMessage(task: Task, idx: number, dueAt: number, now: number): ReminderMessage {
  const p = task.priority === 1 ? '‼️ ' : '';
  if (idx === 0) {
    const mins = Math.max(1, Math.round((dueAt - now) / MIN));
    return { title: `${p}${task.title}`, body: `Up in ${mins} min${task.estimateMin ? ` · ~${task.estimateMin} min job` : ''}` };
  }
  if (idx === 1) return { title: `${p}${task.title}`, body: 'Due now. Tap to open, or reschedule it.' };
  const late = Math.round((now - dueAt) / MIN);
  return {
    title: `${p}${task.title}`,
    body: `${late} min overdue. I'll keep nudging until you finish, move or drop it.`,
  };
}

// ---------------------------------------------------------------- debriefs

export function dayLoad(tasks: Task[], date: string) {
  const open = tasks.filter((t) => t.date === date && t.status === 'open');
  return {
    count: open.length,
    minutes: open.reduce((a, t) => a + (t.estimateMin || 0), 0),
    p1: open.filter((t) => t.priority === 1),
  };
}

interface Candidate {
  date: string;
  reason: string;
  score: number;
}

/** Start date (YYYY-MM-DD) of the planner week containing `date`. */
export function weekStartOf(date: string, weekStartDay: number): string {
  const wd = weekdayOf(date);
  return addDays(date, -((wd - weekStartDay + 7) % 7));
}

function daysBetween(a: string, b: string) {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
}

/**
 * Work out debrief slots for the next `horizonDays`, based on the calendar:
 * one at the start of each week, plus the evening before heavy days or P1
 * deadlines. They're capped per week and kept at least 2 days apart. Pinned
 * (user-edited) debriefs are kept and count toward the cap.
 */
export function planDebriefs(
  tasks: Task[],
  existing: Debrief[],
  s: Settings,
  now: number,
  horizonDays = 21,
): Debrief[] {
  const today = zoned(now, s.timezone);
  const nowMin = today.minutes;
  const debriefMin = toMin(s.debriefTime);
  const firstDate = nowMin < debriefMin ? today.date : addDays(today.date, 1);

  const candidates: Candidate[] = [];
  for (let i = 0; i < horizonDays; i++) {
    const date = addDays(firstDate, i);
    const next = addDays(date, 1);
    const load = dayLoad(tasks, next);
    if (weekdayOf(date) === s.debriefWeekday) {
      candidates.push({ date, reason: 'Week ahead', score: 100 });
    }
    if (load.p1.length) {
      candidates.push({
        date,
        reason: `Priority tomorrow: ${load.p1[0].title}${load.p1.length > 1 ? ` +${load.p1.length - 1}` : ''}`,
        score: 50 + load.p1.length * 5 + load.minutes / 60,
      });
    } else if (load.minutes >= s.heavyDayMin) {
      candidates.push({
        date,
        reason: `Big day tomorrow: ${load.count} tasks, ~${Math.round(load.minutes / 60)}h`,
        score: 30 + load.minutes / 60,
      });
    }
  }

  const pinned = existing.filter((d) => d.pinned && d.status !== 'cancelled' && d.date >= firstDate);
  const chosen: { date: string; reason: string }[] = pinned.map((d) => ({ date: d.date, reason: d.reason }));
  const blocked = (date: string) => chosen.some((c) => Math.abs(daysBetween(c.date, date)) < 2);
  const cancelledDates = new Set(existing.filter((d) => d.pinned && d.status === 'cancelled').map((d) => d.date));
  const perWeek = new Map<string, number>();
  for (const c of chosen) {
    const w = weekStartOf(c.date, s.debriefWeekday);
    perWeek.set(w, (perWeek.get(w) ?? 0) + 1);
  }

  candidates.sort((a, b) => b.score - a.score || a.date.localeCompare(b.date));
  for (const c of candidates) {
    if (cancelledDates.has(c.date) || blocked(c.date)) continue;
    const w = weekStartOf(c.date, s.debriefWeekday);
    if ((perWeek.get(w) ?? 0) >= s.debriefsPerWeekMax) continue;
    perWeek.set(w, (perWeek.get(w) ?? 0) + 1);
    chosen.push(c);
  }

  const auto = existing.filter((d) => !d.pinned);
  const out: Debrief[] = existing.filter((d) => d.pinned || d.date < firstDate || d.status !== 'scheduled');
  for (const c of chosen.filter((c) => !pinned.some((p) => p.date === c.date))) {
    const prev = auto.find((d) => d.date === c.date && d.status === 'scheduled');
    out.push({
      id: prev?.id ?? uid(),
      date: c.date,
      time: s.debriefTime,
      reason: c.reason,
      status: 'scheduled',
      pinned: false,
      updatedAt: prev && prev.reason === c.reason ? prev.updatedAt : now,
    });
  }
  return out.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
}

// ---------------------------------------------------------------- check-ins

export function isNight(now: number, s: Settings): boolean {
  const m = zoned(now, s.timezone).minutes;
  const wd = toMin(s.windDown);
  const wake = toMin(s.wakeTime);
  return wd > wake ? m >= wd || m < wake : m >= wd && m < wake;
}

/** Epoch ms of the next wake time. */
export function nextWake(now: number, s: Settings): number {
  const z = zoned(now, s.timezone);
  const date = z.minutes < toMin(s.wakeTime) ? z.date : addDays(z.date, 1);
  return toEpoch(date, s.wakeTime, s.timezone);
}

export const CHECKIN_THRESHOLD = 35;

export function checkinScore(
  task: Task,
  now: number,
  s: Settings,
  lastActivityAt: number,
  lastCheckinForTask = 0,
): number {
  if (task.status !== 'open') return -Infinity;
  const today = zoned(now, s.timezone);
  if (task.date > today.date) return -Infinity;
  let score = { 1: 30, 2: 20, 3: 10 }[task.priority];
  const dueAt = dueAtOf(task, s.timezone);
  if (task.date < today.date) score += 20; // rolled over from a previous day
  if (dueAt != null) {
    const toDue = (dueAt - now) / MIN;
    if (Math.abs(toDue) < 15) return -Infinity; // the alarm is already handling it
    if (toDue < 0) score += 20 + Math.min(-toDue / 10, 20);
    else if (toDue <= 45 && !task.startedAt) score += 15;
    else if (toDue > 120) score -= 20; // not relevant yet
  } else if (today.minutes >= 14 * 60 && !task.startedAt) {
    score += 5;
  }
  const idleMin = Math.max(0, (now - lastActivityAt) / MIN);
  score += Math.min(idleMin / 15, 15);
  const done = task.subtasks.filter((x) => x.done).length;
  if (done > 0 && done < task.subtasks.length) score -= 5;
  if (now - lastCheckinForTask < 3 * 60 * MIN) score -= 30;
  return score;
}

export type CheckinDecision =
  | { action: 'none'; why: string }
  | { action: 'checkin'; taskId: string }
  | { action: 'consent'; taskId: string };

export function decideCheckin(
  state: CheckinState,
  lastByTask: Record<string, number>,
  tasks: Task[],
  now: number,
  s: Settings,
): CheckinDecision {
  const today = zoned(now, s.timezone).date;
  if (state.quietUntil > now) return { action: 'none', why: 'quiet' };
  if (state.pendingConsent) return { action: 'none', why: 'awaiting consent' };
  const count = state.checkinsToday.date === today ? state.checkinsToday.count : 0;
  if (count >= s.checkinsPerDayMax) return { action: 'none', why: 'daily cap' };
  if (now - state.lastCheckinAt < s.checkinMinGapMin * MIN) return { action: 'none', why: 'too soon' };
  if (now - state.lastActivityAt < 5 * MIN) return { action: 'none', why: 'active in app' };

  let best: { id: string; score: number } | null = null;
  for (const t of tasks) {
    const sc = checkinScore(t, now, s, state.lastActivityAt, lastByTask[t.id] ?? 0);
    if (sc >= CHECKIN_THRESHOLD && (!best || sc > best.score)) best = { id: t.id, score: sc };
  }
  if (!best) return { action: 'none', why: 'nothing needs a nudge' };
  return isNight(now, s) ? { action: 'consent', taskId: best.id } : { action: 'checkin', taskId: best.id };
}
