import { useEffect, useState } from 'react';
import type { Settings } from '../shared/types';
import { api, logout, saveSettings, setSleep, useStore } from './store';
import { navigate } from './router';
import { dateLabel, Icon, today } from './ui';
import { pickVoice } from './voice';

function urlB64ToUint8Array(b64: string) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

export const isStandalone = () =>
  window.matchMedia?.('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent);

export function usePush() {
  const vapid = useStore((s) => s.vapidPublicKey);
  const [status, setStatus] = useState<'unsupported' | 'needs-install' | 'off' | 'on' | 'denied' | 'working'>('off');
  useEffect(() => {
    (async () => {
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) return setStatus(isIOS() && !isStandalone() ? 'needs-install' : 'unsupported');
      if (Notification.permission === 'denied') return setStatus('denied');
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager.getSubscription();
      setStatus(sub ? 'on' : 'off');
    })();
  }, []);
  const enable = async () => {
    setStatus('working');
    try {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') return setStatus('denied');
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToUint8Array(vapid) });
      await api('/api/push/subscribe', { method: 'POST', json: sub.toJSON() });
      setStatus('on');
    } catch (e) {
      alert(`Couldn't turn on notifications: ${(e as Error).message}`);
      setStatus('off');
    }
  };
  const disable = async () => {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    if (sub) {
      await api('/api/push/unsubscribe', { method: 'POST', json: { endpoint: sub.endpoint } }).catch(() => {});
      await sub.unsubscribe();
    }
    setStatus('off');
  };
  return { status, enable, disable };
}

export function SettingsView() {
  const s = useStore((x) => x.settings);
  const checkin = useStore((x) => x.checkin);
  const health = useStore((x) => x.health);
  const online = useStore((x) => x.online);
  const pending = useStore((x) => x.pending);
  const push = usePush();
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  useEffect(() => {
    if (!('speechSynthesis' in window)) return;
    const load = () => setVoices(speechSynthesis.getVoices().filter((v) => v.lang.startsWith('en')));
    load();
    speechSynthesis.addEventListener?.('voiceschanged', load);
    return () => speechSynthesis.removeEventListener?.('voiceschanged', load);
  }, []);
  const quiet = checkin && checkin.quietUntil > Date.now();
  const set = (p: Partial<Settings>) => saveSettings(p);

  return (
    <div className="mx-auto max-w-lg px-4 pb-28 pt-safe">
      <h1 className="pb-4 pt-4 text-[30px] font-semibold tracking-tight">Settings</h1>

      <Group title="Notifications">
        {push.status === 'needs-install' ? (
          <Row label="Add to Home Screen first">
            <span className="max-w-[60%] text-right text-[13px] text-muted">On iPhone: Share → Add to Home Screen, then open it from there.</span>
          </Row>
        ) : (
          <Row label="Push notifications" hint={push.status === 'denied' ? 'Blocked. Allow in iOS Settings → Notifications → Today' : undefined}>
            {push.status === 'on' ? (
              <Toggle on onChange={push.disable} />
            ) : push.status === 'unsupported' ? (
              <span className="text-[13px] text-muted">Not supported here</span>
            ) : (
              <button onClick={push.enable} disabled={push.status === 'working' || push.status === 'denied'} className="press rounded-full bg-fg px-4 py-1.5 text-[13px] text-bg disabled:opacity-40">
                Turn on
              </button>
            )}
          </Row>
        )}
        {push.status === 'on' && (
          <Row label="Send a test">
            <button onClick={() => api('/api/push/test', { method: 'POST', json: {} })} className="press text-[13px] text-muted">
              Send
            </button>
          </Row>
        )}
        <Row label="Heads-up before due">
          <Num value={s.reminderLeadMin} onChange={(v) => set({ reminderLeadMin: v })} suffix="min" />
        </Row>
        <Row label="Snooze every" hint={`then every ${s.snoozeFastEveryMin} min after ${s.snoozeFastAfterMin} min overdue`}>
          <Num value={s.snoozeEveryMin} onChange={(v) => set({ snoozeEveryMin: v })} suffix="min" />
        </Row>
      </Group>

      <Group title="Check-ins">
        <Row label="I'm going to sleep" hint={quiet ? `Quiet till ${new Date(checkin!.quietUntil).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'Stops check-ins and snoozes till wake time'}>
          <Toggle on={!!quiet} onChange={() => setSleep(!quiet)} />
        </Row>
        <Row label="Wind-down" hint="After this, check-ins ask “u up?” first">
          <Time value={s.windDown} onChange={(v) => set({ windDown: v })} />
        </Row>
        <Row label="Wake time" hint="A “no” or no answer = quiet till here">
          <Time value={s.wakeTime} onChange={(v) => set({ wakeTime: v })} />
        </Row>
        <Row label="Max per day">
          <Num value={s.checkinsPerDayMax} onChange={(v) => set({ checkinsPerDayMax: v })} />
        </Row>
        <Row label="At least this far apart">
          <Num value={s.checkinMinGapMin} onChange={(v) => set({ checkinMinGapMin: v })} suffix="min" />
        </Row>
      </Group>

      <Group title="Debriefs">
        <Row label="Weekly debrief on">
          <select value={s.debriefWeekday} onChange={(e) => set({ debriefWeekday: Number(e.target.value) })} className="rounded-lg border border-line px-2 py-1 text-[14px]">
            {['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map((d, i) => (
              <option key={d} value={i}>
                {d}
              </option>
            ))}
          </select>
        </Row>
        <Row label="Debrief time">
          <Time value={s.debriefTime} onChange={(v) => set({ debriefTime: v })} />
        </Row>
        <Row label="Max per week">
          <Num value={s.debriefsPerWeekMax} onChange={(v) => set({ debriefsPerWeekMax: v })} />
        </Row>
        <Row label="“Big day” means" hint="Adds a debrief the night before">
          <Num value={Math.round(s.heavyDayMin / 60)} onChange={(v) => set({ heavyDayMin: v * 60 })} suffix="h+" />
        </Row>
      </Group>

      <Group title="Voice">
        <Row label="AI brain" hint={health?.ollama ? `${health.model} (local, open-source)` : 'Model offline: simple commands only'}>
          <Dot ok={!!health?.ollama} />
        </Row>
        <Row label="Speech to text" hint={health?.whisper ? 'whisper.cpp on your server' : 'Using the device recogniser'}>
          <Dot ok={!!health?.whisper} />
        </Row>
        {!health?.tts && voices.length > 0 && (
          <Row label="Voice">
            <select value={s.voiceName || pickVoice('')?.name || ''} onChange={(e) => set({ voiceName: e.target.value })} className="max-w-[55vw] rounded-lg border border-line px-2 py-1 text-[14px]">
              {voices.map((v) => (
                <option key={v.name} value={v.name}>
                  {v.name} ({v.lang})
                </option>
              ))}
            </select>
          </Row>
        )}
        <Row label="Start a check-in now">
          <button onClick={() => navigate('/call?mode=chat')} className="press text-[13px] text-muted">
            Talk
          </button>
        </Row>
      </Group>

      <CallHistory />

      <Group title="App">
        <Row label="Sync" hint={pending ? `${pending} change(s) waiting to sync` : undefined}>
          <span className="flex items-center gap-2 text-[13px] text-muted">
            <Dot ok={online} /> {online ? 'Online' : 'Offline'}
          </span>
        </Row>
        {!isStandalone() && (
          <Row label="Install">
            <span className="max-w-[60%] text-right text-[13px] text-muted">{isIOS() ? 'Share → Add to Home Screen' : 'Browser menu → Install app'}</span>
          </Row>
        )}
        <Row label="Log out">
          <button onClick={logout} className="press text-[13px] text-accent">
            Log out
          </button>
        </Row>
      </Group>
    </div>
  );
}

function CallHistory() {
  const calls = useStore((x) => x.calls);
  const tz = useStore((x) => x.settings.timezone);
  const t = today(tz);
  const shown = calls.filter((c) => c.transcript.length > 1 || c.changes.length).slice(0, 6);
  if (!shown.length) return null;
  return (
    <Group title="Recent calls">
      {shown.map((c) => {
        const d = new Date(c.startedAt);
        const date = d.toISOString().slice(0, 10);
        return (
          <details key={c.id} className="px-4 py-3">
            <summary className="flex cursor-pointer list-none items-center justify-between text-[14px]">
              <span>
                {c.kind === 'debrief' ? 'Debrief' : 'Check-in'} · {dateLabel(date, t)} {d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
              <span className="text-[12px] text-muted">{c.changes.length} change{c.changes.length === 1 ? '' : 's'}</span>
            </summary>
            <div className="mt-2 space-y-1 text-[13px]">
              {c.changes.map((x, i) => (
                <div key={i} className="text-ok">
                  ✓ {x.summary}
                </div>
              ))}
              {c.transcript.map((l, i) => (
                <div key={i} className={l.role === 'user' ? 'text-muted' : ''}>
                  {l.role === 'user' ? 'You: ' : ''}
                  {l.text}
                </div>
              ))}
            </div>
          </details>
        );
      })}
    </Group>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-6">
      <div className="mb-2 px-1 text-[12px] font-medium uppercase tracking-wide text-muted">{title}</div>
      <div className="divide-y divide-line rounded-2xl border border-line bg-card">{children}</div>
    </section>
  );
}
function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-[52px] items-center justify-between gap-3 px-4 py-2.5">
      <div>
        <div className="text-[15px]">{label}</div>
        {hint && <div className="text-[12px] text-muted">{hint}</div>}
      </div>
      {children}
    </div>
  );
}
function Toggle({ on, onChange }: { on: boolean; onChange: () => void }) {
  return (
    <button onClick={onChange} role="switch" aria-checked={on} className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${on ? 'bg-ok' : 'bg-line'}`}>
      <span className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-[22px]' : 'translate-x-0.5'}`} />
    </button>
  );
}
function Num({ value, onChange, suffix }: { value: number; onChange: (v: number) => void; suffix?: string }) {
  const [v, setV] = useState(String(value));
  useEffect(() => setV(String(value)), [value]);
  return (
    <span className="flex items-center gap-1.5 text-[14px] text-muted">
      <input
        type="number"
        inputMode="numeric"
        value={v}
        onChange={(e) => setV(e.target.value)}
        onBlur={() => Number(v) !== value && v !== '' && onChange(Math.max(0, Number(v)))}
        className="w-14 rounded-lg border border-line px-2 py-1 text-right text-fg"
      />
      {suffix}
    </span>
  );
}
function Time({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return <input type="time" value={value} onChange={(e) => e.target.value && onChange(e.target.value)} className="rounded-lg border border-line px-2 py-1 text-[14px]" />;
}
function Dot({ ok }: { ok: boolean }) {
  return <span className={`inline-block h-2 w-2 rounded-full ${ok ? 'bg-ok' : 'bg-muted/50'}`} />;
}

export function TalkView() {
  const debriefs = useStore((x) => x.debriefs);
  const tz = useStore((x) => x.settings.timezone);
  const t = today(tz);
  const next = debriefs.find((d) => d.status === 'scheduled' && d.date >= t);
  return (
    <div className="mx-auto max-w-lg px-4 pb-28 pt-safe">
      <h1 className="pb-2 pt-4 text-[30px] font-semibold tracking-tight">Talk</h1>
      <p className="mb-6 text-[14px] text-muted">Tell me what's going on. I'll move, add and tick things off for you.</p>
      <div className="grid gap-3">
        <BigBtn icon="talk" title="Quick check-in" sub="Talk through what you're doing now" onClick={() => navigate('/call?mode=chat')} />
        <BigBtn icon="month" title="Debrief now" sub="What's left today, tomorrow and the rest of the week" onClick={() => navigate('/call?mode=debrief')} />
      </div>
      {next && (
        <p className="mt-6 text-[13px] text-muted">
          Next scheduled debrief: {dateLabel(next.date, t)} at {next.time} · {next.reason}
        </p>
      )}
      <CallHistory />
    </div>
  );
}

function BigBtn({ icon, title, sub, onClick }: { icon: 'talk' | 'month'; title: string; sub: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="press flex items-center gap-4 rounded-2xl border border-line bg-card px-4 py-4 text-left">
      <span className="grid h-11 w-11 place-items-center rounded-full bg-fg text-bg">
        <Icon name={icon} />
      </span>
      <span>
        <span className="block text-[16px] font-medium">{title}</span>
        <span className="block text-[13px] text-muted">{sub}</span>
      </span>
    </button>
  );
}
