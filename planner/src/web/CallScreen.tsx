import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';
import type { CallChange, CallLog } from '../shared/types';
import { api, getState, useStore } from './store';
import { navigate } from './router';
import { Icon } from './ui';
import { canListen, listen, releaseMic, speak, stopSpeaking, unlockAudio, type Listening } from './voice';

type Phase = 'ready' | 'speaking' | 'listening' | 'thinking' | 'ended' | 'error';

export function CallScreen({ mode, taskId, debriefId }: { mode: 'checkin' | 'debrief' | 'chat'; taskId: string | null; debriefId: string | null }) {
  const health = useStore((s) => s.health);
  const settings = useStore((s) => s.settings);
  const task = useStore((s) => (taskId ? s.tasks[taskId] : null));
  const [phase, setPhase] = useState<Phase>('ready');
  const [call, setCall] = useState<CallLog | null>(null);
  const [lines, setLines] = useState<{ role: 'user' | 'assistant'; text: string }[]>([]);
  const [changes, setChanges] = useState<CallChange[]>([]);
  const [typing, setTyping] = useState(false);
  const [draft, setDraft] = useState('');
  const [muted, setMuted] = useState(false);
  const [level, setLevel] = useState(0);
  const [ai, setAi] = useState('');
  const listening = useRef<Listening | null>(null);
  const alive = useRef(true);
  const mutedRef = useRef(false);
  mutedRef.current = muted;
  const typingRef = useRef(false);
  typingRef.current = typing;
  const voiceOk = canListen(health);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      listening.current?.cancel();
      stopSpeaking();
      releaseMic();
    };
  }, []);

  useEffect(() => {
    if (phase !== 'listening') return setLevel(0);
    const h = setInterval(() => setLevel(listening.current?.level() ?? 0), 80);
    return () => clearInterval(h);
  }, [phase]);

  const say = async (text: string) => {
    setLines((l) => [...l, { role: 'assistant', text }]);
    if (typingRef.current || !alive.current) return;
    setPhase('speaking');
    await speak(text, health, settings.voiceName);
  };

  const loop = async (c: CallLog) => {
    while (alive.current) {
      if (mutedRef.current || typingRef.current) {
        setPhase('ready');
        return;
      }
      setPhase('listening');
      let text: string | null = null;
      try {
        listening.current = await listen(health);
        text = await listening.current.result;
      } catch {
        setTyping(true);
        setPhase('ready');
        return;
      }
      listening.current = null;
      if (!alive.current || text === null) return;
      if (!text.trim()) continue;
      const done = await send(c, text);
      if (done) return;
    }
  };

  const send = async (c: CallLog, text: string): Promise<boolean> => {
    setLines((l) => [...l, { role: 'user', text }]);
    setPhase('thinking');
    try {
      const r = await api<{ reply: string; changes: CallChange[] }>(`/api/call/${c.id}/turn`, { method: 'POST', json: { text } });
      setChanges((x) => [...x, ...r.changes]);
      await say(r.reply);
      if (/\b(bye|that'?s all|that'?s it|nothing else|i'?m good|cheers|thanks)\b\W*$/i.test(text) || r.changes.some((x) => x.tool === 'going_to_sleep')) {
        await end(c);
        return true;
      }
    } catch {
      await say("Couldn't reach the server. Try again in a sec.");
    }
    return false;
  };

  const start = async () => {
    unlockAudio();
    setPhase('thinking');
    try {
      const r = await api<{ call: CallLog; greeting: string; ai: string }>('/api/call/start', { method: 'POST', json: { kind: mode, taskId, debriefId } });
      setCall(r.call);
      setAi(r.ai);
      await say(r.greeting);
      if (voiceOk && !typing) loop(r.call);
      else {
        setTyping(true);
        setPhase('ready');
      }
    } catch {
      setPhase('error');
    }
  };

  const end = async (c = call) => {
    listening.current?.cancel();
    stopSpeaking();
    releaseMic();
    if (c) await api(`/api/call/${c.id}/end`, { method: 'POST', json: {} }).catch(() => {});
    setPhase('ended');
  };

  const sendTyped = async () => {
    if (!call || !draft.trim()) return;
    const text = draft;
    setDraft('');
    await send(call, text);
    setPhase('ready');
  };

  const orbScale = phase === 'listening' ? 1 + level * 0.35 : phase === 'speaking' ? 1.06 : 1;
  const title = mode === 'debrief' ? 'Debrief' : task ? task.title : 'Quick check-in';
  const status =
    phase === 'ready' && !call ? (mode === 'debrief' ? "Tap to start. I'll run you through what's coming, sir." : 'Tap to start, sir') :
    phase === 'speaking' ? 'Speaking · tap to interrupt' :
    phase === 'listening' ? 'Listening… just talk' :
    phase === 'thinking' ? 'Thinking…' :
    phase === 'ended' ? 'Call ended' :
    phase === 'error' ? "Couldn't start. Check your connection." :
    typing ? 'Type below' : muted ? 'Mic paused' : '';

  const last = lines.slice(-3);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-bg pt-safe pb-safe">
      <div className="flex items-center justify-between px-5 pt-3">
        <button onClick={() => (end(), navigate('/'))} className="press grid h-9 w-9 place-items-center rounded-full text-muted" aria-label="Close">
          <Icon name="x" />
        </button>
        <div className="text-center">
          <div className="text-[12px] uppercase tracking-wide text-muted">{mode === 'debrief' ? 'Debrief' : mode === 'chat' ? 'Talk' : 'Check-in'}</div>
          <div className="max-w-[60vw] truncate text-[15px] font-medium">{title}</div>
        </div>
        <div className="h-9 w-9" />
      </div>

      <div className="flex flex-1 flex-col items-center justify-center px-6">
        <button
          onClick={() => {
            if (!call && phase === 'ready') start();
            else if (phase === 'speaking') {
              stopSpeaking();
            } else if (phase === 'listening') listening.current?.stop();
            else if (call && phase === 'ready' && !typing) {
              setMuted(false);
              mutedRef.current = false;
              loop(call);
            }
          }}
          className="relative grid h-44 w-44 place-items-center"
          aria-label="Talk"
        >
          <motion.div
            className={`absolute inset-0 rounded-full ${phase === 'listening' ? 'bg-cyan/15' : 'bg-fg/[0.06]'}`}
            animate={{ scale: orbScale * (phase === 'thinking' ? 1.08 : 1) }}
            transition={phase === 'thinking' ? { repeat: Infinity, repeatType: 'reverse', duration: 0.8 } : { type: 'spring', stiffness: 300, damping: 18 }}
          />
          <motion.div
            className={`absolute inset-8 rounded-full ${phase === 'listening' ? 'bg-cyan' : phase === 'ended' ? 'bg-line' : 'bg-fg'}`}
            animate={{ scale: phase === 'speaking' ? [1, 1.05, 1] : 1 }}
            transition={phase === 'speaking' ? { repeat: Infinity, duration: 1.1 } : { duration: 0.2 }}
          />
          <Icon name={phase === 'ended' ? 'check' : 'mic'} className="relative h-9 w-9 text-bg" stroke={2} />
        </button>
        <div className="mt-6 h-5 text-[13px] text-muted">{status}</div>

        <div className="mt-6 w-full max-w-md space-y-2 text-center">
          <AnimatePresence initial={false}>
            {last.map((l, i) => (
              <motion.p
                key={lines.length - last.length + i}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: i === last.length - 1 ? 1 : 0.45, y: 0 }}
                className={`text-[15px] leading-snug ${l.role === 'user' ? 'text-muted' : ''}`}
              >
                {l.role === 'user' ? `“${l.text}”` : l.text}
              </motion.p>
            ))}
          </AnimatePresence>
        </div>

        {changes.length > 0 && (
          <div className="mt-6 flex max-w-md flex-wrap justify-center gap-1.5">
            {changes.map((c, i) => (
              <motion.span key={i} initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="rounded-full border border-line bg-card px-3 py-1 text-[12px] text-green">
                ✓ {c.summary}
              </motion.span>
            ))}
          </div>
        )}
        {ai === 'fallback' && call && <p className="mt-4 max-w-xs text-center text-[11px] text-muted">AI model offline: simple commands only.</p>}
      </div>

      {typing && call && phase !== 'ended' && (
        <div className="mx-4 mb-3 flex items-center gap-2 rounded-2xl border border-line bg-card px-4 py-2">
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && sendTyped()}
            placeholder="Type what's going on…"
            className="min-w-0 flex-1 py-1.5 text-[15px]"
          />
          <button onClick={sendTyped} className="press rounded-full bg-fg px-3 py-1.5 text-[13px] text-bg">
            Send
          </button>
        </div>
      )}

      <div className="flex items-center justify-center gap-6 pb-6 pt-2">
        {phase === 'ended' ? (
          <button onClick={() => navigate('/')} className="press rounded-full bg-fg px-8 py-3.5 text-[15px] font-medium text-bg">
            Back to today
          </button>
        ) : (
          <>
            <RoundBtn
              label={muted ? 'Unmute' : 'Mute'}
              icon={muted ? 'micOff' : 'mic'}
              active={muted}
              disabled={!call || !voiceOk}
              onClick={() => {
                const m = !muted;
                setMuted(m);
                mutedRef.current = m;
                if (m) listening.current?.cancel();
                else if (call) loop(call);
              }}
            />
            <button
              onClick={() => (call ? end() : navigate('/'))}
              className="press grid h-16 w-16 place-items-center rounded-full bg-red text-white shadow-lg"
              aria-label="End call"
            >
              <Icon name="phone" className="h-6 w-6 rotate-[135deg]" />
            </button>
            <RoundBtn
              label="Type"
              icon="keyboard"
              active={typing}
              disabled={!call}
              onClick={() => {
                const t = !typing;
                typingRef.current = t;
                setTyping(t);
                if (t) {
                  listening.current?.cancel();
                  stopSpeaking();
                  setPhase('ready');
                } else if (call && voiceOk) setTimeout(() => loop(call), 0);
              }}
            />
          </>
        )}
      </div>
    </div>
  );
}

function RoundBtn({ label, icon, onClick, active, disabled }: { label: string; icon: 'mic' | 'micOff' | 'keyboard'; onClick: () => void; active?: boolean; disabled?: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled} className="press flex flex-col items-center gap-1 disabled:opacity-30" aria-label={label}>
      <span className={`grid h-12 w-12 place-items-center rounded-full ${active ? 'bg-fg text-bg' : 'bg-card border border-line'}`}>
        <Icon name={icon} />
      </span>
      <span className="text-[11px] text-muted">{label}</span>
    </button>
  );
}

export function ConsentScreen({ consentId }: { consentId: string }) {
  const checkin = useStore((s) => s.checkin);
  const settings = useStore((s) => s.settings);
  const [result, setResult] = useState<'asleep' | 'expired' | null>(null);
  const pending = checkin?.pendingConsent;
  const expired = result === 'expired' || (checkin && (!pending || pending.id !== consentId) && result === null);

  const answer = async (a: 'yes' | 'no') => {
    const r = await api<{ ok: boolean; expired?: boolean; taskId?: string | null }>('/api/checkin/consent', { method: 'POST', json: { id: consentId, answer: a } });
    if (r.expired) return setResult('expired');
    if (a === 'yes') navigate(`/call?mode=checkin${r.taskId ? `&task=${r.taskId}` : ''}`, true);
    else setResult('asleep');
  };
  const anyway = () => {
    const t = getState().checkin?.pendingConsent?.taskId;
    navigate(`/call?mode=checkin${t ? `&task=${t}` : ''}`, true);
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-bg px-8 text-center">
      <Icon name="moon" className="h-8 w-8 text-muted" />
      {result === 'asleep' ? (
        <>
          <h1 className="mt-5 text-[26px] font-medium tracking-tight">Very good, sir.</h1>
          <p className="mt-2 text-muted">I shan't disturb you until {settings.wakeTime}. Any reminders will wait till morning. Sleep well.</p>
          <button onClick={() => navigate('/', true)} className="press mt-10 rounded-full border border-line px-6 py-3">
            Close
          </button>
        </>
      ) : expired ? (
        <>
          <h1 className="mt-5 text-[26px] font-medium tracking-tight">I'll leave you be, sir.</h1>
          <p className="mt-2 text-muted">No reply, so I've gone quiet until {settings.wakeTime}. Should you wish to talk after all, I'm here.</p>
          <button onClick={anyway} className="press mt-10 w-full max-w-xs rounded-full bg-fg py-3.5 font-medium text-bg">
            Check in now
          </button>
          <button onClick={() => navigate('/', true)} className="press mt-3 w-full max-w-xs rounded-full py-3.5 text-muted">
            Close
          </button>
        </>
      ) : (
        <>
          <h1 className="mt-5 text-[26px] font-medium tracking-tight">Still up, sir?</h1>
          <p className="mt-2 text-muted">Have you a moment for a brief check-in? Two minutes at most. If not, I'll leave you be until {settings.wakeTime}.</p>
          <button onClick={() => answer('yes')} className="press mt-10 w-full max-w-xs rounded-full bg-fg py-3.5 font-medium text-bg">
            Yes, go ahead
          </button>
          <button onClick={() => answer('no')} className="press mt-3 w-full max-w-xs rounded-full border border-line py-3.5">
            Not tonight
          </button>
        </>
      )}
    </div>
  );
}
