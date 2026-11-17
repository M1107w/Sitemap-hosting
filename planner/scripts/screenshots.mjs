// Drives the running app (default http://localhost:8787) and saves screenshots
// at iPhone and laptop sizes into docs/screens. Creates the login on first run.
import { createRequire } from 'node:module';
const { chromium, devices } = createRequire(import.meta.url)('playwright');
const BASE = process.env.BASE || 'http://localhost:8787';
const OUT = new URL('../docs/screens/', import.meta.url).pathname;
const errors = [];

const browser = await chromium.launch();
async function session(opts, prefix) {
  const ctx = await browser.newContext({ ...opts, colorScheme: 'dark' });
  const page = await ctx.newPage();
  page.on('console', (m) => m.type() === 'error' && errors.push(`${prefix}: ${m.text()}`));
  page.on('pageerror', (e) => errors.push(`${prefix}: ${e.message}`));
  await page.goto(BASE);
  await page.waitForTimeout(700);
  const creds = async () => {
    await page.getByPlaceholder('Username').fill('me');
    await page.getByPlaceholder('Password').fill('demo-password');
  };
  if (await page.getByText('Create your login').isVisible().catch(() => false)) {
    await creds();
    await page.screenshot({ path: `${OUT}${prefix}-0-login.png` });
    await page.getByRole('button', { name: 'Create & open' }).click();
  } else if (await page.getByText('Welcome back').isVisible().catch(() => false)) {
    await creds();
    await page.getByRole('button', { name: 'Log in' }).click();
  }
  await page.getByRole('button', { name: 'More actions' }).waitFor();
  await page.waitForTimeout(900);
  return { ctx, page };
}
const shot = (page, name) => page.screenshot({ path: `${OUT}${name}.png` });

{
  const { ctx, page } = await session({ ...devices['iPhone 14'] }, 'iphone');
  await shot(page, 'iphone-1-today');
  await page.getByText('Gym: push day', { exact: true }).last().click();
  await page.waitForTimeout(600);
  await shot(page, 'iphone-2-expanded');
  await page.getByRole('button', { name: 'Move', exact: true }).first().click();
  await page.waitForTimeout(500);
  await shot(page, 'iphone-3-reschedule');
  await page.getByRole('button', { name: 'Tomorrow', exact: true }).click();
  await page.waitForTimeout(500);
  await shot(page, 'iphone-4-moved-toast');
  await page.getByRole('button', { name: 'More actions' }).click();
  await page.waitForTimeout(600);
  await shot(page, 'iphone-5-plus-menu');
  await page.getByRole('button', { name: 'New task' }).click();
  await page.waitForTimeout(500);
  await page.getByPlaceholder('What needs doing, sir?').fill('Finish slides');
  await shot(page, 'iphone-6-new-task');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(400);
  await page.getByRole('button', { name: 'Month', exact: true }).click();
  await page.waitForTimeout(600);
  await shot(page, 'iphone-7-month');
  await page.goto(`${BASE}/settings`);
  await page.waitForTimeout(600);
  await page.getByText('Reminders', { exact: true }).click();
  await page.waitForTimeout(500);
  await shot(page, 'iphone-8-settings');
  await page.goto(`${BASE}/talk`);
  await page.waitForTimeout(500);
  await shot(page, 'iphone-9-talk');
  await page.goto(`${BASE}/call?mode=chat`);
  await page.waitForTimeout(400);
  await page.getByRole('button', { name: 'Talk', exact: true }).click();
  await page.waitForTimeout(900);
  await page.getByRole('button', { name: 'Type' }).click().catch(() => {});
  const input = page.getByPlaceholder("Type what's going on…");
  if (await input.isVisible().catch(() => false)) {
    await input.fill('add call the bank tomorrow at 10am');
    await page.getByRole('button', { name: 'Send' }).click();
    await page.waitForTimeout(900);
  }
  await shot(page, 'iphone-10-call');
  await ctx.close();
}
{
  const { ctx, page } = await session({ viewport: { width: 1366, height: 820 }, deviceScaleFactor: 1 }, 'laptop');
  await shot(page, 'laptop-1-today');
  await page.getByRole('button', { name: 'Month', exact: true }).click();
  await page.waitForTimeout(600);
  await shot(page, 'laptop-2-month');
  await ctx.close();
}
await browser.close();
if (errors.length) {
  console.log('console errors:\n' + errors.join('\n'));
  process.exitCode = 1;
} else console.log('screenshots ok, no console errors');
