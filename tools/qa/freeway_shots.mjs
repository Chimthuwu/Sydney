// Screenshots of the freeway: the overpass, the ramp, each tunnel portal and the inside of a bore.
//   node serve.mjs 8899 ; node tools/qa/freeway_shots.mjs        -> tools/qa/out/freeway_*.png   (needs puppeteer; PUPPETEER_EXECUTABLE_PATH for Edge)
import puppeteer from 'puppeteer';
import { autoAcknowledge } from './lib/agegate.mjs';
const browser = await puppeteer.launch({ protocolTimeout: 300000, args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--mute-audio'] });
const page = await browser.newPage();
await autoAcknowledge(page); const errs = []; page.on('pageerror', e => errs.push(e.message));
await page.setViewport({ width: 1280, height: 720 });
await page.goto('http://localhost:8899/', { waitUntil: 'domcontentloaded', timeout: 90000 });
await page.waitForSelector('#freeBtn:not([disabled])', { timeout: 300000 });
await page.evaluate(() => document.getElementById('freeBtn').click());
await new Promise(r => setTimeout(r, 8000));
await page.keyboard.press('KeyV');
const spots = await page.evaluate(() => {
  const t = window.__game.terrain, c = t.corridors[0]; const out = [['overpass', -430, -612, 90], ['ramp', -430, -530, 70]];
  c.bores.forEach((b, i) => { const p0 = t.pointAt(c, b.s0 - 14), p1 = t.pointAt(c, (b.s0 + b.s1) / 2); out.push([`portal${i}`, p0.x, p0.z, 60], [`inside${i}`, p1.x, p1.z, 30]); });
  return out;
});
let first = true;
for (const [name, x, z, dist] of spots) {
  await page.evaluate((x, z) => { const g = window.__game; g.teleport(x, z); g.worldTime.setTime(14); }, x, z);
  if (first) {
    await page.mouse.move(640, 300); await page.mouse.down({ button: 'right' });
    for (let i = 0; i < 9; i++) await page.mouse.move(640, 300 + (i + 1) * 22);
    await page.mouse.up({ button: 'right' }); first = false;
  }
  await new Promise(r => setTimeout(r, 7000));
  await page.screenshot({ path: `tools/qa/out/freeway_${name}.png` });
  console.log(name, x.toFixed(0), z.toFixed(0));
}
console.log('errors', errs.slice(0, 5));
await browser.close();
