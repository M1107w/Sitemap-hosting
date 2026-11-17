// The check-in / debrief brain. A local open-source LLM (via Ollama) gets
// tools that edit the plan. With no model running, a small rule-based
// fallback still handles the common phrases so the app is never dead.
import type { Core } from './core';
import type { CallChange, CallLog, Priority, Task } from '../shared/types';
import { addDays, uid, weekdayOf, zoned } from '../shared/time';
import { dayLoad, nextWake } from './logic';

// ------------------------------------------------------------ provider

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: { function: { name: string; arguments: Record<string, unknown> } }[];
  tool_name?: string;
}
export interface ToolSpec {
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
}
export interface Provider {
  name: string;
  chat(messages: ChatMessage[], tools: ToolSpec[]): Promise<{ content: string; toolCalls: { name: string; args: Record<string, unknown> }[] }>;
}

export class OllamaProvider implements Provider {
  name = 'ollama';
  constructor(
    public url = process.env.OLLAMA_URL || 'http://127.0.0.1:11434',
    public model = process.env.OLLAMA_MODEL || 'qwen3:4b',
  ) {}
  async chat(messages: ChatMessage[], tools: ToolSpec[]) {
    const res = await fetch(`${this.url}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        messages,
        tools,
        stream: false,
        think: false,
        keep_alive: '30m',
        options: { temperature: 0.3, num_ctx: 8192 },
      }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) throw new Error(`ollama ${res.status}: ${await res.text()}`);
    const data = (await res.json()) as { message: ChatMessage };
    const content = (data.message.content || '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();
    const toolCalls = (data.message.tool_calls || []).map((c) => ({
      name: c.function.name,
      args: typeof c.function.arguments === 'string' ? JSON.parse(c.function.arguments as unknown as string) : c.function.arguments,
    }));
    return { content, toolCalls };
  }
}

/** Pre-process the call's prompt while the greeting is spoken, so the first reply is quicker. */
export async function warmUp(p: Provider, system: string) {
  if (!(p instanceof OllamaProvider)) return;
  await fetch(`${p.url}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: p.model,
      messages: [{ role: 'system', content: system }],
      tools: TOOLS,
      stream: false,
      think: false,
      keep_alive: '30m',
      options: { num_predict: 1, num_ctx: 8192 },
    }),
    signal: AbortSignal.timeout(180_000),
  }).catch(() => {});
}

export async function ollamaUp(url = process.env.OLLAMA_URL || 'http://127.0.0.1:11434'): Promise<boolean> {
  try {
    const r = await fetch(`${url}/api/tags`, { signal: AbortSignal.timeout(1500) });
    return r.ok;
  } catch {
    return false;
  }
}

// ------------------------------------------------------------ tools

const taskRef = { type: 'string', description: 'Task id, or a few words of its title' };

export const TOOLS: ToolSpec[] = [
  tool('list_tasks', 'List tasks for a date (default today) or the next N days.', {
    date: { type: 'string', description: 'YYYY-MM-DD, "today", "tomorrow" or a weekday name' },
    days: { type: 'number', description: 'How many days from that date (default 1)' },
  }),
  tool(
    'create_task',
    'Add a new task to the plan.',
    {
      title: { type: 'string' },
      date: { type: 'string', description: 'YYYY-MM-DD, "today", "tomorrow" or weekday name. Default today.' },
      dueTime: { type: 'string', description: 'HH:mm 24h, optional' },
      priority: { type: 'number', description: '1 = high, 2 = normal, 3 = low' },
      estimateMin: { type: 'number', description: 'Estimated minutes' },
      notes: { type: 'string' },
      steps: { type: 'array', items: { type: 'string' }, description: 'Optional sub-steps' },
    },
    ['title'],
  ),
  tool(
    'update_task',
    'Change details of an existing task.',
    {
      task: taskRef,
      title: { type: 'string' },
      priority: { type: 'number' },
      estimateMin: { type: 'number' },
      dueTime: { type: 'string', description: 'HH:mm, or "none" to clear' },
    },
    ['task'],
  ),
  tool('complete_task', 'Mark a task as done.', { task: taskRef }, ['task']),
  tool('discard_task', 'Drop a task entirely (user no longer needs to do it).', { task: taskRef }, ['task']),
  tool(
    'reschedule_task',
    'Move a task to another date and/or time.',
    { task: taskRef, date: { type: 'string', description: 'YYYY-MM-DD, "today", "tomorrow" or weekday' }, dueTime: { type: 'string', description: 'HH:mm or "none"' } },
    ['task'],
  ),
  tool('mark_started', 'Record that the user has started working on a task.', { task: taskRef }, ['task']),
  tool('add_subtask', 'Add a step to a task.', { task: taskRef, title: { type: 'string' }, estimateMin: { type: 'number' } }, ['task', 'title']),
  tool('complete_subtask', 'Tick off a step of a task.', { task: taskRef, step: { type: 'string', description: 'Step id or words of its title' } }, ['task', 'step']),
  tool('add_note', 'Append a note to a task.', { task: taskRef, note: { type: 'string' } }, ['task', 'note']),
  tool('going_to_sleep', 'User is going to sleep / wants no more check-ins tonight.', {}),
];

function tool(name: string, description: string, properties: Record<string, unknown>, required: string[] = []): ToolSpec {
  return { type: 'function', function: { name, description, parameters: { type: 'object', properties, required } } };
}

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

export function resolveDate(input: unknown, today: string): string {
  const s = String(input ?? '').trim().toLowerCase();
  if (!s || s === 'today' || s === 'tonight') return today;
  if (s === 'tomorrow') return addDays(today, 1);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  if (s === 'next week') return addDays(today, 7);
  const wd = WEEKDAYS.findIndex((w) => s.replace(/^next /, '').startsWith(w.slice(0, 3)));
  if (wd >= 0) {
    let diff = (wd - weekdayOf(today) + 7) % 7;
    if (diff === 0 || s.startsWith('next ')) diff += diff === 0 ? 7 : 0;
    return addDays(today, diff);
  }
  const inDays = s.match(/^in (\d+) days?$/);
  if (inDays) return addDays(today, Number(inDays[1]));
  return today;
}

export function resolveTime(input: unknown): string | null | undefined {
  if (input == null || input === '') return undefined;
  const s = String(input).trim().toLowerCase();
  if (s === 'none' || s === 'null') return null;
  const m = s.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
  if (!m) return undefined;
  let h = Number(m[1]);
  const min = Number(m[2] ?? 0);
  if (m[3] === 'pm' && h < 12) h += 12;
  if (m[3] === 'am' && h === 12) h = 0;
  if (h > 23 || min > 59) return undefined;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

function norm(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}

export function findTask(tasks: Task[], ref: unknown): Task | null {
  const r = String(ref ?? '').trim();
  if (!r) return null;
  const byId = tasks.find((t) => t.id === r);
  if (byId) return byId;
  const open = tasks.filter((t) => t.status === 'open');
  const n = norm(r);
  const exact = open.find((t) => norm(t.title) === n);
  if (exact) return exact;
  const words = n.split(' ').filter((w) => w.length > 2);
  let best: { t: Task; score: number } | null = null;
  for (const t of open) {
    const title = norm(t.title);
    let score = title.includes(n) ? 10 : 0;
    for (const w of words) if (title.includes(w)) score += 1;
    if (score > 0 && (!best || score > best.score)) best = { t, score };
  }
  return best?.t ?? null;
}

function clampPriority(p: unknown): Priority | undefined {
  const n = Number(p);
  return n === 1 || n === 2 || n === 3 ? n : undefined;
}

export function execTool(core: Core, name: string, args: Record<string, unknown>): { result: string; change?: CallChange } {
  const s = core.settings();
  const now = core.now();
  const today = zoned(now, s.timezone).date;
  const tasks = core.db.tasks();
  const need = () => {
    const t = findTask(tasks, args.task);
    if (!t) throw new Error(`No open task matches "${args.task}". Call list_tasks to see ids.`);
    return t;
  };
  switch (name) {
    case 'list_tasks': {
      const from = resolveDate(args.date, today);
      const days = Math.min(31, Math.max(1, Number(args.days) || 1));
      const out: string[] = [];
      for (let i = 0; i < days; i++) {
        const d = addDays(from, i);
        const list = tasks.filter((t) => t.date === d && t.status === 'open');
        out.push(`${d}: ${list.length ? list.map(fmtTask).join('; ') : 'nothing'}`);
      }
      return { result: out.join('\n') };
    }
    case 'create_task': {
      const t: Task = {
        id: uid(),
        title: String(args.title || 'Untitled').slice(0, 140),
        notes: String(args.notes || ''),
        priority: clampPriority(args.priority) ?? 2,
        date: resolveDate(args.date, today),
        dueTime: resolveTime(args.dueTime) ?? null,
        estimateMin: Math.max(0, Math.round(Number(args.estimateMin) || 30)),
        status: 'open',
        subtasks: Array.isArray(args.steps)
          ? (args.steps as unknown[]).map((x) => ({ id: uid(), title: String(x), done: false, estimateMin: 0 }))
          : [],
        startedAt: null,
        completedAt: null,
        createdAt: now,
        updatedAt: now,
      };
      core.saveTask(t);
      return { result: `Created ${fmtTask(t)}`, change: { tool: name, summary: `Added “${t.title}” for ${niceDate(t.date, today)}${t.dueTime ? ' at ' + t.dueTime : ''}`, taskId: t.id } };
    }
    case 'update_task': {
      const t = need();
      const patch: Partial<Task> = {};
      if (args.title) patch.title = String(args.title);
      const p = clampPriority(args.priority);
      if (p) patch.priority = p;
      if (args.estimateMin != null && !Number.isNaN(Number(args.estimateMin))) patch.estimateMin = Math.round(Number(args.estimateMin));
      const time = resolveTime(args.dueTime);
      if (time !== undefined) patch.dueTime = time;
      const u = core.touch(t, patch);
      return { result: `Updated ${fmtTask(u)}`, change: { tool: name, summary: `Updated “${u.title}”`, taskId: t.id } };
    }
    case 'complete_task': {
      const t = need();
      core.touch(t, { status: 'done', completedAt: now });
      return { result: `Done: ${t.title}`, change: { tool: name, summary: `Completed “${t.title}”`, taskId: t.id } };
    }
    case 'discard_task': {
      const t = need();
      core.touch(t, { status: 'discarded' });
      return { result: `Discarded: ${t.title}`, change: { tool: name, summary: `Dropped “${t.title}”`, taskId: t.id } };
    }
    case 'reschedule_task': {
      const t = need();
      const date = args.date ? resolveDate(args.date, today) : t.date;
      const time = resolveTime(args.dueTime);
      const u = core.touch(t, { date, dueTime: time === undefined ? t.dueTime : time });
      return {
        result: `Moved ${fmtTask(u)}`,
        change: { tool: name, summary: `Moved “${t.title}” to ${niceDate(date, today)}${u.dueTime ? ' at ' + u.dueTime : ''}`, taskId: t.id },
      };
    }
    case 'mark_started': {
      const t = need();
      core.touch(t, { startedAt: t.startedAt ?? now });
      return { result: `Started: ${t.title}`, change: { tool: name, summary: `Marked “${t.title}” as started`, taskId: t.id } };
    }
    case 'add_subtask': {
      const t = need();
      const st = { id: uid(), title: String(args.title), done: false, estimateMin: Math.round(Number(args.estimateMin) || 0) };
      core.touch(t, { subtasks: [...t.subtasks, st] });
      return { result: `Added step to ${t.title}`, change: { tool: name, summary: `Added step “${st.title}” to “${t.title}”`, taskId: t.id } };
    }
    case 'complete_subtask': {
      const t = need();
      const ref = norm(String(args.step ?? ''));
      const st = t.subtasks.find((x) => x.id === args.step) ?? t.subtasks.find((x) => norm(x.title).includes(ref) || ref.includes(norm(x.title)));
      if (!st) throw new Error(`No step matches "${args.step}" on ${t.title}`);
      core.touch(t, { subtasks: t.subtasks.map((x) => (x.id === st.id ? { ...x, done: true } : x)) });
      return { result: `Ticked ${st.title}`, change: { tool: name, summary: `Ticked “${st.title}”`, taskId: t.id } };
    }
    case 'add_note': {
      const t = need();
      const note = String(args.note ?? '').trim();
      core.touch(t, { notes: t.notes ? `${t.notes}\n${note}` : note });
      return { result: `Noted on ${t.title}`, change: { tool: name, summary: `Note on “${t.title}”: ${note.slice(0, 60)}`, taskId: t.id } };
    }
    case 'going_to_sleep': {
      core.setCheckin({ ...core.checkin(), quietUntil: nextWake(now, s), pendingConsent: null });
      return { result: 'Quiet until morning', change: { tool: name, summary: `No more check-ins until ${s.wakeTime}` } };
    }
  }
  throw new Error(`Unknown tool ${name}`);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** Human date for spoken replies: today / tomorrow / Friday / 3 Dec */
export function niceDate(date: string, today: string): string {
  if (date === today) return 'today';
  if (date === addDays(today, 1)) return 'tomorrow';
  const diff = Math.round((Date.parse(date) - Date.parse(today)) / 86_400_000);
  if (diff > 1 && diff < 7) return WEEKDAYS[weekdayOf(date)][0].toUpperCase() + WEEKDAYS[weekdayOf(date)].slice(1);
  return `${Number(date.slice(8))} ${MONTHS[Number(date.slice(5, 7)) - 1]}`;
}

function fmtTask(t: Task) {
  const done = t.subtasks.filter((s) => s.done).length;
  return `[${t.id}] "${t.title}" P${t.priority} ${t.date}${t.dueTime ? ' ' + t.dueTime : ''} ~${t.estimateMin}m${
    t.subtasks.length ? ` steps ${done}/${t.subtasks.length}` : ''
  }${t.startedAt ? ' (started)' : ''}`;
}

// ------------------------------------------------------------ conversation

export function greeting(core: Core, call: CallLog): string {
  const s = core.settings();
  const today = zoned(core.now(), s.timezone).date;
  const tasks = core.db.tasks();
  if (call.kind === 'checkin') {
    const t = call.taskId ? core.db.task(call.taskId) : null;
    if (t) return `Quick check-in on “${t.title}”, sir. How's it going?`;
    return 'Quick check-in, sir. What are you working on right now?';
  }
  if (call.kind === 'debrief') {
    const tomorrow = addDays(today, 1);
    const load = dayLoad(tasks, tomorrow);
    const top = tasks
      .filter((t) => t.date === tomorrow && t.status === 'open')
      .sort((a, b) => a.priority - b.priority || (a.dueTime ?? '99').localeCompare(b.dueTime ?? '99'))[0];
    let week = 0;
    let weekMin = 0;
    for (let i = 2; i <= 7; i++) {
      const l = dayLoad(tasks, addDays(today, i));
      week += l.count;
      weekMin += l.minutes;
    }
    const leftToday = tasks.filter((t) => t.date <= today && t.status === 'open').length;
    const parts = ['Debrief time, sir.'];
    if (leftToday) parts.push(`You've still got ${leftToday} open from today.`);
    parts.push(
      load.count
        ? `Tomorrow: ${load.count} task${load.count > 1 ? 's' : ''}, about ${hours(load.minutes)}. Top one is “${top?.title}”${top?.dueTime ? ` at ${top.dueTime}` : ''}.`
        : 'Tomorrow is clear so far.',
    );
    parts.push(week ? `Rest of the week: ${week} more, about ${hours(weekMin)}.` : 'Rest of the week is light.');
    parts.push("Anything you'd like moved, added or dropped?");
    return parts.join(' ');
  }
  return 'At your service, sir. What would you like to change?';
}

function hours(min: number) {
  if (min < 60) return `${min} minutes`;
  const h = Math.round((min / 60) * 2) / 2;
  return `${h} hour${h === 1 ? '' : 's'}`;
}

export function systemPrompt(core: Core, call: CallLog): string {
  const s = core.settings();
  const now = core.now();
  const z = zoned(now, s.timezone);
  const tasks = core.db.tasks();
  const upcoming: string[] = [];
  const overdue = tasks.filter((t) => t.status === 'open' && t.date < z.date);
  if (overdue.length) upcoming.push(`Overdue: ${overdue.map(fmtTask).join('; ')}`);
  for (let i = 0; i < 7; i++) {
    const d = addDays(z.date, i);
    const list = tasks.filter((t) => t.date === d && t.status === 'open');
    if (list.length || i < 2) upcoming.push(`${d} (${WEEKDAYS[weekdayOf(d)]}): ${list.length ? list.map(fmtTask).join('; ') : 'nothing'}`);
  }
  const focus = call.taskId ? core.db.task(call.taskId) : null;
  return [
    `You are the user's planning assistant on a short voice call, like a calm, capable butler. Address the user as "sir" now and then (not every sentence). Brief and a bit dry.`,
    'Rules:',
    '- Listen to what they are doing and UPDATE THE PLAN WITH TOOLS without asking permission for obvious changes (done → complete_task, "later/tomorrow" → reschedule_task, new thing → create_task, started → mark_started).',
    '- Use task ids from the list above. Dates as YYYY-MM-DD, times as HH:mm 24h.',
    "- If they are now doing something unplanned, add it as a task and move what it displaces.",
    '- Replies are spoken aloud: 1–2 short sentences, no lists, no markdown, no emojis.',
    '- After changes, say briefly what you changed. If they say bye / that\'s all, wish them well in one line.',
    '',
    `Call type: ${call.kind === 'debrief' ? 'debrief (go through what is coming up)' : 'check-in (how is it going?)'}`,
    `Now: ${WEEKDAYS[z.weekday]} ${z.date} ${z.time} (${s.timezone}).`,
    focus ? `This check-in is about: ${fmtTask(focus)}` : '',
    'Their plan (the conversation may have changed it since; tool results are the truth):',
    upcoming.join('\n'),
  ]
    .filter(Boolean)
    .join('\n');
}

export interface TurnResult {
  reply: string;
  changes: CallChange[];
  provider: string;
}

export async function runTurn(core: Core, call: CallLog, userText: string, provider: Provider | null): Promise<TurnResult> {
  if (!provider) return fallbackTurn(core, call, userText);
  if (!call.system) call.system = systemPrompt(core, call);
  const messages: ChatMessage[] = [{ role: 'system', content: call.system }];
  for (const m of call.transcript.slice(-12)) messages.push({ role: m.role, content: m.text });
  messages.push({ role: 'user', content: userText });
  const changes: CallChange[] = [];
  for (let i = 0; i < 6; i++) {
    const r = await provider.chat(messages, TOOLS);
    if (!r.toolCalls.length) {
      return { reply: r.content || (changes.length ? `Done. ${changes.map((c) => c.summary).join('. ')}.` : 'Got it.'), changes, provider: provider.name };
    }
    messages.push({ role: 'assistant', content: r.content, tool_calls: r.toolCalls.map((c) => ({ function: { name: c.name, arguments: c.args } })) });
    for (const c of r.toolCalls) {
      let result: string;
      try {
        const out = execTool(core, c.name, c.args || {});
        result = out.result;
        if (out.change) changes.push(out.change);
      } catch (e) {
        result = `Error: ${(e as Error).message}`;
      }
      messages.push({ role: 'tool', content: result, tool_name: c.name });
    }
  }
  return { reply: changes.length ? `Done. ${changes.map((c) => c.summary).join('. ')}.` : 'Sorry, I lost track there. Say that again?', changes, provider: provider.name };
}

// ------------------------------------------------------------ no-model fallback

/** Understands a handful of plain phrases so voice still works with no LLM. */
export function fallbackTurn(core: Core, call: CallLog, text: string): TurnResult {
  const t = text.trim();
  const lower = t.toLowerCase();
  const changes: CallChange[] = [];
  const focus = call.taskId ? core.db.task(call.taskId) : null;
  const run = (name: string, args: Record<string, unknown>) => {
    try {
      const out = execTool(core, name, args);
      if (out.change) changes.push(out.change);
      return true;
    } catch {
      return false;
    }
  };
  const ref = (s: string | undefined) => (s && s.trim() && !/^(it|this|that)$/i.test(s.trim()) ? s.trim() : focus?.id);
  let m: RegExpMatchArray | null;

  if (/\b(going to (sleep|bed)|goodnight|good night|no more (calls|check))/i.test(lower)) run('going_to_sleep', {});
  else if ((m = lower.match(/^(?:add|new task|remind me to)\s+(.+?)(?:\s+(today|tomorrow|on \w+day|\w+day))?(?:\s+at\s+([\d:apm ]+))?$/i)))
    run('create_task', { title: capital(m[1]), date: m[2]?.replace(/^on /, ''), dueTime: m[3] });
  else if ((m = lower.match(/(?:move|push|reschedule|do)\s+(.*?)\s*(?:to|till|until|for)?\s+(today|tonight|tomorrow|next week|(?:next )?\w+day)(?:\s+at\s+([\d:apm ]+))?$/i)))
    run('reschedule_task', { task: ref(m[1]), date: m[2], dueTime: m[3] });
  else if ((m = lower.match(/(?:finished|done with|completed|did)\s+(.*)$/i)) || /^(done|finished|all done|it'?s done)\b/.test(lower))
    run('complete_task', { task: ref(m?.[1]?.replace(/^(the|my)\s+/, '')) });
  else if ((m = lower.match(/(?:drop|cancel|delete|scrap|forget)\s+(.*)$/i))) run('discard_task', { task: ref(m[1]) });
  else if (/\b(started|working on it|on it|doing it now)\b/.test(lower) && focus) run('mark_started', { task: focus.id });
  else if (focus && t.length > 3) run('add_note', { task: focus.id, note: t });

  const reply = changes.length
    ? `${changes.map((c) => c.summary).join('. ')}. Anything else, sir?`
    : "Noted, sir. (The AI model isn't running, so I only understand simple things like: done with X, move X to tomorrow, add X.)";
  return { reply, changes, provider: 'fallback' };
}

function capital(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
