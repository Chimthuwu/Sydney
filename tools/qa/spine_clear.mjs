// Can you drive the length of US-167?
//
//   node <browser-automation>/browser.mjs http://localhost:8899/ --script tools/qa/spine_clear.mjs
//
// The spine runs the whole map at x = ROAD_X (-6) and it is the one road every
// player uses: Chatboro to OrleaRouge, the prologue, Act One's drive to Mama's
// door. fill_check covers its far north and far south; this covers the middle,
// which is where two invisible walls were sitting.
//
// It samples across the carriageway (x -10.5 .. -1.5) rather than down the
// centreline, because that is what a car needs — and it reports the NARROWEST
// point as well as the impassable ones, since a 3.6 m car squeezing through a
// 3.8 m gap is a bug waiting to be reported as "it feels blocked".
import { openTheDoors } from "./lib/gates.mjs";
const BODY = [
  "const g = window.__game, grid = g.blockerGrid;",
  "const R = 1.8;",
  // A car drives at y ~0, so a blocker banded to an elevated deck (b.y0/b.y1,
  // e.g. the z 172 overpass parapet 8 m up) does not stop it — the same test
  // BlockerGrid.resolve makes.
  "const CAR_Y = 0.5;",
  "const free = (x, z) => { let ok = 1; grid.near(x, z, R + 3, (b) => {",
  "  if (!ok || b._grid !== 'static') return;",
  "  if (b.y0 !== undefined && (CAR_Y < b.y0 || CAR_Y > b.y1)) return;",
  "  if ((b.x-x)**2 + (b.z-z)**2 < (b.r+R)**2) ok = 0;",
  "}); return ok; };",
  // drive US-167 from Chatboro's south edge into OrleaRouge's grid
  "const walls = [];",
  "for (let z = -560; z <= 400; z += 1) {",
  "  let open = 0;",
  "  for (let x = -10.5; x <= -1.5; x += 0.25) if (free(x, z)) open++;",
  "  if (open === 0) walls.push(Math.round(z));",
  "}",
  "const spans = [];",
  "for (const z of walls) { const last = spans[spans.length - 1]; if (last && z - last[1] <= 2) last[1] = z; else spans.push([z, z]); }",
  // and the narrowest point, so a squeeze shows up too
  "let narrowest = { z: null, widthM: 99 };",
  "for (let z = -560; z <= 400; z += 1) {",
  "  let open = 0;",
  "  for (let x = -10.5; x <= -1.5; x += 0.25) if (free(x, z)) open++;",
  "  const w = open * 0.25;",
  "  if (w < narrowest.widthM) narrowest = { z: Math.round(z), widthM: +w.toFixed(2) };",
  "}",
  "return { impassableSpans: spans, narrowestGap: narrowest, note: 'a car is 3.6 m wide (R 1.8)' };",
].join("\n");
async function inPage(page, body) {
  await page.addScriptTag({ content: "try { document.body.dataset.r = JSON.stringify((function(){ " + body + " })()); }"
    + " catch (e) { document.body.dataset.r = JSON.stringify({ error: String((e && e.stack) || e) }); }" });
  return JSON.parse(await page.evaluate(() => document.body.dataset.r || "null"));
}
export default async function run(page) {
  await page.setViewportSize({ width: 800, height: 600 });
  await openTheDoors(page);
  await page.waitForFunction(() => { const b = document.getElementById("freeBtn"); return b && !b.disabled; }, null, { timeout: 300000 });
  await page.click('[data-menu="start"]');
  await page.waitForTimeout(300);
  await page.click("#freeBtn");
  await page.waitForFunction(() => window.__game && window.__game.chatboro, null, { timeout: 90000 });
  await page.waitForTimeout(1500);
  return await inPage(page, BODY);
}
