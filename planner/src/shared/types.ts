export type Priority = 1 | 2 | 3;
export type TaskStatus = 'open' | 'done' | 'discarded';

export interface Subtask {
  id: string;
  title: string;
  done: boolean;
  estimateMin: number;
}

export interface Task {
  id: string;
  title: string;
  notes: string;
  priority: Priority;
  /** Local calendar date, YYYY-MM-DD */
  date: string;
  /** Local due time HH:mm, or null for "any time today" */
  dueTime: string | null;
  estimateMin: number;
  status: TaskStatus;
  subtasks: Subtask[];
  startedAt: number | null;
  completedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export type DebriefStatus = 'scheduled' | 'done' | 'cancelled' | 'missed';

export interface Debrief {
  id: string;
  date: string; // YYYY-MM-DD
  time: string; // HH:mm
  reason: string;
  status: DebriefStatus;
  /** true once the user moved/cancelled it manually: the planner won't touch it */
  pinned: boolean;
  updatedAt: number;
}

export interface Settings {
  timezone: string;
  reminderLeadMin: number;
  snoozeEveryMin: number;
  snoozeFastAfterMin: number;
  snoozeFastEveryMin: number;
  windDown: string; // HH:mm: after this, check-ins ask consent first
  wakeTime: string; // HH:mm: quiet mode lifts here
  consentTimeoutMin: number;
  checkinsPerDayMax: number;
  checkinMinGapMin: number;
  debriefTime: string; // HH:mm
  debriefWeekday: number; // 0 = Sunday
  debriefsPerWeekMax: number;
  heavyDayMin: number; // estimated minutes that make a day "heavy"
  voiceName: string;
}

export const DEFAULT_SETTINGS: Settings = {
  timezone: 'Europe/London',
  reminderLeadMin: 10,
  snoozeEveryMin: 10,
  snoozeFastAfterMin: 30,
  snoozeFastEveryMin: 5,
  windDown: '21:30',
  wakeTime: '08:00',
  consentTimeoutMin: 10,
  checkinsPerDayMax: 4,
  checkinMinGapMin: 75,
  debriefTime: '20:30',
  debriefWeekday: 0,
  debriefsPerWeekMax: 3,
  heavyDayMin: 300,
  voiceName: '',
};

export interface CallChange {
  tool: string;
  summary: string;
  taskId?: string;
}

export interface CallLog {
  id: string;
  kind: 'checkin' | 'debrief' | 'chat';
  taskId: string | null;
  startedAt: number;
  endedAt: number | null;
  transcript: { role: 'user' | 'assistant'; text: string }[];
  changes: CallChange[];
}

export interface CheckinState {
  /** quiet until this epoch ms (no check-ins); 0 = not quiet */
  quietUntil: number;
  /** a pending "u up?" prompt */
  pendingConsent: { id: string; taskId: string | null; expiresAt: number } | null;
  lastCheckinAt: number;
  checkinsToday: { date: string; count: number };
  lastActivityAt: number;
}

export type ServerEvent =
  | { type: 'task'; task: Task }
  | { type: 'debriefs'; debriefs: Debrief[] }
  | { type: 'settings'; settings: Settings }
  | { type: 'checkin'; state: CheckinState }
  | { type: 'call'; call: CallLog };
