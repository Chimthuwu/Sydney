// Which side of the road does the traffic drive on?
//
//   node <browser-automation>/browser.mjs http://localhost:8899/ --script tools/qa/lane_side.mjs
//
// Dixie Beaux is Louisiana, so: the right. In this world -z is NORTH
// (districts.js), which makes each direction's right-hand side:
//
//   heading north  (-z)  ->  +x        heading south  (+z)  ->  -x
//   heading east   (+x)  ->  +z        heading west   (-x)  ->  -z
//
// This does not need a single car to be driving, and it does not need to know
// where any centreline is. Every road has two opposing lanes, so it pairs them
// by the direction they run and checks the pair sits the right way round:
// on a north-south road the northbound lane must be EAST of the southbound one,
// and on an east-west road the eastbound lane must be SOUTH of the westbound.
// Get that backwards and the two carriageways are swapped — which is what
// left-hand driving is.
async function inPage(page, body) {
  await page.addScriptTag({
    content: "try { document.body.dataset.r = JSON.stringify((function(){ " + body + " })()); }"
      + " catch (e) { document.body.dataset.r = JSON.stringify({ error: String((e && e.stack) || e) }); }",
  });
  return JSON.parse(await page.evaluate(() => document.body.dataset.r || "null"));
}

const BODY = [
  "const g = window.__game;",
  "const lanes = (g.traffic && g.traffic.lanes) || [];",
  "const out = [];",
  "for (const l of lanes) {",
  // makeLane stores the polyline as `pts`: THREE.Vector2(x, z) — y IS z here
  "  const p = (l.pts && l.pts.map((v) => [v.x, v.y])) || l.points;",
  "  if (!p || p.length < 2) continue;",
  "  const a = p[0], b = p[p.length - 1];",
  "  const dx = b[0] - a[0], dz = b[1] - a[1];",
  "  if (Math.abs(dx) < 4 && Math.abs(dz) < 4) continue;",
  "  const ew = Math.abs(dx) >= Math.abs(dz);",
  // mid-lane lateral position, and the road's identity = its name without the direction
  "  const mid = p[Math.floor(p.length / 2)];",
  "  const lateral = ew ? mid[1] : mid[0];",
  "  const along = ew ? mid[0] : mid[1];",
  "  const road = String(l.name || '').replace(/[:\\-\\s](f|b|east|west|north|south)(bound)?(:\\d+)?$/i, '')",
  "                .replace(/(east|west|north|south)bound/i, '').trim();",
  "  out.push({ road, ew, lateral, along, forward: ew ? Math.sign(dx) : Math.sign(dz), name: l.name });",
  "}",
  // pair opposing lanes of the same road that overlap along their length
  "const byRoad = {};",
  "for (const l of out) { (byRoad[l.road + (l.ew ? '|ew' : '|ns')] ||= []).push(l); }",
  "const bad = [], good = [];",
  "for (const [key, group] of Object.entries(byRoad)) {",
  "  const fwd = group.filter((l) => l.forward > 0), rev = group.filter((l) => l.forward < 0);",
  "  if (!fwd.length || !rev.length) continue;",
  "  const avg = (a) => a.reduce((s, l) => s + l.lateral, 0) / a.length;",
  "  const ew = group[0].ew;",
  // east (+x) must be at greater z than west; north (-z) must be at greater x than south
  "  const positive = avg(fwd), negative = avg(rev);",
  "  const ok = ew ? positive > negative : negative > positive;",
  "  const rec = { road: key, ew, fwdLateral: +positive.toFixed(2), revLateral: +negative.toFixed(2) };",
  "  (ok ? good : bad).push(rec);",
  "}",
  "return { roadsChecked: good.length + bad.length, onTheRight: good.length, onTheLeft: bad.length, wrong: bad.slice(0, 12) };",
].join("\n");

export default async function run(page) {
  const { openTheDoors } = await import("./lib/gates.mjs");
  await page.setViewportSize({ width: 800, height: 600 });
  await openTheDoors(page);
  await page.waitForFunction(() => {
    const b = document.getElementById("freeBtn");
    return b && !b.disabled;
  }, null, { timeout: 300000 });
  await page.click('[data-menu="start"]');
  await page.waitForTimeout(300);
  await page.click("#freeBtn");
  await page.waitForFunction(() => window.__game && window.__game.traffic, null, { timeout: 90000 });
  await page.waitForTimeout(1500);
  const r = await inPage(page, BODY);
  r.verdict = r.roadsChecked === 0 ? "INCONCLUSIVE: no opposing lane pairs found"
    : r.onTheLeft === 0 ? "PASS: every road drives on the right" : "FAIL: " + r.onTheLeft + " road(s) drive on the left";
  return r;
}
