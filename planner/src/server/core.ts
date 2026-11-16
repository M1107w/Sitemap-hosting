// Shared server state: database, live event bus, push, and the task mutations
// that both the REST API and the voice assistant go through.
import * as webpush from 'web-push';
import type { DB } from './db';
import type { CheckinState, ServerEvent, Settings, Task } from '../shared/types';
import { planDebriefs } from './logic';

type Listener = (e: ServerEvent) => void;

export class Core {
  listeners = new Set<Listener>();
  vapidPublicKey = '';
  private replanTimer: NodeJS.Timeout | null = null;
  log: (msg: string) => void = (m) => console.log(new Date().toISOString(), m);

  constructor(public db: DB, public now: () => number = Date.now) {
    this.initPush();
  }

  emit(e: ServerEvent) {
    for (const l of this.listeners) {
      try {
        l(e);
      } catch {
        /* listener gone */
      }
    }
  }

  // ------------------------------------------------------------ push
  private initPush() {
    let keys = this.db.kv<{ publicKey: string; privateKey: string } | null>('vapid', null);
    if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
      keys = { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY };
    }
    if (!keys) {
      keys = webpush.generateVAPIDKeys();
      this.db.setKv('vapid', keys);
    }
    // Apple requires a real-looking contact; it never receives mail from us.
    webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:planner@example.com', keys.publicKey, keys.privateKey);
    this.vapidPublicKey = keys.publicKey;
  }

  sent: { title: string; body: string; url: string; at: number }[] = [];

  async push(p: { title: string; body: string; url?: string; tag?: string; requireInteraction?: boolean }) {
    const payload = { url: '/', ...p };
    this.sent.push({ title: p.title, body: p.body, url: payload.url, at: this.now() });
    if (this.sent.length > 50) this.sent.shift();
    this.log(`push: ${p.title} | ${p.body}`);
    const subs = this.db.pushSubs();
    await Promise.all(
      subs.map(async (sub) => {
        try {
          await webpush.sendNotification(sub, JSON.stringify(payload), { TTL: 60 * 30, urgency: 'high' });
        } catch (err: unknown) {
          const code = (err as { statusCode?: number }).statusCode;
          if (code === 404 || code === 410) this.db.removePushSub(sub.endpoint);
          else this.log(`push failed (${code ?? 'network'}): ${(err as Error).message}`);
        }
      }),
    );
  }

  // ------------------------------------------------------------ tasks
  saveTask(t: Task): Task {
    const stored = this.db.putTask(t);
    this.emit({ type: 'task', task: stored });
    this.scheduleReplan();
    return stored;
  }

  touch(t: Task, patch: Partial<Task>): Task {
    return this.saveTask({ ...t, ...patch, updatedAt: Math.max(this.now(), t.updatedAt + 1) });
  }

  settings(): Settings {
    return this.db.settings();
  }

  setSettings(s: Settings) {
    this.db.setSettings(s);
    this.emit({ type: 'settings', settings: s });
    this.replanDebriefs();
  }

  checkin(): CheckinState {
    return this.db.checkin();
  }

  setCheckin(s: CheckinState) {
    this.db.setCheckin(s);
    this.emit({ type: 'checkin', state: s });
  }

  // ------------------------------------------------------------ debriefs
  scheduleReplan() {
    if (this.replanTimer) return;
    this.replanTimer = setTimeout(() => {
      this.replanTimer = null;
      this.replanDebriefs();
    }, 500);
  }

  replanDebriefs() {
    const before = JSON.stringify(this.db.debriefs());
    const plan = planDebriefs(this.db.tasks(), this.db.debriefs(), this.settings(), this.now());
    if (JSON.stringify(plan) !== before) {
      this.db.setDebriefs(plan);
      this.emit({ type: 'debriefs', debriefs: plan });
    }
  }
}
