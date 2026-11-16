import { describe, expect, it, beforeEach } from 'vitest';
import { openDb } from './db';
import { Core } from './core';
import { createApp } from './app';
import { execTool, fallbackTurn, findTask, resolveDate, resolveTime, runTurn, type Provider } from './assistant';
import { tick } from './scheduler';
import { toEpoch } from '../shared/time';
import type { CallLog, Task } from '../shared/types';

const TZ = 'Europe/London';
let now = toEpoch('2026-11-16', '12:00', TZ);
let core: Core;

function task(p: Partial<Task>): Task {
  return {
    id: p.id ?? Math.random().toString(36).slice(2),
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
    updatedAt: 1,
    ...p,
  };
}

beforeEach(() => {
  now = toEpoch('2026-11-16', '12:00', TZ);
  core = new Core(openDb(':memory:'), () => now);
  core.log = () => {};
  core.setSettings({ ...core.settings(), timezone: TZ });
});

describe('date/time parsing for the assistant', () => {
  it('resolves relative dates', () => {
    expect(resolveDate('tomorrow', '2026-11-16')).toBe('2026-11-17');
    expect(resolveDate('friday', '2026-11-16')).toBe('2026-11-20');
    expect(resolveDate('monday', '2026-11-16')).toBe('2026-11-23');
    expect(resolveDate('2026-12-01', '2026-11-16')).toBe('2026-12-01');
  });
  it('resolves times', () => {
    expect(resolveTime('3pm')).toBe('15:00');
    expect(resolveTime('9:30')).toBe('09:30');
    expect(resolveTime('none')).toBeNull();
    expect(resolveTime('')).toBeUndefined();
  });
  it('finds tasks by id or fuzzy title', () => {
    const list = [task({ id: 'a', title: 'Gym push day' }), task({ id: 'b', title: 'Reply to emails' })];
    expect(findTask(list, 'a')?.id).toBe('a');
    expect(findTask(list, 'the emails')?.id).toBe('b');
    expect(findTask(list, 'nothing')).toBeNull();
  });
});

describe('assistant tools edit the plan', () => {
  it('create, reschedule, complete, subtasks, notes, sleep', () => {
    const c = execTool(core, 'create_task', { title: 'Call mum', date: 'tomorrow', dueTime: '6pm', priority: 1, steps: ['dial'] });
    const id = c.change!.taskId!;
    expect(core.db.task(id)).toMatchObject({ date: '2026-11-17', dueTime: '18:00', priority: 1 });
    execTool(core, 'reschedule_task', { task: 'call mum', date: 'friday' });
    expect(core.db.task(id)!.date).toBe('2026-11-20');
    execTool(core, 'complete_subtask', { task: id, step: 'dial' });
    expect(core.db.task(id)!.subtasks[0].done).toBe(true);
    execTool(core, 'add_note', { task: id, note: 'ask about xmas' });
    expect(core.db.task(id)!.notes).toContain('xmas');
    execTool(core, 'complete_task', { task: id });
    expect(core.db.task(id)!.status).toBe('done');
    execTool(core, 'going_to_sleep', {});
    expect(core.checkin().quietUntil).toBe(toEpoch('2026-11-17', '08:00', TZ));
  });
  it('throws a helpful error for unknown tasks', () => {
    expect(() => execTool(core, 'complete_task', { task: 'zzz' })).toThrow(/list_tasks/);
  });
  it('runs a tool loop with a model provider', async () => {
    core.saveTask(task({ id: 'g', title: 'Gym' }));
    let n = 0;
    const fake: Provider = {
      name: 'fake',
      async chat() {
        n++;
        return n === 1
          ? { content: '', toolCalls: [{ name: 'reschedule_task', args: { task: 'g', date: 'tomorrow' } }] }
          : { content: 'Moved gym to tomorrow.', toolCalls: [] };
      },
    };
    const call: CallLog = { id: 'c', kind: 'checkin', taskId: 'g', startedAt: now, endedAt: null, transcript: [], changes: [] };
    const r = await runTurn(core, call, "can't make the gym today", fake);
    expect(r.reply).toBe('Moved gym to tomorrow.');
    expect(r.changes).toHaveLength(1);
    expect(core.db.task('g')!.date).toBe('2026-11-17');
  });
  it('fallback understands simple phrases', () => {
    core.saveTask(task({ id: 'e', title: 'Reply to emails' }));
    const call: CallLog = { id: 'c', kind: 'checkin', taskId: 'e', startedAt: now, endedAt: null, transcript: [], changes: [] };
    fallbackTurn(core, call, 'move it to tomorrow');
    expect(core.db.task('e')!.date).toBe('2026-11-17');
    fallbackTurn(core, call, 'done with emails');
    expect(core.db.task('e')!.status).toBe('done');
    fallbackTurn(core, call, 'add buy milk tomorrow at 9am');
    expect(core.db.tasks().find((t) => t.title === 'Buy milk')).toMatchObject({ date: '2026-11-17', dueTime: '09:00' });
  });
});

describe('scheduler', () => {
  it('fires heads-up, due and snooze reminders once each, then stops when done', async () => {
    core.saveTask(task({ id: 'r', title: 'Dentist', dueTime: '13:00' }));
    core.setCheckin({ ...core.checkin(), lastActivityAt: now }); // keep check-ins out of this test
    const titles = () => core.sent.map((s) => s.body);
    now = toEpoch('2026-11-16', '12:50', TZ);
    await tick(core);
    await tick(core);
    expect(titles()).toEqual([expect.stringMatching(/Up in 10 min/)]);
    now = toEpoch('2026-11-16', '13:00', TZ);
    core.setCheckin({ ...core.checkin(), lastActivityAt: now });
    await tick(core);
    expect(titles().at(-1)).toMatch(/Due now/);
    now = toEpoch('2026-11-16', '13:10', TZ);
    core.setCheckin({ ...core.checkin(), lastActivityAt: now });
    await tick(core);
    expect(titles().at(-1)).toMatch(/10 min overdue/);
    core.touch(core.db.task('r')!, { status: 'done' });
    now = toEpoch('2026-11-16', '13:30', TZ);
    const before = core.sent.length;
    await tick(core);
    expect(core.sent.length).toBe(before);
  });
  it('rescheduling resets the alarm sequence', async () => {
    core.saveTask(task({ id: 'r', title: 'Dentist', dueTime: '13:00' }));
    now = toEpoch('2026-11-16', '13:00', TZ);
    core.setCheckin({ ...core.checkin(), lastActivityAt: now });
    await tick(core);
    core.touch(core.db.task('r')!, { dueTime: '15:00' });
    now = toEpoch('2026-11-16', '14:50', TZ);
    core.setCheckin({ ...core.checkin(), lastActivityAt: now });
    await tick(core);
    expect(core.sent.at(-1)!.body).toMatch(/Up in 10 min/);
  });
  it('night check-in asks consent; ignoring it means quiet till morning', async () => {
    core.saveTask(task({ id: 'x', title: 'Essay', dueTime: '21:00', priority: 1 }));
    now = toEpoch('2026-11-16', '22:30', TZ);
    core.setCheckin({ ...core.checkin(), lastActivityAt: now - 2 * 3600_000, lastCheckinAt: 0 });
    core.db.setReminderState('x', toEpoch('2026-11-16', '21:00', TZ), 999);
    await tick(core);
    expect(core.sent.at(-1)!.title).toMatch(/u up for a quick check-up/);
    expect(core.checkin().pendingConsent).toBeTruthy();
    now += 11 * 60_000;
    await tick(core);
    expect(core.checkin().pendingConsent).toBeNull();
    expect(core.checkin().quietUntil).toBe(toEpoch('2026-11-17', '08:00', TZ));
    const n = core.sent.length;
    now += 60 * 60_000;
    await tick(core);
    expect(core.sent.length).toBe(n);
  });
});

describe('http api', () => {
  it('setup → login → tasks → call turn', async () => {
    const app = createApp(core, { provider: null });
    let res = await app.request('/api/bootstrap');
    expect(res.status).toBe(401);
    res = await app.request('/api/auth/setup', {
      method: 'POST',
      body: JSON.stringify({ username: 'me', password: 'secret123', seed: true }),
      headers: { 'content-type': 'application/json' },
    });
    expect(res.status).toBe(200);
    const cookie = res.headers.get('set-cookie')!.split(';')[0];
    const h = { cookie, 'content-type': 'application/json' };
    res = await app.request('/api/bootstrap', { headers: h });
    const boot = await res.json();
    expect(boot.tasks.length).toBeGreaterThan(3);
    const bad = await app.request('/api/auth/login', { method: 'POST', headers: h, body: JSON.stringify({ username: 'me', password: 'nope' }) });
    expect(bad.status).toBe(401);
    const t = task({ id: 'new1', title: 'Write report' });
    res = await app.request('/api/tasks/new1', { method: 'PUT', headers: h, body: JSON.stringify(t) });
    expect((await res.json()).title).toBe('Write report');
    res = await app.request('/api/call/start', { method: 'POST', headers: h, body: JSON.stringify({ kind: 'checkin', taskId: 'new1' }) });
    const { call, greeting } = await res.json();
    expect(greeting).toMatch(/Write report/);
    res = await app.request(`/api/call/${call.id}/turn`, { method: 'POST', headers: h, body: JSON.stringify({ text: 'finished it' }) });
    const turn = await res.json();
    expect(turn.changes[0].tool).toBe('complete_task');
    expect(core.db.task('new1')!.status).toBe('done');
  });
});
