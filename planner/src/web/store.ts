// Local-first store: renders from memory, persists to IndexedDB, syncs to the
// server through an outbox, and listens for live changes (e.g. from a voice call).
import Dexie, { type Table } from 'dexie';
import { useSyncExternalStore } from 'react';
import { DEFAULT_SETTINGS, type CallLog, type CheckinState, type Debrief, type ServerEvent, type Settings, type Task } from '../shared/types';
import { uid } from '../shared/time';

class LocalDB extends Dexie {
  tasks!: Table<Task, string>;
  outbox!: Table<Task, string>;
  meta!: Table<{ k: string; v: unknown }, string>;
  constructor() {
    super('today-planner');
    this.version(1).stores({ tasks: 'id, date', outbox: 'id', meta: 'k' });
  }
}
const ldb = new LocalDB();

export type AuthState = 'unknown' | 'setup' | 'login' | 'ok';

export interface State {
  auth: AuthState;
  tasks: Record<string, Task>;
  debriefs: Debrief[];
  settings: Settings;
  checkin: CheckinState | null;
  calls: CallLog[];
  vapidPublicKey: string;
  online: boolean;
  pending: number;
  toast: { id: string; text: string; undo?: () => void } | null;
  health: { ollama: boolean; whisper: boolean; tts: boolean; model: string } | null;
  /** the add/edit task sheet, opened from anywhere (e.g. the + menu) */
  editor: { task: Task | null; date: string } | null;
}

let state: State = {
  auth: 'unknown',
  tasks: {},
  debriefs: [],
  settings: { ...DEFAULT_SETTINGS, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone },
  checkin: null,
  calls: [],
  vapidPublicKey: '',
  online: true,
  pending: 0,
  toast: null,
  health: null,
  editor: null,
};
const subs = new Set<() => void>();
function set(patch: Partial<State>) {
  state = { ...state, ...patch };
  subs.forEach((f) => f());
}
export function getState() {
  return state;
}
export function useStore<T>(sel: (s: State) => T): T {
  return useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    () => sel(state),
  );
}

// ------------------------------------------------------------ http
export async function api<T = unknown>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const res = await fetch(path, {
    credentials: 'same-origin',
    ...init,
    headers: { ...(init?.json !== undefined ? { 'content-type': 'application/json' } : {}), ...init?.headers },
    body: init?.json !== undefined ? JSON.stringify(init.json) : init?.body,
  });
  if (res.status === 401 && !path.startsWith('/api/auth')) {
    set({ auth: 'login' });
    throw new Error('auth');
  }
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : await res.blob();
  if (!res.ok) throw new Error((data as { error?: string })?.error || res.statusText);
  return data as T;
}

// ------------------------------------------------------------ boot
export async function boot() {
  // Paint from cache instantly
  const cached = await ldb.tasks.toArray().catch(() => []);
  if (cached.length) set({ tasks: Object.fromEntries(cached.map((t) => [t.id, t])) });
  const metaSettings = (await ldb.meta.get('settings').catch(() => undefined))?.v as Settings | undefined;
  if (metaSettings) set({ settings: metaSettings });

  try {
    const a = await api<{ hasUser: boolean; loggedIn: boolean }>('/api/auth/state');
    if (!a.loggedIn) {
      set({ auth: a.hasUser ? 'login' : 'setup' });
      return;
    }
  } catch {
    // offline: trust the cache if we have one
    if (cached.length) {
      set({ auth: 'ok', online: false });
      return;
    }
  }
  await loadAll();
}

export async function loadAll() {
  const b = await api<{
    tasks: Task[];
    debriefs: Debrief[];
    settings: Settings;
    checkin: CheckinState;
    calls: CallLog[];
    vapidPublicKey: string;
  }>('/api/bootstrap');
  await flush();
  const outbox = await ldb.outbox.toArray();
  const merged: Record<string, Task> = Object.fromEntries(b.tasks.map((t) => [t.id, t]));
  for (const t of outbox) if (!merged[t.id] || merged[t.id].updatedAt < t.updatedAt) merged[t.id] = t;
  set({
    auth: 'ok',
    tasks: merged,
    debriefs: b.debriefs,
    settings: b.settings,
    checkin: b.checkin,
    calls: b.calls,
    vapidPublicKey: b.vapidPublicKey,
    online: true,
  });
  await ldb.transaction('rw', ldb.tasks, ldb.meta, async () => {
    await ldb.tasks.clear();
    await ldb.tasks.bulkPut(Object.values(merged));
    await ldb.meta.put({ k: 'settings', v: b.settings });
  });
  // Tell the server our timezone if it differs
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (tz && b.settings.timezone !== tz) saveSettings({ timezone: tz });
  connectEvents();
  api<State['health']>('/api/health').then((h) => set({ health: h }), () => {});
}

// ------------------------------------------------------------ live events
let es: EventSource | null = null;
function connectEvents() {
  es?.close();
  es = new EventSource('/api/events');
  es.addEventListener('change', (m) => applyEvent(JSON.parse((m as MessageEvent).data)));
  es.addEventListener('hello', () => set({ online: true }));
  es.onerror = () => set({ online: navigator.onLine && es?.readyState !== EventSource.CLOSED });
}

function applyEvent(e: ServerEvent) {
  switch (e.type) {
    case 'task': {
      const cur = state.tasks[e.task.id];
      if (cur && cur.updatedAt > e.task.updatedAt) return;
      set({ tasks: { ...state.tasks, [e.task.id]: e.task } });
      ldb.tasks.put(e.task).catch(() => {});
      break;
    }
    case 'debriefs':
      set({ debriefs: e.debriefs });
      break;
    case 'settings':
      set({ settings: e.settings });
      break;
    case 'checkin':
      set({ checkin: e.state });
      break;
    case 'call': {
      const rest = state.calls.filter((c) => c.id !== e.call.id);
      set({ calls: [e.call, ...rest].slice(0, 30) });
      break;
    }
  }
}

// ------------------------------------------------------------ mutations
let flushing = false;
export async function flush() {
  if (flushing) return;
  flushing = true;
  try {
    const items = await ldb.outbox.toArray();
    set({ pending: items.length });
    if (!items.length) return;
    await api('/api/tasks/batch', { method: 'POST', json: items });
    await ldb.transaction('rw', ldb.outbox, async () => {
      for (const t of items) {
        const cur = await ldb.outbox.get(t.id);
        if (cur && cur.updatedAt === t.updatedAt) await ldb.outbox.delete(t.id);
      }
    });
    set({ pending: await ldb.outbox.count(), online: true });
  } catch (e) {
    if ((e as Error).message !== 'auth') set({ online: false });
  } finally {
    flushing = false;
  }
}
setInterval(flush, 15_000);
window.addEventListener('online', flush);

export function putTask(t: Task) {
  const next = { ...t, updatedAt: Math.max(Date.now(), (state.tasks[t.id]?.updatedAt ?? 0) + 1) };
  set({ tasks: { ...state.tasks, [t.id]: next } });
  ldb.tasks.put(next).catch(() => {});
  ldb.outbox.put(next).then(flush, () => {});
  return next;
}

export function patchTask(id: string, patch: Partial<Task>) {
  const t = state.tasks[id];
  if (t) return putTask({ ...t, ...patch });
}

export function newTask(p: Partial<Task> & { title: string; date: string }): Task {
  const now = Date.now();
  return putTask({
    id: uid(),
    notes: '',
    priority: 2,
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
}

export function toast(text: string, undo?: () => void) {
  const id = uid();
  set({ toast: { id, text, undo } });
  setTimeout(() => state.toast?.id === id && set({ toast: null }), 4000);
}
export function dismissToast() {
  set({ toast: null });
}

export function completeTask(id: string) {
  const prev = state.tasks[id];
  if (!prev) return;
  patchTask(id, { status: 'done', completedAt: Date.now() });
  navigator.vibrate?.(10);
  toast(`Done: ${prev.title}`, () => patchTask(id, { status: 'open', completedAt: null }));
}
export function discardTask(id: string) {
  const prev = state.tasks[id];
  if (!prev) return;
  patchTask(id, { status: 'discarded' });
  toast(`Discarded: ${prev.title}`, () => patchTask(id, { status: 'open' }));
}
export function rescheduleTask(id: string, date: string, dueTime: string | null | undefined, label: string) {
  const prev = state.tasks[id];
  if (!prev) return;
  patchTask(id, { date, ...(dueTime !== undefined ? { dueTime } : {}) });
  toast(`Moved to ${label}`, () => patchTask(id, { date: prev.date, dueTime: prev.dueTime }));
}

export async function saveSettings(patch: Partial<Settings>) {
  const s = { ...state.settings, ...patch };
  set({ settings: s });
  ldb.meta.put({ k: 'settings', v: s }).catch(() => {});
  try {
    set({ settings: await api<Settings>('/api/settings', { method: 'PUT', json: patch }) });
  } catch {
    /* offline: will resend next time */
  }
}

export async function updateDebrief(id: string, patch: Partial<Debrief>) {
  await api(`/api/debriefs/${id}`, { method: 'PUT', json: patch });
}

export async function setSleep(on: boolean) {
  set({ checkin: await api<CheckinState>('/api/sleep', { method: 'POST', json: { on } }) });
}

// Light activity heartbeat so check-ins know when you're active in the app
let lastPing = 0;
export function activity() {
  if (state.auth !== 'ok' || Date.now() - lastPing < 120_000) return;
  lastPing = Date.now();
  api('/api/activity', { method: 'POST', json: {} }).catch(() => {});
}

export async function logout() {
  await api('/api/auth/logout', { method: 'POST', json: {} }).catch(() => {});
  await ldb.delete().catch(() => {});
  location.href = '/';
}

export function setAuth(auth: AuthState) {
  set({ auth });
}

export function openEditor(date: string, task: Task | null = null) {
  set({ editor: { task, date } });
}
export function closeEditor() {
  set({ editor: null });
}

/** Push every unfinished task from earlier days (and today's missed timed ones) to tomorrow. */
export function moveOverdueToTomorrow(todayDate: string, tomorrow: string, nowMinutes: number) {
  const moved: Task[] = [];
  for (const t of Object.values(state.tasks)) {
    if (t.status !== 'open') continue;
    const missedToday = t.date === todayDate && t.dueTime && Number(t.dueTime.slice(0, 2)) * 60 + Number(t.dueTime.slice(3)) < nowMinutes;
    if (t.date < todayDate || missedToday) {
      moved.push(t);
      patchTask(t.id, { date: tomorrow });
    }
  }
  if (!moved.length) return toast('Nothing overdue, sir.');
  toast(`Moved ${moved.length} to tomorrow`, () => moved.forEach((t) => patchTask(t.id, { date: t.date })));
}
