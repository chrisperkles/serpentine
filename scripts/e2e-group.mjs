// Group ride end to end: a host opens a room on Gaisberg, a guest joins with the code, the host starts it, both
// ride on the keyboard simulator, then a third rider joins late and starts next to the group.
// PORT=5299 node scripts/e2e-group.mjs [ws://127.0.0.1:8787 for a local relay]
import { chromium } from 'playwright';

const port = process.env.PORT ?? 5199;
const relay = process.argv[2] ? `&relay=${encodeURIComponent(process.argv[2])}` : '';
const base = `http://localhost:${port}/`;
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const step = (s) => console.log(`· ${s}`);
const errors = [];

async function rider(name, kit, weight) {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  await ctx.addInitScript(
    ([name, kit, weight]) => {
      localStorage.setItem('serpentine.welcomed', 'true');
      localStorage.setItem('serpentine.settings', JSON.stringify({ name, kit, weight, leadIn: false }));
    },
    [name, kit, weight],
  );
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !m.text().includes('404')) errors.push(`${name}: ${m.text()}`);
  });
  return page;
}

const state = (page) =>
  page.evaluate(() => {
    const s = window.__session;
    if (!s) return null;
    const st = s.state;
    return {
      status: st.status, s: Math.round(st.s), progress: Math.round(s.progress), speed: +st.speed.toFixed(1), drafting: st.drafting,
      riders: st.riders.map((r) => ({ name: r.name, gap: Math.round(r.gap), s: Math.round(r.s), wkg: +r.wkg.toFixed(1), stale: r.stale })),
    };
  });

const host = await rider('Chris', '#e8442e', 75);
await host.goto(`${base}?ride=gaisberg&group=new&sim=1&watts=270&nobt=1${relay}`);
await host.waitForSelector('.group-code', { timeout: 180000 });
const code = (await host.locator('.group-code').textContent()).slice(0, 5);
step(`host in the waiting room, code ${code}`);

const guest = await rider('Veronika', '#2fb36d', 56);
await guest.goto(`${base}?group=${code}&sim=1&watts=190&nobt=1${relay}`);
await guest.waitForSelector('.group-start', { timeout: 180000 });
await guest.waitForTimeout(3000);
step(`guest lobby: ${await guest.locator('.group-lobby').textContent()}`);
step(`host lobby: ${await host.locator('.group-lobby').textContent()}`);
await host.screenshot({ path: 'shots/group-host-lobby.png' });
await guest.screenshot({ path: 'shots/group-guest-lobby.png' });

// the guest's Space does nothing in the waiting room; the host's starts the countdown for both
await guest.keyboard.press('Space');
await host.keyboard.press('Space');
await guest.waitForSelector('.countdown', { timeout: 5000 });
step(`countdown on the guest: ${await guest.locator('.countdown').textContent()}`);
await guest.screenshot({ path: 'shots/group-countdown.png' });
await host.waitForFunction(() => window.__session?.state.status === 'riding', null, { timeout: 15000 });
await guest.waitForFunction(() => window.__session?.state.status === 'riding', null, { timeout: 5000 });
step('both riding');
await host.waitForTimeout(20000);
const [hs, gs] = await Promise.all([state(host), state(guest)]);
step(`host: ${JSON.stringify(hs)}`);
step(`guest: ${JSON.stringify(gs)}`);
const truth = hs.progress - gs.progress;
step(`real gap ${truth} m; host sees guest at ${-hs.riders[0].gap}, guest sees host at ${gs.riders[0].gap}`);
if (Math.abs(-hs.riders[0].gap - truth) > 3 || Math.abs(gs.riders[0].gap - truth) > 3) errors.push('gaps off by more than 3 m');
await host.screenshot({ path: 'shots/group-host-riding.png' });
await guest.screenshot({ path: 'shots/group-guest-riding.png' });

// a third rider, late: starts next to the host when pedalling
const late = await rider('Max', '#2f7de1', 80);
await late.goto(`${base}?group=${code}&sim=1&watts=270&nobt=1${relay}`);
await late.waitForSelector('.group-start', { timeout: 180000 });
// the simulator pedals at once: read the screen before it starts
step(`late rider sees: ${await late.locator('.group-start').textContent()}`);
await late.screenshot({ path: 'shots/group-late.png' });
await late.waitForFunction(() => window.__session?.state.status === 'riding', null, { timeout: 15000 });
await late.waitForTimeout(8000);
const ls = await state(late);
step(`late rider riding: ${JSON.stringify(ls)}`);
await late.screenshot({ path: 'shots/group-late-riding.png' });
const chris = ls.riders.find((r) => r.name === 'Chris');
if (!chris || Math.abs(chris.gap) > 60) errors.push(`late rider not next to the host: ${JSON.stringify(chris)}`);

// the host leaves: the next rider leads
await host.close();
await guest.waitForTimeout(3000);
step(`guest after the host left: ${JSON.stringify(await state(guest))}`);
const g = await state(guest);
if (g.riders.some((r) => r.name === 'Chris')) errors.push('host still shown after leaving');
const gl = await state(late);
if (!gl.riders.some((r) => r.name === 'Veronika')) errors.push('late rider does not see the guest');

console.log(errors.length ? `ERRORS:\n${errors.join('\n')}` : 'no errors');
await browser.close();
