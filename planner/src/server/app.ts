import { Hono } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { streamSSE } from 'hono/streaming';
import { hash, verify } from '@node-rs/argon2';
import crypto from 'node:crypto';
import type { Core } from './core';
import type { CallLog, Debrief, ServerEvent, Settings, Task } from '../shared/types';
import { nextWake } from './logic';
import { greeting, ollamaUp, OllamaProvider, runTurn, type Provider } from './assistant';
import { uid } from '../shared/time';
import { seedTasks } from './seed';

const WHISPER_URL = process.env.WHISPER_URL || '';
const TTS_URL = process.env.TTS_URL || '';

export function createApp(core: Core, opts: { provider?: Provider | null } = {}) {
  const app = new Hono();
  const ollama = new OllamaProvider();
  let ollamaOk = false;
  let ollamaCheckedAt = 0;
  async function provider(): Promise<Provider | null> {
    if (opts.provider !== undefined) return opts.provider;
    if (Date.now() - ollamaCheckedAt > 30_000) {
      ollamaOk = await ollamaUp(ollama.url);
      ollamaCheckedAt = Date.now();
    }
    return ollamaOk ? ollama : null;
  }

  // ---------------------------------------------------------- auth
  const attempts = new Map<string, { n: number; at: number }>();
  const secure = process.env.COOKIE_SECURE === '1';
  function startSession(c: Parameters<typeof setCookie>[0], userId: number) {
    const token = crypto.randomBytes(32).toString('base64url');
    core.db.addSession(token, userId);
    setCookie(c, 'sid', token, { httpOnly: true, sameSite: 'Lax', secure, path: '/', maxAge: 60 * 60 * 24 * 365 });
  }

  app.get('/api/health', async (c) =>
    c.json({ ok: true, ollama: await ollamaUp(ollama.url), model: ollama.model, whisper: !!WHISPER_URL, tts: !!TTS_URL }),
  );

  app.get('/api/auth/state', (c) => {
    const sid = getCookie(c, 'sid');
    return c.json({ hasUser: core.db.userCount() > 0, loggedIn: !!(sid && core.db.session(sid)) });
  });

  app.post('/api/auth/setup', async (c) => {
    if (core.db.userCount() > 0) return c.json({ error: 'Account already exists' }, 400);
    const { username, password, seed, timezone } = await c.req.json();
    if (!username || String(password || '').length < 6) return c.json({ error: 'Pick a username and a password of 6+ characters' }, 400);
    core.db.addUser(String(username).trim().toLowerCase(), await hash(String(password)));
    const user = core.db.user(String(username).trim().toLowerCase())!;
    if (timezone) core.setSettings({ ...core.settings(), timezone });
    if (seed) for (const t of seedTasks(core.now(), core.settings().timezone)) core.saveTask(t);
    startSession(c, user.id);
    return c.json({ ok: true });
  });

  app.post('/api/auth/login', async (c) => {
    const ip = c.req.header('x-forwarded-for') || 'local';
    const a = attempts.get(ip) ?? { n: 0, at: Date.now() };
    if (Date.now() - a.at > 15 * 60_000) Object.assign(a, { n: 0, at: Date.now() });
    if (a.n >= 10) return c.json({ error: 'Too many tries. Wait 15 minutes.' }, 429);
    const { username, password } = await c.req.json();
    const user = core.db.user(String(username || '').trim().toLowerCase());
    if (!user || !(await verify(user.hash, String(password || '')))) {
      a.n++;
      attempts.set(ip, a);
      return c.json({ error: 'Wrong username or password' }, 401);
    }
    attempts.delete(ip);
    startSession(c, user.id);
    return c.json({ ok: true });
  });

  app.post('/api/auth/logout', (c) => {
    const sid = getCookie(c, 'sid');
    if (sid) core.db.removeSession(sid);
    deleteCookie(c, 'sid', { path: '/' });
    return c.json({ ok: true });
  });

  app.use('/api/*', async (c, next) => {
    if (c.req.path.startsWith('/api/auth/') || c.req.path === '/api/health') return next();
    const sid = getCookie(c, 'sid');
    if (!sid || !core.db.session(sid)) return c.json({ error: 'auth' }, 401);
    return next();
  });

  // ---------------------------------------------------------- data
  app.get('/api/bootstrap', (c) =>
    c.json({
      tasks: core.db.tasks(),
      debriefs: core.db.debriefs(),
      settings: core.settings(),
      checkin: core.checkin(),
      calls: core.db.calls(20),
      vapidPublicKey: core.vapidPublicKey,
      serverNow: core.now(),
    }),
  );

  app.put('/api/tasks/:id', async (c) => {
    const t = (await c.req.json()) as Task;
    if (t.id !== c.req.param('id')) return c.json({ error: 'id mismatch' }, 400);
    return c.json(core.saveTask(t));
  });

  app.post('/api/tasks/batch', async (c) => {
    const list = (await c.req.json()) as Task[];
    return c.json(list.map((t) => core.saveTask(t)));
  });

  app.put('/api/settings', async (c) => {
    const s = { ...core.settings(), ...((await c.req.json()) as Partial<Settings>) };
    core.setSettings(s);
    return c.json(s);
  });

  app.put('/api/debriefs/:id', async (c) => {
    const patch = (await c.req.json()) as Partial<Debrief>;
    let list = core.db.debriefs();
    const id = c.req.param('id');
    const existing = list.find((d) => d.id === id);
    const next: Debrief = {
      id,
      date: patch.date ?? existing?.date ?? '',
      time: patch.time ?? existing?.time ?? core.settings().debriefTime,
      reason: patch.reason ?? existing?.reason ?? 'Debrief',
      status: patch.status ?? existing?.status ?? 'scheduled',
      pinned: true,
      updatedAt: core.now(),
    };
    list = [...list.filter((d) => d.id !== id), next];
    core.db.setDebriefs(list);
    core.replanDebriefs();
    core.emit({ type: 'debriefs', debriefs: core.db.debriefs() });
    return c.json(next);
  });

  app.post('/api/activity', (c) => {
    const st = core.checkin();
    core.db.setCheckin({ ...st, lastActivityAt: core.now() });
    return c.json({ ok: true });
  });

  app.post('/api/sleep', async (c) => {
    const { on } = await c.req.json().catch(() => ({ on: true }));
    const st = core.checkin();
    core.setCheckin({ ...st, pendingConsent: null, quietUntil: on === false ? 0 : nextWake(core.now(), core.settings()) });
    return c.json(core.checkin());
  });

  app.post('/api/checkin/consent', async (c) => {
    const { id, answer } = await c.req.json();
    const st = core.checkin();
    const pending = st.pendingConsent;
    if (!pending || pending.id !== id) return c.json({ ok: false, expired: true, state: st });
    if (answer === 'yes') {
      core.setCheckin({ ...st, pendingConsent: null });
      return c.json({ ok: true, taskId: pending.taskId });
    }
    core.setCheckin({ ...st, pendingConsent: null, quietUntil: nextWake(core.now(), core.settings()) });
    return c.json({ ok: true });
  });

  // ---------------------------------------------------------- push
  app.post('/api/push/subscribe', async (c) => {
    core.db.addPushSub(await c.req.json());
    return c.json({ ok: true });
  });
  app.post('/api/push/unsubscribe', async (c) => {
    const { endpoint } = await c.req.json();
    core.db.removePushSub(endpoint);
    return c.json({ ok: true });
  });
  app.post('/api/push/test', async (c) => {
    await core.push({ title: 'Test notification ✅', body: 'Reminders will look like this.', url: '/' });
    return c.json({ ok: true, devices: core.db.pushSubs().length });
  });

  // ---------------------------------------------------------- calls
  app.get('/api/calls', (c) => c.json(core.db.calls(50)));

  app.post('/api/call/start', async (c) => {
    const { kind, taskId, debriefId } = await c.req.json();
    const call: CallLog = {
      id: uid(),
      kind: kind === 'debrief' ? 'debrief' : kind === 'chat' ? 'chat' : 'checkin',
      taskId: taskId ?? null,
      startedAt: core.now(),
      endedAt: null,
      transcript: [],
      changes: [],
    };
    const text = greeting(core, call);
    call.transcript.push({ role: 'assistant', text });
    core.db.putCall(call);
    if (debriefId) {
      const list = core.db.debriefs().map((d) => (d.id === debriefId ? { ...d, status: 'done' as const, updatedAt: core.now() } : d));
      core.db.setDebriefs(list);
      core.emit({ type: 'debriefs', debriefs: list });
    }
    const p = await provider();
    return c.json({ call, greeting: text, ai: p?.name ?? 'fallback' });
  });

  app.post('/api/call/:id/turn', async (c) => {
    const call = core.db.call(c.req.param('id'));
    if (!call) return c.json({ error: 'no call' }, 404);
    const { text } = await c.req.json();
    if (!String(text || '').trim()) return c.json({ reply: "Didn't catch that.", changes: [], call });
    let result;
    try {
      result = await runTurn(core, call, String(text), await provider());
    } catch (e) {
      core.log(`assistant error: ${(e as Error).message}`);
      result = await runTurn(core, call, String(text), null);
    }
    call.transcript.push({ role: 'user', text: String(text) }, { role: 'assistant', text: result.reply });
    call.changes.push(...result.changes);
    core.db.putCall(call);
    core.emit({ type: 'call', call });
    return c.json({ ...result, call });
  });

  app.post('/api/call/:id/end', (c) => {
    const call = core.db.call(c.req.param('id'));
    if (!call) return c.json({ error: 'no call' }, 404);
    call.endedAt = core.now();
    core.db.putCall(call);
    core.emit({ type: 'call', call });
    return c.json(call);
  });

  // ---------------------------------------------------------- voice I/O
  app.post('/api/stt', async (c) => {
    if (!WHISPER_URL) return c.json({ error: 'no stt' }, 501);
    const body = await c.req.arrayBuffer();
    const type = c.req.header('content-type') || 'audio/webm';
    const ext = type.includes('mp4') || type.includes('m4a') ? 'm4a' : type.includes('wav') ? 'wav' : type.includes('ogg') ? 'ogg' : 'webm';
    const form = new FormData();
    form.append('file', new Blob([body], { type }), `speech.${ext}`);
    form.append('response_format', 'json');
    form.append('temperature', '0.0');
    try {
      const r = await fetch(`${WHISPER_URL}/inference`, { method: 'POST', body: form, signal: AbortSignal.timeout(60_000) });
      if (!r.ok) return c.json({ error: `whisper ${r.status}` }, 502);
      const data = (await r.json()) as { text?: string };
      const text = (data.text || '').replace(/\[[^\]]*\]|\([^)]*\)/g, '').trim();
      return c.json({ text });
    } catch (e) {
      return c.json({ error: (e as Error).message }, 502);
    }
  });

  app.post('/api/tts', async (c) => {
    if (!TTS_URL) return c.json({ error: 'no tts' }, 501);
    const { text } = await c.req.json();
    try {
      const r = await fetch(`${TTS_URL}/tts`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: String(text).slice(0, 1000) }),
        signal: AbortSignal.timeout(30_000),
      });
      if (!r.ok) return c.json({ error: `tts ${r.status}` }, 502);
      return new Response(r.body, { headers: { 'content-type': r.headers.get('content-type') || 'audio/wav' } });
    } catch (e) {
      return c.json({ error: (e as Error).message }, 502);
    }
  });

  // ---------------------------------------------------------- live events
  app.get('/api/events', (c) =>
    streamSSE(c, async (stream) => {
      const queue: ServerEvent[] = [];
      let wake: (() => void) | null = null;
      const listener = (e: ServerEvent) => {
        queue.push(e);
        wake?.();
      };
      core.listeners.add(listener);
      stream.onAbort(() => {
        core.listeners.delete(listener);
        wake?.();
      });
      await stream.writeSSE({ event: 'hello', data: String(core.now()) });
      while (!stream.aborted) {
        while (queue.length) await stream.writeSSE({ event: 'change', data: JSON.stringify(queue.shift()) });
        await new Promise<void>((r) => {
          wake = r;
          setTimeout(r, 25_000);
        });
        wake = null;
        if (!queue.length && !stream.aborted) await stream.writeSSE({ event: 'ping', data: '' });
      }
      core.listeners.delete(listener);
    }),
  );

  return app;
}
