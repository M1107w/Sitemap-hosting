import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type CheckinState, type Task } from '../shared/types';
import { toEpoch, zoned } from '../shared/time';
import {
  checkinScore,
  decideCheckin,
  isNight,
  nextWake,
  planDebriefs,
  reminderIndexAt,
  weekStartOf,
} from './logic';

const s = { ...DEFAULT_SETTINGS, timezone: 'Europe/London' };
const MIN = 60_000;
const at = (date: string, time: string) => toEpoch(date, time, s.timezone);

function task(p: Partial<Task>): Task {
  return {
    id: p.id ?? 't' + Math.random(),
    title: 'Task',
    notes: '',
    priority: 2,
    date: '2026-11-16',
    dueTime: null,
    estimateMin: 30,
    status: 'open',
    subtasks: [],
    startedAt: null,
    completedAt: null,
    createdAt: 0,
    updatedAt: 0,
    ...p,
  };
}

describe('time helpers', () => {
  it('round-trips local time across DST', () => {
    const e = at('2026-07-01', '09:15');
    expect(zoned(e, s.timezone).time).toBe('09:15');
    const w = at('2026-12-01', '23:59');
    expect(zoned(w, s.timezone)).toMatchObject({ date: '2026-12-01', time: '23:59' });
  });
});

describe('alarm-style reminders', () => {
  const due = at('2026-11-16', '14:00');
  it('heads-up, due, then snooze cadence', () => {
    expect(reminderIndexAt(due, due - 11 * MIN, s)).toBe(-1);
    expect(reminderIndexAt(due, due - 10 * MIN, s)).toBe(0);
    expect(reminderIndexAt(due, due, s)).toBe(1);
    expect(reminderIndexAt(due, due + 9 * MIN, s)).toBe(1);
    expect(reminderIndexAt(due, due + 10 * MIN, s)).toBe(2);
    expect(reminderIndexAt(due, due + 20 * MIN, s)).toBe(3);
    expect(reminderIndexAt(due, due + 30 * MIN, s)).toBe(4);
    expect(reminderIndexAt(due, due + 35 * MIN, s)).toBe(5); // fast snooze every 5
    expect(reminderIndexAt(due, due + 40 * MIN, s)).toBe(6);
  });
  it('is monotonic', () => {
    let prev = -2;
    for (let m = -20; m < 200; m++) {
      const i = reminderIndexAt(due, due + m * MIN, s);
      expect(i).toBeGreaterThanOrEqual(prev);
      prev = i;
    }
  });
  it('lead of 0 skips the heads-up', () => {
    expect(reminderIndexAt(due, due - MIN, { ...s, reminderLeadMin: 0 })).toBe(-1);
  });
});

describe('debrief planner', () => {
  // 2026-11-16 is a Monday
  const now = at('2026-11-16', '09:00');
  it('one weekly debrief on Sunday when the calendar is quiet', () => {
    const plan = planDebriefs([], [], s, now, 14);
    expect(plan.map((d) => d.date)).toEqual(['2026-11-22', '2026-11-29']);
    expect(plan[0].reason).toBe('Week ahead');
  });
  it('adds evening-before debriefs for P1/heavy days, respecting gap + cap', () => {
    const tasks = [
      task({ date: '2026-11-18', priority: 1, title: 'Pitch' }),
      task({ date: '2026-11-19', estimateMin: 400 }),
      task({ date: '2026-11-20', priority: 1, title: 'Exam' }),
    ];
    const plan = planDebriefs(tasks, [], s, now, 7);
    const dates = plan.map((d) => d.date);
    expect(dates).toContain('2026-11-22');
    expect(dates).toContain('2026-11-17'); // before Pitch
    expect(dates).toContain('2026-11-19'); // before Exam
    for (let i = 1; i < dates.length; i++) {
      expect(Date.parse(dates[i]) - Date.parse(dates[i - 1])).toBeGreaterThanOrEqual(2 * 86_400_000);
    }
  });
  it('caps per week', () => {
    const tasks = ['17', '18', '19', '20', '21'].map((d) => task({ date: `2026-11-${d}`, priority: 1 }));
    const plan = planDebriefs(tasks, [], { ...s, debriefsPerWeekMax: 2 }, now, 6);
    expect(plan.length).toBeLessThanOrEqual(2);
  });
  it('keeps pinned debriefs and never recreates cancelled ones', () => {
    const existing = [
      { id: 'a', date: '2026-11-22', time: '19:00', reason: 'Week ahead', status: 'cancelled' as const, pinned: true, updatedAt: 0 },
      { id: 'b', date: '2026-11-25', time: '18:00', reason: 'Mine', status: 'scheduled' as const, pinned: true, updatedAt: 0 },
    ];
    const plan = planDebriefs([], existing, s, now, 10);
    expect(plan.find((d) => d.date === '2026-11-22' && d.status === 'scheduled')).toBeUndefined();
    expect(plan.find((d) => d.id === 'b')).toBeTruthy();
  });
  it('weekStartOf', () => {
    expect(weekStartOf('2026-11-19', 0)).toBe('2026-11-15');
  });
});

describe('check-ins', () => {
  const base: CheckinState = {
    quietUntil: 0,
    pendingConsent: null,
    lastCheckinAt: 0,
    checkinsToday: { date: '2026-11-16', count: 0 },
    lastActivityAt: 0,
  };
  it('night window wraps midnight', () => {
    expect(isNight(at('2026-11-16', '22:00'), s)).toBe(true);
    expect(isNight(at('2026-11-16', '03:00'), s)).toBe(true);
    expect(isNight(at('2026-11-16', '12:00'), s)).toBe(false);
  });
  it('next wake is tomorrow morning when it is late', () => {
    expect(nextWake(at('2026-11-16', '23:00'), s)).toBe(at('2026-11-17', '08:00'));
    expect(nextWake(at('2026-11-17', '02:00'), s)).toBe(at('2026-11-17', '08:00'));
  });
  it('overdue P1 with idle app triggers a check-in during the day', () => {
    const now = at('2026-11-16', '15:00');
    const t = task({ id: 'x', priority: 1, dueTime: '14:00' });
    const d = decideCheckin({ ...base, lastActivityAt: now - 60 * MIN }, {}, [t], now, s);
    expect(d).toEqual({ action: 'checkin', taskId: 'x' });
  });
  it('asks consent at night instead of calling', () => {
    const now = at('2026-11-16', '22:30');
    const t = task({ id: 'x', priority: 2, dueTime: '21:00' });
    const d = decideCheckin({ ...base, lastActivityAt: now - 90 * MIN }, {}, [t], now, s);
    expect(d).toEqual({ action: 'consent', taskId: 'x' });
  });
  it('respects quiet mode, caps, gaps and recent activity', () => {
    const now = at('2026-11-16', '15:00');
    const t = [task({ priority: 1, dueTime: '14:00' })];
    const idle = now - 60 * MIN;
    expect(decideCheckin({ ...base, lastActivityAt: idle, quietUntil: now + 1 }, {}, t, now, s).action).toBe('none');
    expect(decideCheckin({ ...base, lastActivityAt: idle, checkinsToday: { date: '2026-11-16', count: 9 } }, {}, t, now, s).action).toBe('none');
    expect(decideCheckin({ ...base, lastActivityAt: idle, lastCheckinAt: now - 10 * MIN }, {}, t, now, s).action).toBe('none');
    expect(decideCheckin({ ...base, lastActivityAt: now - MIN }, {}, t, now, s).action).toBe('none');
  });
  it('low-priority tasks need more to trigger than high', () => {
    const now = at('2026-11-16', '15:00');
    const idle = now - 30 * MIN;
    const p1 = checkinScore(task({ priority: 1, dueTime: '15:20' }), now, s, idle);
    const p3 = checkinScore(task({ priority: 3, dueTime: '15:20' }), now, s, idle);
    expect(p1).toBeGreaterThan(p3);
    expect(p3).toBeLessThan(35);
  });
  it('does not nag about the same task within 3h', () => {
    const now = at('2026-11-16', '15:00');
    const t = task({ id: 'x', priority: 1, dueTime: '14:00' });
    const d = decideCheckin({ ...base, lastActivityAt: now - 60 * MIN }, { x: now - 60 * MIN }, [t], now, s);
    expect(d.action).toBe('none');
  });
});
