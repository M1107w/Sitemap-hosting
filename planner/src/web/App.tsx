import { AnimatePresence, motion, MotionConfig } from 'framer-motion';
import { useEffect, useState } from 'react';
import { activity, api, closeEditor, dismissToast, getState, loadAll, moveOverdueToTomorrow, openEditor, setAuth, setSleep, useStore } from './store';
import { navigate, useLocation } from './router';
import { TodayView } from './TodayView';
import { MonthView } from './MonthView';
import { CallScreen, ConsentScreen } from './CallScreen';
import { SettingsView, TalkView } from './SettingsView';
import { TaskEditor } from './sheets';
import { addDays } from '../shared/time';
import { Icon, nowMin, spring, today } from './ui';

export function App() {
  return (
    // "user": respects iOS Reduce Motion; everything else animates with transforms only.
    <MotionConfig reducedMotion="user">
      <Shell />
    </MotionConfig>
  );
}

function Shell() {
  const auth = useStore((s) => s.auth);
  const editor = useStore((s) => s.editor);
  const { path, query } = useLocation();

  useEffect(() => {
    const h = () => activity();
    const vis = () => {
      if (document.visibilityState !== 'visible') return;
      activity();
      if (getState().auth === 'ok') loadAll().catch(() => {});
    };
    const msg = (e: MessageEvent) => e.data?.type === 'navigate' && navigate(e.data.url);
    window.addEventListener('pointerdown', h, { passive: true });
    document.addEventListener('visibilitychange', vis);
    navigator.serviceWorker?.addEventListener('message', msg);
    return () => {
      window.removeEventListener('pointerdown', h);
      document.removeEventListener('visibilitychange', vis);
      navigator.serviceWorker?.removeEventListener('message', msg);
    };
  }, []);

  if (auth === 'unknown') return <div className="h-full bg-bg" />;
  if (auth !== 'ok') return <Login mode={auth} />;

  if (path === '/call') {
    const mode = (query.get('mode') as 'checkin' | 'debrief' | 'chat') || 'chat';
    return <CallScreen key={path + query} mode={mode} taskId={query.get('task')} debriefId={query.get('debrief')} />;
  }
  if (path === '/checkin' && query.get('consent')) return <ConsentScreen consentId={query.get('consent')!} />;

  let screen: React.ReactNode;
  let tab = path;
  if (path.startsWith('/day/')) {
    screen = <TodayView key={path} date={path.slice(5)} />;
    tab = '/month';
  } else if (path === '/month') screen = <MonthView />;
  else if (path === '/talk') screen = <TalkView />;
  else if (path === '/settings') screen = <SettingsView />;
  else {
    screen = <TodayView key="today" focusTask={query.get('task')} />;
    tab = '/';
  }

  return (
    <div className="min-h-full bg-bg">
      <AnimatePresence mode="wait" initial={false}>
        <motion.main
          key={path}
          className="gpu"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.14, ease: 'easeOut' }}
        >
          {screen}
        </motion.main>
      </AnimatePresence>
      <TabBar tab={tab} />
      <Toast />
      <TaskEditor open={!!editor} task={editor?.task ?? null} defaultDate={editor?.date ?? today()} onClose={closeEditor} />
    </div>
  );
}

// ------------------------------------------------------------ expandable tab bar

type IconName = Parameters<typeof Icon>[0]['name'];

function TabBar({ tab }: { tab: string }) {
  const [open, setOpen] = useState(false);
  const checkin = useStore((s) => s.checkin);
  const tz = useStore((s) => s.settings.timezone);
  const quiet = !!checkin && checkin.quietUntil > Date.now();
  useEffect(() => setOpen(false), [tab]);

  const tabs: { to: string; icon: IconName; label: string }[] = [
    { to: '/', icon: 'home', label: 'Today' },
    { to: '/month', icon: 'month', label: 'Month' },
    { to: '/talk', icon: 'mic', label: 'Talk' },
    { to: '/settings', icon: 'settings', label: 'Settings' },
  ];
  const t = today(tz);
  const actions: { icon: IconName; label: string; tint: string; run: () => void }[] = [
    { icon: 'plus', label: 'New task', tint: 'text-green bg-green/[0.12]', run: () => openEditor(t) },
    { icon: 'mic', label: 'Check-in', tint: 'text-cyan bg-cyan/[0.12]', run: () => navigate('/call?mode=chat') },
    { icon: 'brief', label: 'Debrief now', tint: 'text-purple bg-purple/[0.14]', run: () => navigate('/call?mode=debrief') },
    { icon: 'moon', label: quiet ? 'Wake up' : 'Going to sleep', tint: 'text-yellow bg-yellow/[0.12]', run: () => setSleep(!quiet) },
    { icon: 'forward', label: 'Overdue → tomorrow', tint: 'text-red bg-red/[0.13]', run: () => moveOverdueToTomorrow(t, addDays(t, 1), nowMin(tz)) },
    { icon: 'settings', label: 'Settings', tint: 'text-fg bg-fg/[0.08]', run: () => navigate('/settings') },
  ];

  return (
    <>
      <AnimatePresence>
        {open && (
          <motion.div
            key="scrim"
            className="gpu fixed inset-0 z-40 bg-black/60"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={() => setOpen(false)}
          />
        )}
      </AnimatePresence>
      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex justify-center px-5 pb-[max(env(safe-area-inset-bottom),14px)]">
        <div className="relative w-full max-w-md">
          {/* The bar. It never changes size, so there's nothing to stretch or redraw. */}
          <motion.nav
            className="gpu pointer-events-auto mx-auto flex w-max items-center gap-1 rounded-[26px] border border-line bg-raised p-1.5 shadow-[0_12px_40px_rgba(0,0,0,0.55)]"
            initial={false}
            animate={{ opacity: open ? 0 : 1, scale: open ? 0.96 : 1 }}
            transition={{ duration: 0.16, ease: [0.2, 0.8, 0.2, 1] }}
            style={{ pointerEvents: open ? 'none' : 'auto' }}
          >
            {tabs.map((it) => (
              <button
                key={it.to}
                aria-label={it.label}
                onClick={() => navigate(it.to)}
                className={`relative grid h-11 w-12 place-items-center rounded-[18px] transition-colors duration-200 ${tab === it.to ? 'bg-fg/[0.08] text-fg' : 'text-faint'}`}
              >
                <Icon name={it.icon} className="h-[22px] w-[22px]" stroke={tab === it.to ? 2 : 1.8} />
              </button>
            ))}
            <button aria-label="More actions" onClick={() => setOpen(true)} className="press ml-1 grid h-11 w-12 place-items-center rounded-[18px] bg-fg text-bg">
              <Icon name="plus" className="h-[22px] w-[22px]" stroke={2.3} />
            </button>
          </motion.nav>

          {/* The panel: one solid piece that grows out of the + button. Scale + fade only. */}
          <AnimatePresence>
            {open && (
              <motion.div
                key="panel"
                className="gpu pointer-events-auto absolute inset-x-0 bottom-0 rounded-[30px] border border-line bg-raised px-3 pb-3 pt-4 shadow-[0_12px_40px_rgba(0,0,0,0.55)]"
                style={{ transformOrigin: '85% 100%' }}
                initial={{ opacity: 0, scale: 0.86, y: 8 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.9, y: 6 }}
                transition={{ type: 'spring', stiffness: 560, damping: 40, mass: 0.7 }}
              >
                <div className="grid grid-cols-3 gap-x-2 gap-y-4">
                  {actions.map((a) => (
                    <button
                      key={a.label}
                      onClick={() => {
                        setOpen(false);
                        a.run();
                      }}
                      className="press flex flex-col items-center gap-2 text-center text-[12px] leading-tight text-fg/85"
                    >
                      <span className={`grid h-12 w-12 place-items-center rounded-2xl ${a.tint}`}>
                        <Icon name={a.icon} className="h-[22px] w-[22px]" stroke={1.9} />
                      </span>
                      {a.label}
                    </button>
                  ))}
                </div>
                <div className="mt-3 flex justify-end">
                  <button aria-label="Close" onClick={() => setOpen(false)} className="press grid h-11 w-11 place-items-center rounded-full bg-fg/[0.08]">
                    <Icon name="x" className="h-5 w-5" />
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </>
  );
}

function Toast() {
  const t = useStore((s) => s.toast);
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+86px)] z-40 flex justify-center px-4">
      <AnimatePresence>
        {t && (
          <motion.div
            key={t.id}
            initial={{ opacity: 0, y: 12, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={spring}
            className="pointer-events-auto flex items-center gap-4 rounded-full bg-fg py-2.5 pl-5 pr-2 text-[14px] text-bg shadow-xl"
          >
            <span className="max-w-[60vw] truncate">{t.text}</span>
            {t.undo ? (
              <button
                onClick={() => {
                  t.undo!();
                  dismissToast();
                }}
                className="press rounded-full bg-bg/10 px-3 py-1 font-medium"
              >
                Undo
              </button>
            ) : (
              <span className="w-2" />
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Login({ mode }: { mode: 'setup' | 'login' }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [seed, setSeed] = useState(true);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try {
      await api(mode === 'setup' ? '/api/auth/setup' : '/api/auth/login', {
        method: 'POST',
        json: { username, password, seed, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone },
      });
      await loadAll();
      setAuth('ok');
    } catch (x) {
      setErr((x as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex min-h-full items-center justify-center bg-bg px-6">
      <motion.form initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={spring} onSubmit={submit} className="w-full max-w-xs">
        <div className="mb-8 flex items-center gap-3">
          <img src="/icon.svg" alt="" className="h-11 w-11 rounded-xl" />
          <div>
            <h1 className="text-[22px] font-medium tracking-tight">SleepyGates</h1>
            <p className="text-[13px] text-muted">{mode === 'setup' ? 'Create your login, sir' : 'Welcome back, sir'}</p>
          </div>
        </div>
        <input autoFocus autoCapitalize="none" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Username" className="mb-2 w-full rounded-2xl border border-line bg-card px-4 py-3.5" />
        <input type="password" autoComplete={mode === 'setup' ? 'new-password' : 'current-password'} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" className="w-full rounded-2xl border border-line bg-card px-4 py-3.5" />
        {mode === 'setup' && (
          <label className="mt-3 flex items-center gap-2 text-[13px] text-muted">
            <input type="checkbox" checked={seed} onChange={(e) => setSeed(e.target.checked)} /> Add a few example tasks
          </label>
        )}
        {err && <p className="mt-3 text-[13px] text-red">{err}</p>}
        <button disabled={busy || !username || !password} className="press mt-5 w-full rounded-2xl bg-fg py-3.5 font-medium text-bg disabled:opacity-40">
          {mode === 'setup' ? 'Create & open' : 'Log in'}
        </button>
      </motion.form>
    </div>
  );
}
