// GPU memory over several worlds loaded and unloaded in one page: what a ride leaves behind.
//   PORT=5299 node scripts/probe-memory.mjs [gaisberg formentor gaisberg …] [--settle=25000]
// Loads each world straight through the engine (no ride, no trainer), lets forests, villages and terrain
// stream in, then unloads it and prints renderer.info.memory and the draw-call count.
import { chromium } from 'playwright';

const args = process.argv.slice(2);
const settle = Number(args.find((a) => a.startsWith('--settle='))?.slice(9) ?? 25000);
const routes = args.filter((a) => !a.startsWith('--'));
if (!routes.length) routes.push('gaisberg', 'formentor', 'gaisberg', 'formentor');

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(`http://localhost:${process.env.PORT ?? 5199}/?nobt=1`);
await page.waitForFunction(() => window.engine, null, { timeout: 60000 });

const mem = () => page.evaluate(() => {
  const i = window.engine.renderer.info;
  return { geometries: i.memory.geometries, textures: i.memory.textures, programs: i.programs?.length ?? 0 };
});
console.log('start', JSON.stringify(await mem()));
for (const id of routes) {
  await page.evaluate(async (id) => {
    const { buildRoute } = await import('/src/geo/route.ts');
    const data = await (await fetch(`/routes/${id}.json`)).json();
    const route = await buildRoute({ ...data, source: 'brouter' });
    const e = window.engine;
    e.riderS = 0;
    e.paused = false;
    await e.loadWorld(route, { kit: '#d33', accent: '#111', bike: '#eee' }, () => undefined);
  }, id);
  await page.waitForTimeout(settle);
  const loaded = await mem();
  const calls = await page.evaluate(() => window.engine.stats.calls);
  await page.evaluate(() => {
    window.engine.unloadWorld();
    window.engine.paused = true;
  });
  await page.waitForTimeout(500);
  console.log(`${id.padEnd(12)} loaded ${JSON.stringify(loaded)} calls ${calls} → unloaded ${JSON.stringify(await mem())}`);
}
await browser.close();
