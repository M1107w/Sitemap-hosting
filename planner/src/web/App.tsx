import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import { activity, api, dismissToast, loadAll, setAuth, useStore } from './store';
import { navigate, useLocation } from './router';
import { TodayView } from './TodayView';
import { MonthView } from './MonthView';
import { CallScreen, ConsentScreen } from './CallScreen';
import { SettingsView, TalkView } from './SettingsView';
import { Icon } from './ui';

export function App() {
  const auth = useStore((s) => s.auth);
  const { path, query } = useLocation();

  useEffect(() => {
    const h = () => activity();
    window.addEventListener('pointerdown', h, { passive: true });
    document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && (activity(), auth === 'ok' && loadAll().catch(() => {})));
    navigator.serviceWorker?.addEventListener('message', (e) => e.data?.type === 'navigate' && navigate(e.data.url));
    return () => window.removeEventListener('pointerdown', h);
  }, [auth]);

  if (auth === 'unknown') return <div className="h-full bg-bg" />;
  if (auth !== 'ok') return <Login mode={auth} />;

  let screen: React.ReactNode;
  let tab: string = path;
  if (path === '/call') {
    const mode = (query.get('mode') as 'checkin' | 'debrief' | 'chat') || 'chat';
    return <CallScreen key={path + query} mode={mode} taskId={query.get('task')} debriefId={query.get('debrief')} />;
  }
  if (path === '/checkin' && query.get('consent')) return <ConsentScreen consentId={query.get('consent')!} />;
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
        <motion.main key={path} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.16 }}>
          {screen}
        </motion.main>
      </AnimatePresence>
      <TabBar tab={tab} />
      <Toast />
    </div>
  );
}

function TabBar({ tab }: { tab: string }) {
  const items = [
    { to: '/', icon: 'today', label: 'Today' },
    { to: '/month', icon: 'month', label: 'Month' },
    { to: '/talk', icon: 'talk', label: 'Talk' },
    { to: '/settings', icon: 'settings', label: 'Settings' },
  ] as const;
  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-bg/85 pb-safe backdrop-blur-xl">
      <div className="mx-auto flex max-w-lg">
        {items.map((it) => (
          <button key={it.to} onClick={() => navigate(it.to)} className={`flex flex-1 flex-col items-center gap-0.5 pb-1 pt-2 text-[10.5px] transition-colors ${tab === it.to ? 'text-fg' : 'text-muted'}`}>
            <Icon name={it.icon} className="h-[22px] w-[22px]" stroke={tab === it.to ? 2.1 : 1.7} />
            {it.label}
          </button>
        ))}
      </div>
    </nav>
  );
}

function Toast() {
  const t = useStore((s) => s.toast);
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+84px)] z-40 flex justify-center px-4">
      <AnimatePresence>
        {t && (
          <motion.div
            key={t.id}
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ type: 'spring', stiffness: 500, damping: 35 }}
            className="pointer-events-auto flex items-center gap-4 rounded-full bg-fg py-2.5 pl-5 pr-2 text-[14px] text-bg shadow-xl"
          >
            <span className="max-w-[60vw] truncate">{t.text}</span>
            {t.undo && (
              <button
                onClick={() => {
                  t.undo!();
                  dismissToast();
                }}
                className="press rounded-full bg-bg/15 px-3 py-1 font-medium"
              >
                Undo
              </button>
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
      <motion.form initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} onSubmit={submit} className="w-full max-w-xs">
        <div className="mb-8 flex items-center gap-3">
          <img src="/icon.svg" alt="" className="h-10 w-10 rounded-xl" />
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Today</h1>
            <p className="text-[13px] text-muted">{mode === 'setup' ? 'Create your login' : 'Welcome back'}</p>
          </div>
        </div>
        <input autoFocus autoCapitalize="none" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Username" className="mb-2 w-full rounded-xl border border-line bg-card px-4 py-3" />
        <input type="password" autoComplete={mode === 'setup' ? 'new-password' : 'current-password'} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" className="w-full rounded-xl border border-line bg-card px-4 py-3" />
        {mode === 'setup' && (
          <label className="mt-3 flex items-center gap-2 text-[13px] text-muted">
            <input type="checkbox" checked={seed} onChange={(e) => setSeed(e.target.checked)} /> Add a few example tasks
          </label>
        )}
        {err && <p className="mt-3 text-[13px] text-accent">{err}</p>}
        <button disabled={busy || !username || !password} className="press mt-5 w-full rounded-xl bg-fg py-3 font-medium text-bg disabled:opacity-40">
          {mode === 'setup' ? 'Create & open' : 'Log in'}
        </button>
      </motion.form>
    </div>
  );
}
