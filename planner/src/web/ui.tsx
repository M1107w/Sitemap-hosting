import { AnimatePresence, motion } from 'framer-motion';
import type { ReactNode } from 'react';
import type { Priority, Task } from '../shared/types';
import { zoned } from '../shared/time';

/** One spring for everything that moves: quick, no wobble. Transform-only animations stay at full refresh rate. */
export const spring = { type: 'spring', stiffness: 520, damping: 44, mass: 0.7 } as const;
export const softSpring = { type: 'spring', stiffness: 380, damping: 38, mass: 0.8 } as const;

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

export function greetingFor(minutes: number) {
  if (minutes < 5 * 60) return 'Up late, sir.';
  if (minutes < 12 * 60) return 'Good morning, sir.';
  if (minutes < 17 * 60) return 'Good afternoon, sir.';
  return 'Good evening, sir.';
}

export const PRIORITY_LABEL: Record<Priority, string> = { 1: 'High', 2: 'Normal', 3: 'Low' };

// ------------------------------------------------------------ icons

type IconName =
  | 'today' | 'month' | 'plus' | 'talk' | 'settings' | 'check' | 'clock' | 'trash' | 'moon' | 'left' | 'right' | 'edit'
  | 'mic' | 'micOff' | 'keyboard' | 'phone' | 'x' | 'home' | 'forward' | 'brief' | 'bell' | 'chevron' | 'spark'
  | 'slides' | 'dumbbell' | 'mail' | 'book' | 'cart' | 'code' | 'music' | 'car' | 'food' | 'heart' | 'plane' | 'money'
  | 'broom' | 'pill' | 'pen' | 'users' | 'target' | 'list';

const PATHS: Record<IconName, ReactNode> = {
  today: <><rect x="4" y="5" width="16" height="15" rx="3" /><path d="M8 3v4M16 3v4M4 10h16" /></>,
  month: <><rect x="4" y="5" width="16" height="15" rx="3" /><path d="M8 3v4M16 3v4M4 10h16" /></>,
  home: <path d="M4 11 12 4l8 7v8a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1z" />,
  plus: <path d="M12 5v14M5 12h14" />,
  talk: <><path d="M12 3a3 3 0 0 1 3 3v5a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3Z" /><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" /></>,
  mic: <><path d="M12 3a3 3 0 0 1 3 3v5a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3Z" /><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" /></>,
  micOff: <><path d="M15 9.5V6a3 3 0 0 0-5.6-1.5M9 9v2a3 3 0 0 0 4.7 2.5M5.5 11a6.5 6.5 0 0 0 10.8 4.8M18.5 11c0 .6-.1 1.2-.2 1.8M12 17.5V21M4 4l16 16" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1" /></>,
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  clock: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></>,
  trash: <path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13" />,
  moon: <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" />,
  left: <path d="m14.5 6-6 6 6 6" />,
  right: <path d="m9.5 6 6 6-6 6" />,
  chevron: <path d="m7 10 5 5 5-5" />,
  edit: <path d="M4 20h4L19 9l-4-4L4 16v4ZM13.5 6.5l4 4" />,
  keyboard: <><rect x="2.5" y="6" width="19" height="12" rx="2.5" /><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10" /></>,
  phone: <path d="M5 4h3l1.5 4.5-2 1.5a11 11 0 0 0 6.5 6.5l1.5-2L20 16v3a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2Z" />,
  x: <path d="M6 6l12 12M18 6 6 18" />,
  forward: <path d="M5 12h13M13 6l6 6-6 6" />,
  brief: <><rect x="4" y="4" width="16" height="16" rx="3" /><path d="M8 9h8M8 13h8M8 17h5" /></>,
  bell: <><path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z" /><path d="M10 20.5a2 2 0 0 0 4 0" /></>,
  spark: <path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6" />,
  slides: <><rect x="3" y="4" width="18" height="13" rx="3" /><path d="M12 17v3M8 21h8M7 13l3-3 2 2 4-4" /></>,
  dumbbell: <path d="M6 8v8M3 10v4M18 8v8M21 10v4M6 12h12" />,
  mail: <><rect x="3" y="5" width="18" height="14" rx="3" /><path d="m4 7 8 6 8-6" /></>,
  book: <path d="M5 4.5h9a3 3 0 0 1 3 3v12H8a3 3 0 0 1-3-3zM5 16.5a3 3 0 0 1 3-3h9" />,
  cart: <><path d="M3 4h2.5l2 11h10l2-8H6.5" /><circle cx="9" cy="19" r="1.4" /><circle cx="17" cy="19" r="1.4" /></>,
  code: <path d="m8 7-5 5 5 5M16 7l5 5-5 5M13.5 5l-3 14" />,
  music: <><path d="M9 18V6l11-2v12" /><circle cx="6.5" cy="18" r="2.5" /><circle cx="17.5" cy="16" r="2.5" /></>,
  car: <><path d="M4 15v-3l2-5h12l2 5v3a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1ZM4 12h16" /><circle cx="7.5" cy="16.5" r="1.5" /><circle cx="16.5" cy="16.5" r="1.5" /></>,
  food: <path d="M7 3v8a2 2 0 0 0 4 0V3M9 11v10M16 3c-1.7 0-3 2-3 5s1.3 4 3 4v9" />,
  heart: <path d="M12 20s-7.5-4.5-7.5-10A4.3 4.3 0 0 1 12 7.5 4.3 4.3 0 0 1 19.5 10c0 5.5-7.5 10-7.5 10Z" />,
  plane: <path d="M10.5 13.5 3 11l1.5-1.5 7 1L16 6a2 2 0 0 1 3 3l-4.5 4.5 1 7L14 22l-2.5-7.5L8 18v2.5L6.5 22l-1-3.5L2 17.5 3.5 16H6z" />,
  money: <><rect x="3" y="6" width="18" height="12" rx="2.5" /><circle cx="12" cy="12" r="2.5" /><path d="M6.5 9.5v.01M17.5 14.5v.01" /></>,
  broom: <path d="M14 4 9 13M6 13h7l1 7H5zM8.5 20v-3M11.5 20v-3" />,
  pill: <><rect x="3" y="8.5" width="18" height="7" rx="3.5" transform="rotate(-35 12 12)" /><path d="m9.5 8.5 5 7" /></>,
  pen: <path d="M4 20h4L19 9l-4-4L4 16v4Z" />,
  users: <><circle cx="9" cy="8" r="3" /><path d="M3.5 19a5.5 5.5 0 0 1 11 0M15.5 5.5a3 3 0 0 1 0 5M17 13.5a5.5 5.5 0 0 1 3.5 5.5" /></>,
  target: <><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="4.5" /><circle cx="12" cy="12" r=".6" /></>,
  list: <path d="M9 7h11M9 12h11M9 17h11M4.5 7h.01M4.5 12h.01M4.5 17h.01" />,
};

export function Icon({ name, className = 'w-5 h-5', stroke = 1.8 }: { name: IconName; className?: string; stroke?: number }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      {PATHS[name]}
    </svg>
  );
}

// ------------------------------------------------------------ task icon + colour, picked from the title

const COLORS = ['cyan', 'purple', 'yellow', 'green', 'orange'] as const;
export type Tint = (typeof COLORS)[number] | 'red';
const RULES: [RegExp, IconName, Tint][] = [
  [/\b(gym|workout|run|lift|train|push day|pull day|leg day|exercise|swim|yoga|cardio|football|boxing)/i, 'dumbbell', 'green'],
  [/\b(email|emails|inbox|reply|mail)/i, 'mail', 'yellow'],
  [/\b(call|phone|ring|facetime)/i, 'phone', 'cyan'],
  [/\b(deck|slides|pitch|presentation|present)/i, 'slides', 'red'],
  [/\b(read|study|revise|revision|homework|exam|lecture|essay|book|learn)/i, 'book', 'purple'],
  [/\b(shop|buy|groceries|order|pick up)/i, 'cart', 'orange'],
  [/\b(code|deploy|bug|build|app|website|dev|fix)/i, 'code', 'cyan'],
  [/\b(music|guitar|piano|practice|beat|song|studio)/i, 'music', 'purple'],
  [/\b(drive|car|mot|garage|petrol|uber)/i, 'car', 'orange'],
  [/\b(cook|dinner|lunch|breakfast|meal|food|eat)/i, 'food', 'orange'],
  [/\b(doctor|dentist|gp|hospital|meds|pill|pharmacy)/i, 'pill', 'red'],
  [/\b(flight|travel|trip|airport|pack)/i, 'plane', 'cyan'],
  [/\b(pay|bank|rent|bill|invoice|budget|tax|money)/i, 'money', 'green'],
  [/\b(clean|tidy|laundry|wash|hoover|dishes)/i, 'broom', 'yellow'],
  [/\b(write|draft|blog|journal|notes)/i, 'pen', 'purple'],
  [/\b(meet|meeting|catch up|interview|date|mum|dad|friends?)/i, 'users', 'cyan'],
  [/\b(plan|review|debrief|organis|organiz)/i, 'list', 'purple'],
  [/\b(welcome)/i, 'spark', 'green'],
];
export function taskStyle(t: Pick<Task, 'title' | 'priority' | 'id'>): { icon: IconName; tint: Tint } {
  for (const [re, icon, tint] of RULES) if (re.test(t.title)) return { icon, tint };
  let h = 0;
  for (const c of t.id) h = (h * 31 + c.charCodeAt(0)) | 0;
  return { icon: t.priority === 1 ? 'target' : 'check', tint: t.priority === 1 ? 'red' : COLORS[Math.abs(h) % COLORS.length] };
}

/** Tailwind needs whole class names written out. */
export const TINT: Record<Tint, { text: string; bg: string; bar: string }> = {
  red: { text: 'text-red', bg: 'bg-red/[0.13]', bar: 'bg-red' },
  green: { text: 'text-green', bg: 'bg-green/[0.12]', bar: 'bg-green' },
  cyan: { text: 'text-cyan', bg: 'bg-cyan/[0.12]', bar: 'bg-cyan' },
  purple: { text: 'text-purple', bg: 'bg-purple/[0.14]', bar: 'bg-purple' },
  yellow: { text: 'text-yellow', bg: 'bg-yellow/[0.12]', bar: 'bg-yellow' },
  orange: { text: 'text-orange', bg: 'bg-orange/[0.12]', bar: 'bg-orange' },
};

export function TaskIcon({ task, size = 'h-10 w-10' }: { task: Pick<Task, 'title' | 'priority' | 'id'>; size?: string }) {
  const { icon, tint } = taskStyle(task);
  return (
    <span className={`grid shrink-0 place-items-center rounded-[13px] ${size} ${TINT[tint].bg} ${TINT[tint].text}`}>
      <Icon name={icon} className="h-[20px] w-[20px]" stroke={1.9} />
    </span>
  );
}

export function PriorityDot({ p, className = '' }: { p: Priority; className?: string }) {
  if (p === 1) return <span className={`inline-block h-1.5 w-1.5 rounded-full bg-red ${className}`} />;
  if (p === 2) return <span className={`inline-block h-1.5 w-1.5 rounded-full bg-muted ${className}`} />;
  return <span className={`inline-block h-1.5 w-1.5 rounded-full border border-faint ${className}`} />;
}

// ------------------------------------------------------------ building blocks

/** Square-block progress bar: blocks light up one by one. */
export function BlockBar({ value, blocks = 20, className = '' }: { value: number; blocks?: number; className?: string }) {
  const lit = Math.round(Math.max(0, Math.min(1, value)) * blocks);
  return (
    <div className={`flex gap-[3px] ${className}`}>
      {Array.from({ length: blocks }, (_, i) => (
        <div key={i} className="relative h-3 flex-1 overflow-hidden rounded-[2px] bg-line">
          <motion.div
            className="absolute inset-0 origin-left bg-accent"
            initial={false}
            animate={{ scaleX: i < lit ? 1 : 0, opacity: i < lit ? 1 : 0 }}
            transition={{ duration: 0.16, ease: [0.2, 0.8, 0.2, 1], delay: (i < lit ? i : blocks - i) * 0.025 }}
          />
        </div>
      ))}
    </div>
  );
}

export function Sheet({ open, onClose, children, title }: { open: boolean; onClose: () => void; children: ReactNode; title?: string }) {
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="fixed inset-0 z-40 bg-black/60"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
          />
          <motion.div
            className="fixed inset-x-0 bottom-0 z-50 mx-auto max-w-lg rounded-t-[28px] border-t border-line bg-card pb-safe"
            style={{ willChange: 'transform' }}
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={softSpring}
            drag="y"
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.6 }}
            onDragEnd={(_, i) => (i.offset.y > 100 || i.velocity.y > 500) && onClose()}
          >
            <div className="mx-auto mt-2.5 h-1 w-10 rounded-full bg-line" />
            {title && <div className="px-5 pt-3 text-[17px] font-medium">{title}</div>}
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
      className={`press rounded-full border px-3.5 py-2 text-[13px] ${active ? 'border-fg bg-fg text-bg' : 'border-line bg-raised text-fg'}`}
    >
      {children}
    </button>
  );
}
