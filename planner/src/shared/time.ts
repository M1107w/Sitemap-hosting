// Timezone helpers with no dependencies: the server schedules in the user's zone.

export interface ZonedParts {
  date: string; // YYYY-MM-DD
  time: string; // HH:mm
  minutes: number; // minutes since local midnight
  weekday: number; // 0 = Sunday
}

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function fmt(tz: string) {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      weekday: 'short',
      hourCycle: 'h23',
    });
    fmtCache.set(tz, f);
  }
  return f;
}

const WD: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export function zoned(epoch: number, tz: string): ZonedParts {
  const parts: Record<string, string> = {};
  for (const p of fmt(tz).formatToParts(new Date(epoch))) parts[p.type] = p.value;
  const hh = parts.hour === '24' ? '00' : parts.hour;
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${hh}:${parts.minute}`,
    minutes: Number(hh) * 60 + Number(parts.minute),
    weekday: WD[parts.weekday] ?? 0,
  };
}

function offsetMs(epoch: number, tz: string): number {
  const parts: Record<string, string> = {};
  for (const p of fmt(tz).formatToParts(new Date(epoch))) parts[p.type] = p.value;
  const hh = parts.hour === '24' ? 0 : Number(parts.hour);
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, hh, +parts.minute, +parts.second);
  return asUtc - Math.floor(epoch / 1000) * 1000;
}

/** Local date + HH:mm in tz → epoch ms */
export function toEpoch(date: string, time: string, tz: string): number {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  let t = guess - offsetMs(guess, tz);
  t = guess - offsetMs(t, tz); // second pass handles DST edges
  return t;
}

export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}

export function weekdayOf(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function hm(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function toMin(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

export function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}
