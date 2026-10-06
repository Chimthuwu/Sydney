// orlearouge_batch_reconcile.mjs — why is OrleaRouge the worst spot again?
//
//   node serve.mjs 8899   then   node --experimental-detect-module tools/qa/orlearouge_batch_reconcile.mjs
//
// CONTEXT (gtb-perf-audit skill): OrleaRouge was ALREADY fixed once — the composer
// cullGroups work took it from 2.28x the worst other location down to 1.00x, and the
// skill records the outcome as "8 locations, worst 1.03x, 566-617 calls." A fresh
// real_frame_profile run puts OrleaRouge at 4706 calls / 1562 ms against 692 ms for the
// best spot. So either that fix regressed, or it fixed a symptom and left the cause.
//
// WHAT THIS ASSUMES, AND CHECKS. The batch key in src/merge.js:157 is
//
//   [matSig, attrKey, cast, receiveShadow, renderOrder, parent.id, cellX, cellZ]
//
// `parent.id` is THREE.JS's per-object unique id, NOT a group name. Two meshes merge
// only if they share a parent OBJECT. Tuning `cell = 48` therefore does nothing for any
// pair whose parents differ, however close together they sit. If OrleaRouge assembles
// each structure as its own group — which per-structure construction tends to produce,
// and which a "[OrleaRouge]" name prefix implies — then nearly every building is pinned
// to its own batch and the cell size is irrelevant there. That is the difference between
// "the cull groups were wrong" and "the cull groups were never the problem."
//
// This measures it rather than tuning a number and hoping: mesh count vs DISTINCT PARENT
// COUNT, per district. Under ~4 meshes per parent, parent.id is the limiter and cell size
// is a red herring. The static half of the gtb-perf-audit rule -- a framing-independent
// tool that asserts nothing about performance -- is deliberately absent here: this tool
// is a live census that depends on a running server, and it is DIAGNOSIS, so it exits 0.
// Making it a gate would mean a red suite whenever the server is down.
//
// FIRST VERSION OF THIS TOOL SHIPPED BROKEN. It shelled out to a nested `node -e` that
// evaluated the probe through JSON.stringify interpolation; the child failed silently
// and the tool reported "the live probe produced nothing" while showing no error. A
// diagnostic that reports its own harness failure as a finding about the game is worse
// than no diagnostic. puppeteer is now imported directly and the probe is a real function
// passed to page.evaluate.

import puppeteer from "puppeteer";

const browser = await puppeteer.launch({
  args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--mute-audio"],
});
const page = await browser.newPage();

// Ground truth for the batcher. gtb-perf-audit: "main.js has always logged, and NO QA
// script captured" — this is the first tool here to capture it, and without it a mesh
// census cannot be reconciled against what the batcher actually did.
const gfxLog = [];
page.on("console", (m) => { if (/\[gfx\]|batching/i.test(m.text())) gfxLog.push(m.text()); });
page.on("pageerror", (e) => { console.log("PAGE ERROR: " + e.message); });

await page.goto("http://localhost:8899/", { waitUntil: "domcontentloaded", timeout: 90000 });
for (let i = 0; i < 150; i++) {
  if (await page.evaluate(() => !!(globalThis.__game && globalThis.__game.scene))) break;
  await new Promise((r) => setTimeout(r, 1000));
}
if (!(await page.evaluate(() => !!globalThis.__game))) {
  console.log("HARNESS FAIL: __game never appeared — the page did not boot. This is NOT a finding about the game.");
  await browser.close();
  process.exit(1);
}

// Wait for BOTH batching passes. Without them the census is taken on a scene that is
// about to lose 40,000 meshes, and every parent ratio below would be wrong.
for (let i = 0; i < 90; i++) {
  if (gfxLog.some((l) => /late static batching/.test(l))) break;
  await new Promise((r) => setTimeout(r, 1000));
}

const d = await page.evaluate(() => {
  const tagOf = (o) => {
    const chain = [];
    for (let p = o; p; p = p.parent) if (p.name) chain.push(p.name);
    return chain.find((n) => /orlea|crown|strip|downtown|city|calypso|oyster|lakeshore/i.test(n)) || "(untagged)";
  };
  const seen = new Map();
  let total = 0;
  const allParents = new Set();
  // `g` is the local alias other tools use, but it is NOT a page global: it only exists
  // inside their own evaluate closures. Reaching for it here threw ReferenceError deep
  // in a 4-minute run, which is a slow way to learn that a name has to be carried
  // across the boundary explicitly.
  const g = globalThis.__game;
  g.scene.traverse((o) => {
    if (!o.isMesh || o.isInstancedMesh || o.isSkinnedMesh) return;
    if (o.isSprite || o.isPoints || o.isLine) return;
    const tag = tagOf(o);
    if (!seen.has(tag)) seen.set(tag, { meshes: 0, parents: new Set() });
    const e = seen.get(tag);
    e.meshes++;
    e.parents.add(o.parent.id);
    total++;
    allParents.add(o.parent.id);
  });
  const out = {};
  for (const [k, v] of seen) out[k] = { meshes: v.meshes, parents: v.parents.size };
  out.__total = { meshes: total, parents: allParents.size };
  return out;
});

console.log("=== renderer batching log (ground truth) ===");
for (const l of gfxLog) console.log("  " + l);
if (!gfxLog.length) {
  console.log("  NONE -- the batcher log never fired, so this census is PRE-batch and overstates mesh count.");
  console.log("  Do not act on the ratios below; the late pass is still pending.");
}

const rows = Object.entries(d).filter(([k]) => k !== "__total").sort((a, b) => b[1].meshes - a[1].meshes);
console.log("\n=== meshes per parent (low = nothing merges across the parent) ===");
console.log("  " + "group".padEnd(28) + "meshes".padStart(8) + "parents".padStart(9) + "  mesh/parent");
for (const [k, v] of rows) {
  console.log("  " + k.slice(0, 28).padEnd(28) + String(v.meshes).padStart(8)
    + String(v.parents).padStart(9) + "  " + (v.meshes / v.parents).toFixed(1));
}
const t = d.__total;
console.log("  " + "WHOLE SCENE".padEnd(28) + String(t.meshes).padStart(8) + String(t.parents).padStart(9)
  + "  " + (t.meshes / t.parents).toFixed(1));

console.log("\n=== verdict ===");
let bad = 0;
for (const [k, v] of rows) {
  const ratio = v.meshes / v.parents;
  if (ratio < 4 && v.meshes > 200) {
    console.log(`  PINNED: ${k} — ${v.meshes} meshes across ${v.parents} parents (${ratio.toFixed(1)} each).`);
    console.log("          Under 4 per parent, parent.id in the batch key means these cannot share a");
    console.log("          batch with a sibling structure. Raising `cell` will not help them.");
    bad++;
  }
}
const overall = t.meshes / t.parents;
console.log(`  whole scene: ${overall.toFixed(1)} meshes per parent.`);
if (overall < 4) console.log("  Scene-wide too, so this is structural — a property of how districts assemble, not one district's bug.");
if (!bad) console.log("  Parents are shared enough that parent.id is NOT the limiter. Look at cullGroups or shadow casters instead.");
console.log(`\n${bad ? bad + " district(s) pinned by parent.id -- cell size is not the lever here" : "parent.id is not the bottleneck"}`);
console.log("Diagnosis only. Exits 0 by design: this needs a live server, so it is not a suite gate.");
process.exit(0);