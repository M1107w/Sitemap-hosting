# Planner app: build brief (v2, free and open-source)

Updated 16 Nov 2026 with your answers: iPhone, calendar-based debriefs, check-ins for any task with a consent prompt, small login, and $0 to run.

---

## 1. The build prompt

> Build "Today", a personal task planner, inside `planner/`. Follow `planner/BUILD_BRIEF.md` exactly. Use only free, open-source software. No paid APIs.
>
> **Product**
> 1. **Today view (the home screen).** Shows today's tasks sorted by priority (P1 to P3), then by due time. Each card shows the title, priority, due time and estimated duration. The header shows the total estimated time and "free time left today".
> 2. **Task expand.** Tapping a card expands it in place, with a shared-element animation (about 250ms, spring), into its subtasks/steps (checkable), notes (markdown) and a time estimate per step. Subtask progress rolls up into the card.
> 3. **Actions on every task and subtask:** Complete, Discard (with undo toast), Reschedule (quick chips: +1h, tonight, tomorrow, next week, or pick a date). Swipe right completes, swipe left reschedules.
> 4. **Month view.** A standard 7-column month grid. Each day cell shows its top-priority task, plus a "+N" count and a load bar (estimated hours). Tapping a day opens that day's view. Scheduled debriefs show as a small marker on their day.
> 5. **Design.** Barebones and minimal: neutral palette, one accent colour for P1, system font, light and dark mode. 60fps: transform/opacity animations only, optimistic UI. Built iPhone-first (safe areas, standalone PWA), also works on laptop.
> 6. **Reminders work like an alarm.** Each task gets a push notification at a lead time (default 10 min before), another at the due time, then a snooze repeat (every 10 min, every 5 min after 30 min). They keep coming until the task is completed, rescheduled or discarded.
> 7. **Debriefs depend on the calendar.** They're separate from task check-ins and happen a few times a week, not daily. The planner picks the slots from the calendar: one at the start of the week (Sunday evening), plus the evening before any heavy day (estimated load above a threshold) or before a P1 deadline. They're capped at 2 to 4 a week. Each one is shown in advance on the calendar so it never catches me off guard, and I can move or cancel it.
> 8. **Check-ins depend on the tasks.** Any priority can trigger one. They're weighted by priority, how close the task is to its due time, how overdue it is and how long the app has been idle. P1 tasks get checked on more often, P3 tasks rarely. They're allowed late at night, but after the wind-down time (default 21:30) every check-in first sends a push: **"yo, u up for a quick check-up?"**. Tapping it opens the check-in screen with **Yes, let's go** and **Not tonight**. Tapping Not tonight, or not answering within 10 min, means no check-ins until my wake time (default 08:00). There's also an "I'm going to sleep" button in the app that does the same thing.
> 9. **Voice check-ins and debriefs** happen in an in-app voice screen. It's a full-screen "call": I talk, it talks back, and a local open-source LLM uses tools (`list_tasks`, `create_task`, `update_task`, `complete_task`, `reschedule_task`, `add_subtask`, `add_note`) to edit the plan live while I talk. Changes appear instantly, with a log of what each call changed. A text-chat fallback does the same thing by typing.
> 10. **Login.** Single user, username and password (argon2 hash), with a long-lived session cookie.
>
> **Stack:** see section 3. The backend ships as one `docker compose up` that runs on any machine (laptop, free cloud VM, Raspberry Pi). Write tests for the reminder/snooze logic, the debrief slot picker, the check-in scoring and consent gate, and the LLM tool handlers. Commit in small steps and push. When done, write `planner/MORNING_REPORT.md` covering: what works, screenshots (Playwright, iPhone and laptop sizes), how to run it, and the step-by-step free hosting setup.

---

## 2. The $0 version and its trade-offs

| You wanted | Free version | Trade-off |
|---|---|---|
| Real phone calls | A push notification that opens a full-screen voice check-in inside the app | Your phone doesn't *ring* like a normal call. That needs a paid phone number (Twilio) or a paid Apple developer account. Your new "u up for a check-up?" flow fits this well anyway. |
| Claude as the brain | An open-source model run locally with **Ollama** (Qwen3 or Llama class, with tool calling) | Not as sharp as Claude, but fine for "move this, add that, how's it going". |
| Notifications | Web Push to iPhone (free from Apple) | Needs "Add to Home Screen" (iOS 16.4+). No buttons on the notification itself (iOS limit), so you tap it and pick inside the app. Can't break through Do Not Disturb/Focus unless you allow the app in that Focus. |
| Hosting | Your own machine or a free cloud VM | Something has to be on 24/7 for reminders to fire (see section 4). |

**Safer:** your tasks, voice and AI all stay on hardware you control. Nothing goes to a third-party AI company.

---

## 3. What I'll install (all free and open source)

**App (frontend)**
| Package | Why |
|---|---|
| Vite + React + TypeScript | App foundation |
| Tailwind CSS | Minimal styling |
| Framer Motion | Smooth expand, swipe and transition animations |
| Dexie (IndexedDB) | On-device storage, so it's instant and works offline |
| date-fns | Calendar and reminder date maths |
| vite-plugin-pwa (Workbox) | Installable on iPhone, offline support, push |

**Server (backend)**
| Package | Why |
|---|---|
| Node 20 + Hono | Small, fast API |
| SQLite + Drizzle ORM | One-file database |
| web-push | Sends notifications to the iPhone (self-generated VAPID keys) |
| Scheduler loop | Reminders, snooze, debrief slots, check-in scoring |
| Ollama + an open model (e.g. Qwen3 4B/8B) | The AI brain, with tool calling to edit tasks |
| whisper.cpp (or faster-whisper) | Speech to text from your voice |
| Piper (or Kokoro) TTS | Natural voice replies. The iPhone's built-in voice is the instant fallback. |
| Caddy | Automatic free HTTPS (Let's Encrypt), which iPhone push requires |
| Docker Compose | One command starts everything |
| Vitest + Playwright | Tests and screenshots |

---

## 4. Where it runs (pick one, all $0)

1. **Oracle Cloud "Always Free" VM (recommended).** An ARM VM that's free indefinitely and is big enough for a small LLM, always on, with a public IP. Add a free DuckDNS subdomain and Caddy for HTTPS. Catch: signup asks for a card for identity checks (Always Free resources aren't charged), and free capacity is sometimes "out of stock" in a region. Retrying or picking another region usually works.
2. **Your laptop with Cloudflare Tunnel (free).** Zero signup hassle, but reminders and check-ins **stop whenever the laptop sleeps**. Good for testing, bad as the real thing.
3. **A spare old laptop or Raspberry Pi at home with Cloudflare Tunnel.** Always on, but the LLM is slow on a Pi.

The code is identical for all three, so you can start on your laptop and move to option 1 later.

---

## 5. What you'll do once it's built (about 20 to 30 min, no payment)

1. Pick a host from section 4 and run `docker compose up -d` (MORNING_REPORT will have copy-paste steps).
2. Open the URL on your iPhone in Safari, then Share > **Add to Home Screen**.
3. Open it from the home screen, log in, and allow notifications.
4. Optional: allow the app in your Focus modes so check-ins get through.
