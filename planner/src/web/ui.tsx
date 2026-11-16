import { AnimatePresence, motion } from 'framer-motion';
import type { ReactNode } from 'react';
import type { Priority, Task } from '../shared/types';
import { zoned } from '../shared/time';

export const spring = { type: 'spring', stiffness: 520, damping: 42, mass: 0.8 } as const;

export function today(tz?: string) {
  return zoned(Date.now(), tz || Intl.DateTimeFormat().resolvedOptions().timeZone).date;
}
export function nowMin(tz?: string) {
  return zoned(Date.now(), tz || Intl.DateTimeFormat().resolvedOptions().timeZone).minutes;
}

export function fmtDur(min: number) {
  if (!min) return '0m';
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return h ? (m ? `${h}h ${m}m` : `${h}h`) : `${m}m`;
}

export function dateLabel(date: string, ref: string) {
  const d = new Date(date + 'T12:00:00');
  const r = new Date(ref + 'T12:00:00');
  const diff = Math.round((d.getTime() - r.getTime()) / 86_400_000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  if (diff > 1 && diff < 7) return d.toLocaleDateString(undefined, { weekday: 'long' });
  return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}

export function sortTasks(a: Task, b: Task) {
  return a.priority - b.priority || (a.dueTime ?? '99:99').localeCompare(b.dueTime ?? '99:99') || a.createdAt - b.createdAt;
}

export function remainingMin(t: Task) {
  if (!t.subtasks.length) return t.estimateMin;
  const total = t.subtasks.reduce((a, s) => a + (s.estimateMin || 0), 0);
  if (!total) return Math.round(t.estimateMin * (1 - t.subtasks.filter((s) => s.done).length / t.subtasks.length));
  const left = t.subtasks.filter((s) => !s.done).reduce((a, s) => a + (s.estimateMin || 0), 0);
  return Math.round((left / total) * t.estimateMin);
}

export function PriorityDot({ p, className = '' }: { p: Priority; className?: string }) {
  if (p === 1) return <span className={`inline-block w-2 h-2 rounded-full bg-accent ${className}`} />;
  if (p === 2) return <span className={`inline-block w-2 h-2 rounded-full bg-fg/70 ${className}`} />;
  return <span className={`inline-block w-2 h-2 rounded-full border border-muted ${className}`} />;
}

export const PRIORITY_LABEL: Record<Priority, string> = { 1: 'High', 2: 'Normal', 3: 'Low' };

export function Sheet({ open, onClose, children, title }: { open: boolean; onClose: () => void; children: ReactNode; title?: string }) {
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="fixed inset-0 z-40 bg-black/30"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={onClose}
          />
          <motion.div
            className="fixed inset-x-0 bottom-0 z-50 mx-auto max-w-lg rounded-t-3xl bg-card pb-safe shadow-2xl"
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={spring}
            drag="y"
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.6 }}
            onDragEnd={(_, i) => (i.offset.y > 100 || i.velocity.y > 500) && onClose()}
          >
            <div className="mx-auto mt-2.5 h-1 w-9 rounded-full bg-line" />
            {title && <div className="px-5 pt-3 text-sm font-medium text-muted">{title}</div>}
            <div className="max-h-[80vh] overflow-y-auto px-5 pb-4 pt-3 no-scrollbar">{children}</div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

export function Chip({ children, onClick, active }: { children: ReactNode; onClick?: () => void; active?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={`press rounded-full border px-3.5 py-2 text-sm ${active ? 'border-fg bg-fg text-bg' : 'border-line bg-bg/60 text-fg'}`}
    >
      {children}
    </button>
  );
}

type IconName = 'today' | 'month' | 'plus' | 'talk' | 'settings' | 'check' | 'clock' | 'trash' | 'moon' | 'left' | 'right' | 'edit' | 'mic' | 'micOff' | 'keyboard' | 'phone' | 'x' | 'sun';
const PATHS: Record<IconName, ReactNode> = {
  today: <><rect x="4" y="5" width="16" height="15" rx="3" /><path d="M8 3v4M16 3v4M4 10h16" /></>,
  month: <><rect x="3.5" y="4.5" width="17" height="16" rx="3" /><path d="M3.5 9.5h17M8.5 13h.01M12 13h.01M15.5 13h.01M8.5 16.5h.01M12 16.5h.01" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  talk: <><path d="M12 3a3 3 0 0 1 3 3v5a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3Z" /><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" /></>,
  mic: <><path d="M12 3a3 3 0 0 1 3 3v5a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3Z" /><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" /></>,
  micOff: <><path d="M15 9.5V6a3 3 0 0 0-5.6-1.5M9 9v2a3 3 0 0 0 4.7 2.5M5.5 11a6.5 6.5 0 0 0 10.8 4.8M18.5 11c0 .6-.1 1.2-.2 1.8M12 17.5V21M4 4l16 16" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" /></>,
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  clock: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></>,
  trash: <path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13" />,
  moon: <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" />,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" /></>,
  left: <path d="m14.5 6-6 6 6 6" />,
  right: <path d="m9.5 6 6 6-6 6" />,
  edit: <path d="M4 20h4L19 9l-4-4L4 16v4ZM13.5 6.5l4 4" />,
  keyboard: <><rect x="2.5" y="6" width="19" height="12" rx="2.5" /><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10" /></>,
  phone: <path d="M5 4h3l1.5 4.5-2 1.5a11 11 0 0 0 6.5 6.5l1.5-2L20 16v3a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2Z" />,
  x: <path d="M6 6l12 12M18 6 6 18" />,
};
export function Icon({ name, className = 'w-5 h-5', stroke = 1.8 }: { name: IconName; className?: string; stroke?: number }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      {PATHS[name]}
    </svg>
  );
}
