// Runs every 30s: fires alarm-style reminders, debrief prompts and check-ins.
import type { Core } from './core';
import { decideCheckin, dueAtOf, NAG_LIMIT_MS, nextWake, reminderIndexAt, reminderMessage } from './logic';
import { toEpoch, uid, zoned } from '../shared/time';

const MIN = 60_000;

export async function tick(core: Core) {
  const now = core.now();
  const s = core.settings();
  let state = core.checkin();
  const quiet = state.quietUntil > now;

  // 1. Reminders
  for (const t of core.db.tasks()) {
    if (t.status !== 'open') continue;
    const dueAt = dueAtOf(t, s.timezone);
    if (dueAt == null || now - dueAt > NAG_LIMIT_MS) continue;
    const idx = reminderIndexAt(dueAt, now, s);
    if (idx < 0) continue;
    const prev = core.db.reminderState(t.id);
    const lastIdx = prev && prev.due_at === dueAt ? prev.last_idx : -1;
    if (idx <= lastIdx) continue;
    if (quiet && idx >= 2) continue; // no snooze nagging while you sleep
    const msg = reminderMessage(t, idx, dueAt, now);
    core.db.setReminderState(t.id, dueAt, idx);
    await core.push({ ...msg, url: `/?task=${t.id}`, tag: `task-${t.id}`, requireInteraction: idx >= 1 });
  }

  // 2. Unanswered "u up?" → quiet until morning
  if (state.pendingConsent && now > state.pendingConsent.expiresAt) {
    state = { ...state, pendingConsent: null, quietUntil: nextWake(now, s) };
    core.setCheckin(state);
    core.log('consent timed out → quiet till morning');
  }

  // 3. Debriefs
  const notified = core.db.kv<string[]>('debriefNotified', []);
  let changed = false;
  const debriefs = core.db.debriefs().map((d) => {
    if (d.status !== 'scheduled') return d;
    const at = toEpoch(d.date, d.time, s.timezone);
    if (now - at > 3 * 60 * MIN) {
      changed = true;
      return { ...d, status: 'missed' as const, updatedAt: now };
    }
    return d;
  });
  for (const d of debriefs) {
    if (d.status !== 'scheduled' || notified.includes(d.id)) continue;
    const at = toEpoch(d.date, d.time, s.timezone);
    if (now >= at && !quiet) {
      notified.push(d.id);
      await core.push({
        title: 'Debrief time 🗓️',
        body: `${d.reason}. Tap for a 2-minute run-through, sir.`,
        url: `/call?mode=debrief&debrief=${d.id}`,
        tag: 'debrief',
        requireInteraction: true,
      });
    }
  }
  core.db.setKv('debriefNotified', notified.slice(-100));
  if (changed) {
    core.db.setDebriefs(debriefs);
    core.emit({ type: 'debriefs', debriefs });
  }

  // 4. Check-ins
  const today = zoned(now, s.timezone).date;
  const decision = decideCheckin(state, core.db.lastByTask(), core.db.tasks(), now, s);
  if (decision.action === 'none') return;
  const task = core.db.task(decision.taskId);
  if (!task) return;
  const count = state.checkinsToday.date === today ? state.checkinsToday.count : 0;
  const byTask = core.db.lastByTask();
  byTask[task.id] = now;
  core.db.setLastByTask(byTask);
  if (decision.action === 'consent') {
    const id = uid();
    core.setCheckin({
      ...state,
      lastCheckinAt: now,
      checkinsToday: { date: today, count: count + 1 },
      pendingConsent: { id, taskId: task.id, expiresAt: now + s.consentTimeoutMin * MIN },
    });
    await core.push({
      title: 'Still up, sir? 🌙',
      body: `Have you a moment for a brief check-in? If not, I'll leave you be until ${s.wakeTime}.`,
      url: `/checkin?consent=${id}`,
      tag: 'checkin',
      requireInteraction: true,
    });
  } else {
    core.setCheckin({ ...state, lastCheckinAt: now, checkinsToday: { date: today, count: count + 1 } });
    await core.push({
      title: `Quick check-in, sir`,
      body: `How's “${task.title}” going? Tap to talk it through and I'll update the plan.`,
      url: `/call?mode=checkin&task=${task.id}`,
      tag: 'checkin',
      requireInteraction: true,
    });
  }
}

export function startScheduler(core: Core) {
  core.replanDebriefs();
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      await tick(core);
    } catch (e) {
      core.log(`scheduler error: ${(e as Error).stack}`);
    } finally {
      running = false;
    }
  };
  run();
  const h = setInterval(run, 30_000);
  const replan = setInterval(() => core.replanDebriefs(), 30 * MIN);
  return () => {
    clearInterval(h);
    clearInterval(replan);
  };
}
