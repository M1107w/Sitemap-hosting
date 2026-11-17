import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useState, type ReactNode } from 'react';
import type { Settings } from '../shared/types';
import { api, logout, saveSettings, setSleep, useStore } from './store';
import { navigate } from './router';
import { dateLabel, Icon, spring, today } from './ui';
import { pickVoice, speak, unlockAudio } from './voice';

type IconName = Parameters<typeof Icon>[0]['name'];

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
  const [openBox, setOpenBox] = useState<string | null>(null);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  useEffect(() => {
    if (!('speechSynthesis' in window)) return;
    const load = () => setVoices(speechSynthesis.getVoices().filter((v) => v.lang.startsWith('en')));
    load();
    speechSynthesis.addEventListener?.('voiceschanged', load);
    return () => speechSynthesis.removeEventListener?.('voiceschanged', load);
  }, []);
  const quiet = !!checkin && checkin.quietUntil > Date.now();
  const set = (p: Partial<Settings>) => saveSettings(p);
  const box = (id: string) => ({ open: openBox === id, onToggle: () => setOpenBox(openBox === id ? null : id) });
  const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  return (
    <div className="mx-auto max-w-lg px-4 pb-36 pt-safe">
      <header className="pb-4 pt-5">
        <div className="text-[13px] text-muted">Only what matters, sir</div>
        <h1 className="mt-0.5 text-[28px] font-medium leading-tight tracking-tight">Settings</h1>
      </header>

      <div className="space-y-2.5">
        {/* Two switches up front */}
        <Card>
          <Head icon="bell" tint="text-cyan bg-cyan/[0.12]" title="Notifications" sub={pushSub(push.status)}>
            {push.status === 'on' ? (
              <Toggle on onChange={push.disable} />
            ) : push.status === 'off' || push.status === 'working' ? (
              <button onClick={push.enable} disabled={push.status === 'working'} className="press rounded-full bg-fg px-4 py-1.5 text-[13px] text-bg disabled:opacity-40">
                Turn on
              </button>
            ) : null}
          </Head>
        </Card>
        <Card>
          <Head icon="moon" tint="text-yellow bg-yellow/[0.12]" title="Going to sleep" sub={quiet ? `Quiet till ${s.wakeTime}` : 'No check-ins or nagging till morning'}>
            <Toggle on={quiet} onChange={() => setSleep(!quiet)} />
          </Head>
        </Card>

        {/* Everything else lives in boxes */}
        <Expand {...box('rem')} icon="clock" tint="text-green bg-green/[0.12]" title="Reminders" sub={`${s.reminderLeadMin} min before, then every ${s.snoozeEveryMin}`}>
          <Row label="Heads-up before">
            <Num value={s.reminderLeadMin} onChange={(v) => set({ reminderLeadMin: v })} suffix="min" />
          </Row>
          <Row label="Snooze every">
            <Num value={s.snoozeEveryMin} onChange={(v) => set({ snoozeEveryMin: v })} suffix="min" />
          </Row>
          {push.status === 'on' && (
            <Row label="Send a test">
              <TestBtn onClick={() => api('/api/push/test', { method: 'POST', json: {} })}>Send</TestBtn>
            </Row>
          )}
        </Expand>

        <Expand {...box('chk')} icon="mic" tint="text-cyan bg-cyan/[0.12]" title="Check-ins" sub={`Up to ${s.checkinsPerDayMax} a day · asks first after ${s.windDown}`}>
          <Row label="Max per day">
            <Num value={s.checkinsPerDayMax} onChange={(v) => set({ checkinsPerDayMax: v })} />
          </Row>
          <Row label="Ask first after">
            <Time value={s.windDown} onChange={(v) => set({ windDown: v })} />
          </Row>
          <Row label="Wake time">
            <Time value={s.wakeTime} onChange={(v) => set({ wakeTime: v })} />
          </Row>
        </Expand>

        <Expand {...box('deb')} icon="brief" tint="text-purple bg-purple/[0.14]" title="Debriefs" sub={`${DAYS[s.debriefWeekday]}s ${s.debriefTime} + before big days`}>
          <Row label="Weekly on">
            <select value={s.debriefWeekday} onChange={(e) => set({ debriefWeekday: Number(e.target.value) })} className="rounded-xl border border-line bg-raised px-2 py-1 text-[14px]">
              {DAYS.map((d, i) => (
                <option key={d} value={i}>
                  {d}
                </option>
              ))}
            </select>
          </Row>
          <Row label="Time">
            <Time value={s.debriefTime} onChange={(v) => set({ debriefTime: v })} />
          </Row>
          <Row label="Max per week">
            <Num value={s.debriefsPerWeekMax} onChange={(v) => set({ debriefsPerWeekMax: v })} />
          </Row>
        </Expand>

        <Expand {...box('ai')} icon="spark" tint="text-orange bg-orange/[0.12]" title="Voice & AI" sub={health?.ollama ? 'Online' : 'AI offline: simple commands only'}>
          <Row label="AI brain">
            <Status ok={!!health?.ollama} text={health?.ollama ? health.model : 'offline'} />
          </Row>
          <Row label="Speech to text">
            <Status ok={!!health?.whisper} text={health?.whisper ? 'server' : 'device'} />
          </Row>
          {push.status === 'on' && (
            <>
              <Row label="Test a check-in call">
                <TestBtn onClick={() => api('/api/checkin/test', { method: 'POST', json: { night: false } })}>Send</TestBtn>
              </Row>
              <Row label="Test the late-night prompt">
                <TestBtn onClick={() => api('/api/checkin/test', { method: 'POST', json: { night: true } })}>Send</TestBtn>
              </Row>
            </>
          )}
          {health?.tts && <VoicePicker voice={s.ttsVoice} speed={s.ttsSpeed} onVoice={(v) => set({ ttsVoice: v })} onSpeed={(v) => set({ ttsSpeed: v })} />}
          {!health?.tts && voices.length > 0 && (
            <Row label="Voice">
              <select value={s.voiceName || pickVoice('')?.name || ''} onChange={(e) => set({ voiceName: e.target.value })} className="max-w-[50vw] rounded-xl border border-line bg-raised px-2 py-1 text-[14px]">
                {voices.map((v) => (
                  <option key={v.name} value={v.name}>
                    {v.name}
                  </option>
                ))}
              </select>
            </Row>
          )}
        </Expand>

        <Expand {...box('acc')} icon="settings" tint="text-fg bg-fg/[0.08]" title="Account" sub={online ? (pending ? `${pending} change(s) syncing` : 'Synced') : 'Offline'}>
          <Row label="Sync">
            <Status ok={online} text={online ? 'online' : 'offline'} />
          </Row>
          {!isStandalone() && (
            <Row label="Install">
              <span className="max-w-[55%] text-right text-[13px] text-muted">{isIOS() ? 'Share → Add to Home Screen' : 'Address bar → Install'}</span>
            </Row>
          )}
          <Row label="Log out">
            <button onClick={logout} className="press text-[13px] text-red">
              Log out
            </button>
          </Row>
        </Expand>
      </div>
    </div>
  );
}

function pushSub(s: string) {
  if (s === 'on') return 'Reminders + check-ins on this device';
  if (s === 'needs-install') return 'Add to Home Screen first, then open it from there';
  if (s === 'denied') return 'Blocked: allow it in iOS Settings → Notifications';
  if (s === 'unsupported') return 'Not supported in this browser';
  return 'Off on this device';
}

function Card({ children }: { children: ReactNode }) {
  return <div className="rounded-[22px] border border-line/70 bg-card">{children}</div>;
}

function Head({ icon, tint, title, sub, children }: { icon: IconName; tint: string; title: string; sub?: string; children?: ReactNode }) {
  return (
    <div className="flex items-center gap-3.5 px-3.5 py-3">
      <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-[13px] ${tint}`}>
        <Icon name={icon} className="h-[20px] w-[20px]" stroke={1.9} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[15px] font-medium">{title}</div>
        {sub && <div className="truncate text-[12px] text-muted">{sub}</div>}
      </div>
      {children}
    </div>
  );
}

function Expand({ open, onToggle, icon, tint, title, sub, children }: { open: boolean; onToggle: () => void; icon: IconName; tint: string; title: string; sub: string; children: ReactNode }) {
  return (
    <div className={`clip-round overflow-hidden rounded-[22px] border border-line/70 transition-colors duration-200 ${open ? 'bg-raised' : 'bg-card'}`}>
      <button onClick={onToggle} className="w-full text-left">
        <Head icon={icon} tint={tint} title={title} sub={sub}>
          <motion.span animate={{ rotate: open ? 180 : 0 }} transition={spring} className="text-faint">
            <Icon name="chevron" className="h-5 w-5" />
          </motion.span>
        </Head>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ ...spring, opacity: { duration: 0.15 } }}>
            <div className="mx-3.5 border-t border-line/70 pb-1">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-[50px] items-center justify-between gap-3 py-2">
      <div className="text-[14px] text-fg/90">{label}</div>
      {children}
    </div>
  );
}
function Toggle({ on, onChange }: { on: boolean; onChange: () => void }) {
  return (
    <button onClick={onChange} role="switch" aria-checked={on} className={`relative h-[30px] w-[50px] shrink-0 rounded-full transition-colors duration-200 ${on ? 'bg-accent' : 'bg-line'}`}>
      <motion.span initial={false} animate={{ x: on ? 20 : 0 }} transition={spring} className="gpu absolute left-[3px] top-[3px] h-6 w-6 rounded-full bg-white shadow" />
    </button>
  );
}
function Num({ value, onChange, suffix }: { value: number; onChange: (v: number) => void; suffix?: string }) {
  const [v, setV] = useState(String(value));
  useEffect(() => setV(String(value)), [value]);
  return (
    <span className="flex items-center gap-1.5 text-[13px] text-muted">
      <input
        type="number"
        inputMode="numeric"
        value={v}
        onChange={(e) => setV(e.target.value)}
        onBlur={() => Number(v) !== value && v !== '' && onChange(Math.max(0, Number(v)))}
        className="w-14 rounded-xl border border-line bg-bg/60 px-2 py-1 text-right text-fg"
      />
      {suffix}
    </span>
  );
}
function Time({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return <input type="time" value={value} onChange={(e) => e.target.value && onChange(e.target.value)} className="rounded-xl border border-line bg-bg/60 px-2 py-1 text-[14px]" />;
}
const KOKORO_VOICES: { id: string; name: string; note: string }[] = [
  { id: 'bm_george', name: 'George', note: 'British · deep, composed' },
  { id: 'bm_fable', name: 'Fable', note: 'British · warm storyteller' },
  { id: 'bm_lewis', name: 'Lewis', note: 'British · smooth, low' },
  { id: 'bm_daniel', name: 'Daniel', note: 'British · crisp' },
  { id: 'am_michael', name: 'Michael', note: 'American · relaxed' },
  { id: 'am_adam', name: 'Adam', note: 'American · deep' },
  { id: 'bf_emma', name: 'Emma', note: 'British · calm' },
  { id: 'bf_isabella', name: 'Isabella', note: 'British · bright' },
  { id: 'af_heart', name: 'Heart', note: 'American · friendly' },
];
const SAMPLE = "Good evening, sir. Your pitch deck is up at eleven, and I've moved the gym to tomorrow.";

function VoicePicker({ voice, speed, onVoice, onSpeed }: { voice: string; speed: number; onVoice: (v: string) => void; onSpeed: (v: number) => void }) {
  const health = useStore((x) => x.health);
  const [playing, setPlaying] = useState<string | null>(null);
  const preview = async (id: string, sp = speed) => {
    unlockAudio();
    setPlaying(id);
    await speak(SAMPLE, health, '', { voice: id, speed: sp });
    setPlaying((p) => (p === id ? null : p));
  };
  return (
    <div className="py-2">
      <div className="pb-2 text-[14px] text-fg/90">Voice</div>
      <div className="space-y-1">
        {KOKORO_VOICES.map((v) => (
          <button
            key={v.id}
            onClick={() => {
              onVoice(v.id);
              preview(v.id);
            }}
            className={`press flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left transition-colors duration-200 ${voice === v.id ? 'bg-fg/[0.08]' : ''}`}
          >
            <span className={`grid h-5 w-5 place-items-center rounded-full border ${voice === v.id ? 'border-accent bg-accent text-bg' : 'border-faint'}`}>
              {voice === v.id && <Icon name="check" className="h-3 w-3" stroke={3} />}
            </span>
            <span className="flex-1">
              <span className="block text-[14px]">{v.name}</span>
              <span className="block text-[11.5px] text-muted">{v.note}</span>
            </span>
            <span className={`text-[12px] ${playing === v.id ? 'text-accent' : 'text-faint'}`}>{playing === v.id ? 'Playing…' : 'Preview'}</span>
          </button>
        ))}
      </div>
      <div className="pb-2 pt-4 text-[14px] text-fg/90">Pace</div>
      <div className="grid grid-cols-3 gap-2">
        {[
          [0.88, 'Measured'],
          [0.95, 'Natural'],
          [1.05, 'Brisk'],
        ].map(([v, label]) => (
          <button
            key={label}
            onClick={() => {
              onSpeed(v as number);
              preview(voice, v as number);
            }}
            className={`press rounded-2xl py-2 text-[13px] ${Math.abs(speed - (v as number)) < 0.01 ? 'bg-fg text-bg' : 'bg-bg/60 text-fg/85'}`}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Button that shows "Sent ✓" briefly so you know it went. */
function TestBtn({ onClick, children }: { onClick: () => Promise<unknown>; children: ReactNode }) {
  const [state, setState] = useState<'idle' | 'busy' | 'sent' | 'fail'>('idle');
  return (
    <button
      disabled={state === 'busy'}
      onClick={async () => {
        setState('busy');
        try {
          await onClick();
          setState('sent');
        } catch {
          setState('fail');
        }
        setTimeout(() => setState('idle'), 2500);
      }}
      className="press rounded-full bg-fg/[0.08] px-3 py-1 text-[13px] disabled:opacity-50"
    >
      {state === 'sent' ? 'Sent ✓ lock your phone' : state === 'fail' ? 'Failed' : children}
    </button>
  );
}

function Status({ ok, text }: { ok: boolean; text: string }) {
  return (
    <span className="flex items-center gap-2 text-[13px] text-muted">
      <span className={`h-2 w-2 rounded-full ${ok ? 'bg-accent' : 'bg-faint'}`} />
      {text}
    </span>
  );
}

// ------------------------------------------------------------ Talk tab

function CallHistory() {
  const calls = useStore((x) => x.calls);
  const tz = useStore((x) => x.settings.timezone);
  const t = today(tz);
  const shown = calls.filter((c) => c.transcript.length > 1 || c.changes.length).slice(0, 6);
  const [open, setOpen] = useState<string | null>(null);
  if (!shown.length) return null;
  return (
    <section className="mt-6">
      <div className="mb-2 px-1 text-[11px] font-medium uppercase tracking-wider text-faint">Recent calls</div>
      <div className="space-y-2">
        {shown.map((c) => {
          const d = new Date(c.startedAt);
          const isOpen = open === c.id;
          return (
            <div key={c.id} className="clip-round overflow-hidden rounded-[20px] border border-line/70 bg-card">
              <button onClick={() => setOpen(isOpen ? null : c.id)} className="flex w-full items-center justify-between px-4 py-3 text-left text-[14px]">
                <span>
                  {c.kind === 'debrief' ? 'Debrief' : 'Check-in'} · {dateLabel(d.toISOString().slice(0, 10), t)} {d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
                <span className="text-[12px] text-muted">
                  {c.changes.length} change{c.changes.length === 1 ? '' : 's'}
                </span>
              </button>
              <AnimatePresence initial={false}>
                {isOpen && (
                  <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={spring}>
                    <div className="space-y-1 px-4 pb-3 text-[13px]">
                      {c.changes.map((x, i) => (
                        <div key={i} className="text-green">
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
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </div>
    </section>
  );
}

export function TalkView() {
  const debriefs = useStore((x) => x.debriefs);
  const tz = useStore((x) => x.settings.timezone);
  const t = today(tz);
  const next = debriefs.find((d) => d.status === 'scheduled' && d.date >= t);
  return (
    <div className="mx-auto max-w-lg px-4 pb-36 pt-safe">
      <header className="pb-4 pt-5">
        <div className="text-[13px] text-muted">I'll move, add and tick things off for you</div>
        <h1 className="mt-0.5 text-[28px] font-medium leading-tight tracking-tight">At your service, sir.</h1>
      </header>
      <div className="space-y-2.5">
        <BigBtn icon="mic" tint="text-cyan bg-cyan/[0.12]" title="Quick check-in" sub="Talk through what you're doing now" onClick={() => navigate('/call?mode=chat')} />
        <BigBtn icon="brief" tint="text-purple bg-purple/[0.14]" title="Debrief now" sub="Today, tomorrow and the rest of the week" onClick={() => navigate('/call?mode=debrief')} />
      </div>
      {next && (
        <p className="mt-4 px-1 text-[13px] text-muted">
          Next scheduled debrief: {dateLabel(next.date, t)} at {next.time} · {next.reason}
        </p>
      )}
      <CallHistory />
    </div>
  );
}

function BigBtn({ icon, tint, title, sub, onClick }: { icon: IconName; tint: string; title: string; sub: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="press flex w-full items-center gap-3.5 rounded-[22px] border border-line/70 bg-card px-3.5 py-3.5 text-left">
      <span className={`grid h-12 w-12 place-items-center rounded-2xl ${tint}`}>
        <Icon name={icon} className="h-[22px] w-[22px]" stroke={1.9} />
      </span>
      <span className="flex-1">
        <span className="block text-[15.5px] font-medium">{title}</span>
        <span className="block text-[12.5px] text-muted">{sub}</span>
      </span>
      <Icon name="right" className="h-5 w-5 text-faint" />
    </button>
  );
}
