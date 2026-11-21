// Races, ready marks, invite links, ride-ons, results and keep-together, end to end on the keyboard simulator.
// PORT=5299 node scripts/e2e-race.mjs [ws://127.0.0.1:8787 for a local relay]
import { chromium } from 'playwright';

const port = process.env.PORT ?? 5199;
const relay = process.argv[2] ? `&relay=${encodeURIComponent(process.argv[2])}` : '';
const base = `http://localhost:${port}/`;
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const step = (s) => console.log(`· ${s}`);
const errors = [];
const check = (ok, what) => (ok ? step(`ok: ${what}`) : errors.push(what));

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
const progress = (page) => page.evaluate(() => window.__session?.progress ?? null);
const riding = (page) => page.waitForFunction(() => window.__session?.state.status === 'riding', null, { timeout: 20000 });

// --- a race near the top of Gaisberg ---------------------------------------------------------------------
const host = await rider('Chris', '#e8442e', 75);
await host.goto(`${base}?ride=gaisberg&group=new&race=1&sim=1&watts=320&nobt=1${relay}`);
await host.waitForSelector('.group-code', { timeout: 180000 });
const code = (await host.locator('.group-code').textContent()).slice(0, 5);
step(`race room ${code}: ${await host.locator('.group-start .o-sub').first().textContent()}`);

// the guest comes in through an invite link (?join= stands in for serpentine://join/<CODE>)
const guest = await rider('Veronika', '#2fb36d', 56);
await guest.goto(`${base}?join=${code}&sim=1&watts=150&nobt=1${relay}`);
await guest.waitForSelector('.group-start', { timeout: 180000 });
check(true, 'invite link opened Ride together and joined by itself');
await guest.keyboard.press('Space');
await host.waitForFunction(() => document.querySelector('.ready-count')?.textContent?.startsWith('2 of 2'), null, { timeout: 8000 }).catch(() => undefined);
const readyLine = await host.locator('.ready-count').textContent();
check(readyLine.startsWith('2 of 2'), `host sees the guest ready ("${readyLine}")`);
await host.screenshot({ path: 'shots/race-lobby.png' });

// both start 150 m before the finish, so the test needn't climb 9.8 km
for (const p of [host, guest]) await p.evaluate(() => window.__session.placeAt(window.__session.route.length - 150));
await host.keyboard.press('Space');
await Promise.all([riding(host), riding(guest)]);
step('race on');
await host.waitForTimeout(6000);
await host.screenshot({ path: 'shots/race-riding.png' });
check(((await host.locator('.gp-head').textContent()) ?? '').includes('1st'), `host leads ("${await host.locator('.gp-head').textContent()}")`);

// a ride-on from the guest
await guest.keyboard.press('r');
await host.waitForSelector('.rideon', { timeout: 5000 }).catch(() => undefined);
const ro = await host.locator('.rideon').first().textContent().catch(() => '');
check(ro.includes('Veronika'), `host got the ride-on ("${ro}")`);
await host.screenshot({ path: 'shots/race-rideon.png' });

await host.waitForSelector('.banner .b-main:has-text("won")', { timeout: 90000 }).catch(() => undefined);
const hb = await host.locator('.banner').textContent().catch(() => '');
check(hb.includes('You won the race'), `host's banner ("${hb}")`);
await host.screenshot({ path: 'shots/race-won.png' });
await guest.waitForSelector('.banner .b-main:has-text("finished")', { timeout: 120000 }).catch(() => undefined);
const gb = await guest.locator('.banner').textContent().catch(() => '');
check(gb.includes('2nd') && gb.includes('behind Chris'), `guest's banner ("${gb}")`);

// the host ends the ride: the results on the summary
await host.keyboard.press('Escape');
await host.getByRole('button', { name: 'Save and finish' }).click();
await host.waitForSelector('.s-group', { timeout: 15000 });
await host.waitForTimeout(1500);
const rows = await host.locator('.s-group tbody tr').allTextContents();
step(`results: ${JSON.stringify(rows)}`);
check(rows[0]?.startsWith('1Chris') && rows[1]?.startsWith('2Veronika'), 'results in order');
await host.locator('.s-group').screenshot({ path: 'shots/race-results.png' });
await host.context().close();
await guest.context().close();

// --- keep-together: 320 W and 150 W stay together --------------------------------------------------------
const a = await rider('Chris', '#e8442e', 75);
await a.goto(`${base}?ride=gaisberg&group=new&together=1&sim=1&watts=320&nobt=1${relay}`);
await a.waitForSelector('.group-code', { timeout: 180000 });
const code2 = (await a.locator('.group-code').textContent()).slice(0, 5);
const b = await rider('Veronika', '#2fb36d', 56);
await b.goto(`${base}?group=${code2}&sim=1&watts=150&nobt=1${relay}`);
await b.waitForSelector('.group-start', { timeout: 180000 });
await b.waitForTimeout(1500);
await a.keyboard.press('Space');
await Promise.all([riding(a), riding(b)]);
await a.waitForTimeout(45000);
const [pa, pb] = await Promise.all([progress(a), progress(b)]);
step(`after 45 s: Chris ${Math.round(pa)} m, Veronika ${Math.round(pb)} m`);
check(Math.abs(pa - pb) < 10 && pa > 150, `kept together (${Math.round(pa - pb)} m apart)`);
await b.screenshot({ path: 'shots/together-guest.png' });

console.log(errors.length ? `ERRORS:\n${errors.join('\n')}` : 'no errors');
await browser.close();
