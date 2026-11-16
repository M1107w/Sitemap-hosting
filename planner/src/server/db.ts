import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_SETTINGS,
  type CallLog,
  type CheckinState,
  type Debrief,
  type Settings,
  type Task,
} from '../shared/types';

export type DB = ReturnType<typeof openDb>;

export function openDb(file: string) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, date TEXT, status TEXT, updated_at INTEGER, data TEXT);
    CREATE INDEX IF NOT EXISTS tasks_date ON tasks(date);
    CREATE TABLE IF NOT EXISTS debriefs (id TEXT PRIMARY KEY, date TEXT, data TEXT);
    CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT);
    CREATE TABLE IF NOT EXISTS push_subs (endpoint TEXT PRIMARY KEY, data TEXT, created_at INTEGER);
    CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, username TEXT UNIQUE, hash TEXT);
    CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id INTEGER, created_at INTEGER);
    CREATE TABLE IF NOT EXISTS calls (id TEXT PRIMARY KEY, started_at INTEGER, data TEXT);
    CREATE TABLE IF NOT EXISTS reminder_state (task_id TEXT PRIMARY KEY, due_at INTEGER, last_idx INTEGER);
  `);

  const q = {
    allTasks: db.prepare('SELECT data FROM tasks'),
    getTask: db.prepare('SELECT data FROM tasks WHERE id = ?'),
    upsertTask: db.prepare(
      'INSERT INTO tasks (id, date, status, updated_at, data) VALUES (@id, @date, @status, @updatedAt, @data) ON CONFLICT(id) DO UPDATE SET date=excluded.date, status=excluded.status, updated_at=excluded.updated_at, data=excluded.data',
    ),
    allDebriefs: db.prepare('SELECT data FROM debriefs ORDER BY date'),
    clearDebriefs: db.prepare('DELETE FROM debriefs'),
    insertDebrief: db.prepare('INSERT OR REPLACE INTO debriefs (id, date, data) VALUES (?, ?, ?)'),
    kvGet: db.prepare('SELECT v FROM kv WHERE k = ?'),
    kvSet: db.prepare('INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v'),
  };

  function kv<T>(k: string, fallback: T): T {
    const row = q.kvGet.get(k) as { v: string } | undefined;
    return row ? (JSON.parse(row.v) as T) : fallback;
  }
  function setKv(k: string, v: unknown) {
    q.kvSet.run(k, JSON.stringify(v));
  }

  return {
    raw: db,
    tasks(): Task[] {
      return (q.allTasks.all() as { data: string }[]).map((r) => JSON.parse(r.data));
    },
    task(id: string): Task | null {
      const r = q.getTask.get(id) as { data: string } | undefined;
      return r ? JSON.parse(r.data) : null;
    },
    /** Last-write-wins upsert. Returns the stored task (may be the newer server copy). */
    putTask(t: Task): Task {
      const cur = this.task(t.id);
      if (cur && cur.updatedAt > t.updatedAt) return cur;
      q.upsertTask.run({ id: t.id, date: t.date, status: t.status, updatedAt: t.updatedAt, data: JSON.stringify(t) });
      return t;
    },
    debriefs(): Debrief[] {
      return (q.allDebriefs.all() as { data: string }[]).map((r) => JSON.parse(r.data));
    },
    setDebriefs: db.transaction((list: Debrief[]) => {
      q.clearDebriefs.run();
      for (const d of list) q.insertDebrief.run(d.id, d.date, JSON.stringify(d));
    }),
    settings(): Settings {
      return { ...DEFAULT_SETTINGS, ...kv<Partial<Settings>>('settings', {}) };
    },
    setSettings(s: Settings) {
      setKv('settings', s);
    },
    checkin(): CheckinState {
      return kv<CheckinState>('checkin', {
        quietUntil: 0,
        pendingConsent: null,
        lastCheckinAt: 0,
        checkinsToday: { date: '', count: 0 },
        lastActivityAt: Date.now(),
      });
    },
    setCheckin(s: CheckinState) {
      setKv('checkin', s);
    },
    lastByTask(): Record<string, number> {
      return kv('checkinByTask', {});
    },
    setLastByTask(m: Record<string, number>) {
      setKv('checkinByTask', m);
    },
    kv,
    setKv,
    pushSubs(): { endpoint: string; keys: { p256dh: string; auth: string } }[] {
      return (db.prepare('SELECT data FROM push_subs').all() as { data: string }[]).map((r) => JSON.parse(r.data));
    },
    addPushSub(sub: { endpoint: string }) {
      db.prepare('INSERT OR REPLACE INTO push_subs (endpoint, data, created_at) VALUES (?, ?, ?)').run(
        sub.endpoint,
        JSON.stringify(sub),
        Date.now(),
      );
    },
    removePushSub(endpoint: string) {
      db.prepare('DELETE FROM push_subs WHERE endpoint = ?').run(endpoint);
    },
    reminderState(taskId: string): { due_at: number; last_idx: number } | undefined {
      return db.prepare('SELECT due_at, last_idx FROM reminder_state WHERE task_id = ?').get(taskId) as never;
    },
    setReminderState(taskId: string, dueAt: number, idx: number) {
      db.prepare('INSERT OR REPLACE INTO reminder_state (task_id, due_at, last_idx) VALUES (?, ?, ?)').run(taskId, dueAt, idx);
    },
    calls(limit = 30): CallLog[] {
      return (db.prepare('SELECT data FROM calls ORDER BY started_at DESC LIMIT ?').all(limit) as { data: string }[]).map((r) =>
        JSON.parse(r.data),
      );
    },
    call(id: string): CallLog | null {
      const r = db.prepare('SELECT data FROM calls WHERE id = ?').get(id) as { data: string } | undefined;
      return r ? JSON.parse(r.data) : null;
    },
    putCall(c: CallLog) {
      db.prepare('INSERT OR REPLACE INTO calls (id, started_at, data) VALUES (?, ?, ?)').run(c.id, c.startedAt, JSON.stringify(c));
    },
    userCount(): number {
      return (db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n;
    },
    user(username: string): { id: number; username: string; hash: string } | undefined {
      return db.prepare('SELECT * FROM users WHERE username = ?').get(username) as never;
    },
    addUser(username: string, hash: string) {
      db.prepare('INSERT INTO users (username, hash) VALUES (?, ?)').run(username, hash);
    },
    setUserHash(username: string, hash: string) {
      db.prepare('UPDATE users SET hash = ? WHERE username = ?').run(hash, username);
    },
    session(token: string): { user_id: number } | undefined {
      return db.prepare('SELECT user_id FROM sessions WHERE token = ?').get(token) as never;
    },
    addSession(token: string, userId: number) {
      db.prepare('INSERT INTO sessions (token, user_id, created_at) VALUES (?, ?, ?)').run(token, userId, Date.now());
    },
    removeSession(token: string) {
      db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    },
  };
}
