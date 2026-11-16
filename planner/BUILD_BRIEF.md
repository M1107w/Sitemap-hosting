# Planner app: build brief

Written 16 Nov 2026. Read this when you wake up, answer the 5 questions at the bottom, then paste the prompt in section 1.

---

## 1. The build prompt (paste this to start)

> Build "Today", a personal task planner, inside `planner/`. Follow `planner/BUILD_BRIEF.md` exactly.
>
> **Product**
> 1. **Today view (the home screen).** Shows today's tasks sorted by priority (P1 to P3), then by due time. Each card shows the title, priority, due time and estimated duration. The header shows the total estimated time and "free time left today".
> 2. **Task expand.** Tapping a card expands it in place, with a shared-element animation (about 250ms, spring), into its subtasks/steps (checkable), notes (markdown) and a time estimate per step. Subtask progress rolls up into the card.
> 3. **Actions on every task and subtask:** Complete, Discard (with undo toast), Reschedule (quick chips: +1h, tonight, tomorrow, next week, or pick a date). Swipe right completes, swipe left reschedules.
> 4. **Month view.** A standard 7-column month grid. Each day cell shows its top-priority task title, plus a "+N" count and a small load bar (estimated hours). Tapping a day opens that day's Today view.
> 5. **Design.** Barebones and minimal: one neutral palette, one accent colour for P1, system font, lots of whitespace, light and dark mode. 60fps: transform/opacity animations only, optimistic UI, no spinners on local actions. Mobile first, works on laptop.
> 6. **Reminders work like an alarm.** Each task gets a push notification at a lead time (default 10 min before), another at the due time, then a snooze repeat (every 10 min, escalating to every 5 min after 30 min). They keep coming until the task is completed, rescheduled or discarded. A daily **debrief** notification goes out at a fixed time (default 21:30) with tomorrow's tasks and the week/month ahead.
> 7. **AI phone calls (phase 2, built behind a feature flag with mocks until keys exist).**
>    - *Debrief calls* only at scheduled times you set in settings.
>    - *Check-in calls* triggered by rules: a P1 task is overdue by X min with no app activity, or a P1 task is due soon and hasn't been started. Respect quiet hours and a max number of calls per day.
>    - The call is a two-way conversation. Claude has tools (`list_tasks`, `create_task`, `update_task`, `complete_task`, `reschedule_task`, `add_subtask`, `add_note`) and edits the plan live while I talk. Changes appear in the app in real time, and the app shows a log of what each call changed.
>
> **Stack:** see section 3 of the brief. Write tests for the scheduler/snooze logic and the call tool handlers. Commit in small steps to the working branch and push. When done, write `planner/MORNING_REPORT.md` covering: what works, how to run it, screenshots (Playwright, phone and laptop sizes), and exactly what I need to do to switch on push and phone calls.

---

## 2. How it fits together

```
 Phone (installed PWA)  ─┐                       ┌─> Web Push (reminders, snooze, debrief)
 Laptop (browser/PWA)   ─┼──>  API server ───────┤
                         │    (Node + SQLite)    └─> Twilio voice ⇄ Claude (calls that edit tasks)
                         └── realtime sync (SSE) ◄── call edits show up live
```

- **One app for phone and laptop:** a PWA (Progressive Web App). You "Add to Home Screen" and it behaves like a native app: full screen, icon, offline, push notifications. No App Store needed.
- **A small server is required.** Reminders have to fire while the app is closed, and the AI on the phone call has to read and edit your tasks. Both need something running 24/7. The app stays local-first (instant, works offline) and syncs to the server.

---

## 3. What I'll install

**Frontend (the app)**
| Package | Why |
|---|---|
| Vite + React + TypeScript | Fast, standard app foundation |
| Tailwind CSS | Minimal styling with no bloat |
| Framer Motion | The silky expand, swipe and transition animations |
| Dexie (IndexedDB) | Local storage on the device, so everything is instant and works offline |
| date-fns | Date maths for the calendar, recurrence and reminders |
| vite-plugin-pwa (Workbox) | Makes it installable, adds offline support and handles push |
| Playwright *(already on this machine)* | Screenshots and end-to-end tests |

**Backend (the always-on part)**
| Package | Why |
|---|---|
| Node 20+ with Hono (or Fastify) | Small, fast API server |
| SQLite (better-sqlite3) + Drizzle ORM | One-file database, no setup |
| web-push | Sends notifications to phone/laptop (VAPID keys get generated locally for free) |
| A scheduler loop (node-cron style) | Fires reminder, snooze and debrief pushes and decides when check-in calls happen |
| Twilio SDK + ConversationRelay | Places the phone call and turns speech to text and text to speech |
| @anthropic-ai/sdk | Claude runs the conversation and uses tools to edit your tasks |
| Vitest | Tests |

**Nothing gets installed on your phone.** You open a URL and add it to your home screen.

---

## 4. Build phases

| Phase | What you get | Needs you? |
|---|---|---|
| **1. Core app** (tonight) | Today view, expand animation, subtasks/notes, complete/discard/reschedule, month grid, offline storage, dark mode, sample data | No |
| **2. Server + sync** (tonight) | API, database, phone and laptop stay in sync | No |
| **3. Reminders** (tonight, code + tests) | Alarm-style reminders, snooze sequence, nightly debrief | Push only works once it's hosted on HTTPS (see section 5) |
| **4. AI calls** (tonight, code + mocks) | Call logic, Claude tools, trigger rules, quiet hours, a "simulate call" text box in the app to test it without a phone | Live calls need Twilio and an Anthropic key |
| **5. Go live** (with you, about 20 min) | Hosted URL, real push on your phone, real calls | Yes |

---

## 5. What only you can do (when you're up)

1. **Hosting (needed for push and calls).** Push notifications and Twilio both need a public HTTPS address. The easiest options are Railway, Fly.io or Render: one small always-on instance, roughly $5/month.
2. **Twilio account:** buy one phone number (about $1 to $2/month) and pay per minute of calls. Rough total: a few dollars a month at normal use.
3. **Anthropic API key** for the call brain. At a few short calls a day it should cost only cents to a few dollars a month.
4. **iPhone only:** push works only after you "Add to Home Screen" (iOS 16.4+), and iOS doesn't show action buttons (Done/Snooze) on web notifications. Tapping a notification opens the task instead. Android and laptop get the buttons.

*(The prices above are ballpark. Check each provider's current pricing.)*

---

## 6. Five questions (my default is used if you don't answer)

1. **iPhone or Android?** Default: build for both, and test the iOS limits.
2. **Where should the code live?** This repo is your sitemap repo. Default: build in `planner/` on this branch. A fresh empty GitHub repo (e.g. `planner`) that you add to the session would be cleaner.
3. **Debrief time?** Default: nightly call/notification at 21:30, morning push at 07:30.
4. **Check-in call limits?** Default: max 3 per day, none before 08:00 or after 22:00, and only for P1 tasks.
5. **Login?** Default: single user with a passcode, no accounts.

---

## 7. You don't need your laptop for this

This session runs in the cloud. Reply **"go"** (plus any answers to section 6) and I'll start building here while you sleep. Nothing needs to stay switched on at your end. You'll find `planner/MORNING_REPORT.md` waiting when you wake up.
