import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import fs from 'node:fs';
import path from 'node:path';
import { openDb } from './db';
import { Core } from './core';
import { createApp } from './app';
import { startScheduler } from './scheduler';

const DATA_DIR = process.env.DATA_DIR || path.resolve('data');
const PORT = Number(process.env.PORT || 8787);
const STATIC_DIR = process.env.STATIC_DIR || path.resolve('dist');

const db = openDb(path.join(DATA_DIR, 'planner.db'));
const core = new Core(db);
const app = createApp(core);

if (fs.existsSync(STATIC_DIR)) {
  app.use('/*', serveStatic({ root: path.relative(process.cwd(), STATIC_DIR) || '.' }));
  const index = fs.readFileSync(path.join(STATIC_DIR, 'index.html'), 'utf8');
  app.get('*', (c) => (c.req.path.startsWith('/api/') ? c.json({ error: 'not found' }, 404) : c.html(index)));
}

startScheduler(core);
serve({ fetch: app.fetch, port: PORT, hostname: process.env.HOST || '0.0.0.0' }, (info) => {
  core.log(`planner api on http://localhost:${info.port}  (data: ${DATA_DIR})`);
});
