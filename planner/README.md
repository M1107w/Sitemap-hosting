# Today

A personal planner PWA for iPhone and laptop. It shows today's tasks in priority order, opens each one into steps and notes, has a monthly calendar, sends alarm-style reminders, plans debriefs from your calendar, and runs voice check-ins with a local open-source AI that edits your plan while you talk.

**Start here: [MORNING_REPORT.md](MORNING_REPORT.md)** (what's built, plus setup on a free Oracle VM).

## Stack (all free / open source)
- **App:** Vite + React + TypeScript, Tailwind, Framer Motion, Dexie (offline cache), Workbox (installable PWA + push)
- **Server:** Node + Hono, SQLite (better-sqlite3), web-push (VAPID), argon2 login
- **AI:** Ollama (`qwen3:4b` by default) with tool calling, whisper.cpp (speech → text), Piper (text → speech). The app falls back to the device's own speech and a rule-based parser if any of these are down.
- **Hosting:** Docker Compose + Caddy (automatic HTTPS)

## Layout
```
src/shared/      types + timezone helpers
src/server/      API (app.ts), scheduler (reminders/debriefs/check-ins), pure logic (logic.ts), AI tools (assistant.ts)
src/web/         the PWA: TodayView, TaskCard, MonthView, CallScreen, SettingsView, service worker
deploy/          Caddyfile, whisper + piper images, Oracle setup script, backup script
docs/screens/    automatic screenshots
```

## Commands
```bash
npm install
npm run dev          # API on :8787 + app on :5173 (proxied)
npm test             # 27 unit/integration tests
npm run build        # PWA → dist/, server → dist-server/
npm start            # serve the built app + API on :8787
npm run screenshots  # needs the app running on :8787
```

Environment variables (server): `PORT`, `DATA_DIR`, `OLLAMA_URL`, `OLLAMA_MODEL`, `WHISPER_URL`, `TTS_URL`, `COOKIE_SECURE`, `VAPID_SUBJECT`, and optionally `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY` (otherwise generated once and stored in the DB).
