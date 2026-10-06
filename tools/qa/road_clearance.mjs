// Nothing on roads: every traffic lane is a road centreline; report every static blocker (house, tree, lamp, prop) that intrudes
// on the carriageway (centre of the lane +/- CLEAR m), grouped by lane.   node serve.mjs 8899 ; node tools/qa/road_clearance.mjs [--json]
// Needs puppeteer (set PUPPETEER_EXECUTABLE_PATH if Chromium was not downloaded).
import puppeteer from 'puppeteer';
import { autoAcknowledge } from './lib/agegate.mjs';
const CLEAR = 1.6;       // half a car (1.0) + a little; a lane is ~3.4 m wide and drivers hug its centre
const browser = await puppeteer.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--mute-audio'] });
const page = await browser.newPage();
await autoAcknowledge(page);
const errs = []; page.on('pageerror', e => errs.push(e.message));
await page.goto('http://localhost:8899/', { waitUntil: 'domcontentloaded', timeout: 90000 });
await page.waitForSelector('#freeBtn:not([disabled])', { timeout: 300000 });
await page.evaluate(() => document.getElementById('freeBtn').click());
await new Promise(r => setTimeout(r, 4000));
const res = await page.evaluate((CLEAR) => {
  const g = window.__game, lanes = g.traffic.lanes.filter(l => !/~uturn$/.test(l.name));
  const statics = g.blockers.filter(b => b._grid === 'static' || b._grid === undefined).filter(b => b.r > 0 && !b.dynamic);
  // street lamps / lot lights with a pole are solid too (litSpots entries with `pole`), radius ~0.25 m
  for (const s of g.litSpots || []) if (s.pole && s.x != null) statics.push({ x: s.x, z: s.z, r: 0.25, tag: 'lamp pole' });
  const out = [];
  for (const l of lanes) {
    const hits = new Map();
    for (let i = 1; i < l.pts.length; i++) {
      const a = l.pts[i - 1], b = l.pts[i], dx = b.x - a.x, dy = b.y - a.y, len2 = dx * dx + dy * dy || 1;
      const x0 = Math.min(a.x, b.x) - 30, x1 = Math.max(a.x, b.x) + 30, z0 = Math.min(a.y, b.y) - 30, z1 = Math.max(a.y, b.y) + 30;
      for (const k of statics) {
        if (k.x < x0 || k.x > x1 || k.z < z0 || k.z > z1) continue;
        const t = Math.max(0, Math.min(1, ((k.x - a.x) * dx + (k.z - a.y) * dy) / len2));
        const d = Math.hypot(k.x - (a.x + t * dx), k.z - (a.y + t * dy)) - k.r;
        if (d < CLEAR && !hits.has(k)) hits.set(k, d);
      }
    }
    if (hits.size) out.push({ lane: l.name, len: Math.round(l.length), hits: [...hits].map(([k, d]) => ({ x: +k.x.toFixed(1), z: +k.z.toFixed(1), r: +k.r.toFixed(2), gap: +d.toFixed(2), tag: k.tag || k.name || k.kind || '' })) });
  }
  return { lanes: lanes.length, statics: statics.length, out };
}, CLEAR);
if (process.argv.includes('--json')) console.log(JSON.stringify(res));
else {
  console.log(`${res.lanes} lanes, ${res.statics} static blockers, ${res.out.length} lanes with intrusions`);
  for (const l of res.out) { console.log(`\n${l.lane} (${l.len} m): ${l.hits.length}`); for (const h of l.hits.slice(0, 8)) console.log(`   (${h.x}, ${h.z}) r=${h.r} gap=${h.gap} ${h.tag}`); if (l.hits.length > 8) console.log(`   ... +${l.hits.length - 8}`); }
}
console.log('page errors:', errs.length);
await browser.close();
process.exit(res.out.length ? 1 : 0);
