// gfx_tier_report.mjs -- what graphics tier does this machine ACTUALLY resolve to,
// and which post passes survive?
//
// WHY THIS EXISTS: the "looks like Walmart" complaint is a LOOK problem, and the
// cheapest look upgrade in this codebase is gated behind flags nobody checks at
// runtime:
//     medium: ao:false, bloom:true,  smaa:true
//     low:    ao:false, bloom:false, smaa:false
// So on `low` the game renders with NO ambient occlusion, NO bloom and NO SMAA --
// which is most of what "flat and cheap" looks like -- while ACES tone mapping and
// the PBR sky are still on, so it does not look broken, just cheap. That is exactly
// the complaint.
//
// autoTier() (graphics.js:156) decides from the UNMASKED_RENDERER string, screen size,
// deviceMemory and hardwareConcurrency. None of that is inspectable from the source, so
// this probes it.
//
// HEADLESS CAVEAT, load-bearing: this runs under --use-gl=swiftshader, so
// UNMASKED_RENDERER is SwiftShader and autoTier() returns "low" for a reason that has
// nothing to do with the player's real GPU. So this reports the DECISION LOGIC and the
// resulting flags, and names the inputs it saw. The "real GPU" line is what the player
// should compare against their own machine. Do not read "low" here as "low at home".
//
//   node serve.mjs 8899   then   node --experimental-detect-module tools/qa/gfx_tier_report.mjs
//
// This model may have no vision endpoint, so everything here is numeric. Do not claim
// to have SEEN the game from this output.

import puppeteer from "puppeteer";
import { autoAcknowledge } from "./lib/agegate.mjs";

const browser = await puppeteer.launch({ args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--mute-audio"] });
const page = await browser.newPage();

// The renderer logs GTAO failures as a WARN and continues without it
// (graphics.js:1087). That is a silent killer of the single biggest "this is a real
// place" upgrade, so capture it rather than trusting the tier to imply it.
const gfxLog = [];
page.on("console", (m) => {
  const t = m.text();
  if (/\[gfx\]|GTAO|batching|tier|post/i.test(t)) gfxLog.push(`[${m.type()}] ${t}`);
});

await autoAcknowledge(page);
await page.setViewport({ width: 1280, height: 720 });
await page.goto("http://localhost:8899/", { waitUntil: "domcontentloaded", timeout: 90000 });
await page.waitForSelector("#freeBtn:not([disabled])", { timeout: 240000 });
await page.click("#freeBtn");
await new Promise((r) => setTimeout(r, 12000));

// Headless resolves to `low`, where ao:false, so the probe would never learn whether
// GTAO works -- which is the whole question. The player's real machine has a discrete
// RX 6600, 32 GB and 12 cores, so it lands on high/ultra where ao:true. Force that
// path so this reports what the player's machine would actually get.
//
// The buttons are the game's OWN tier controls (main.js:339), not a back door, so
// clicking one exercises exactly the code a player's click does.
let forced = "(no tier button found)";
if (process.env.GFX_FORCE_TIER) {
  const sel = `[data-tier="${process.env.GFX_FORCE_TIER}"]`;
  const clicked = await page.evaluate((s) => {
    const b = document.querySelector(s);
    if (!b) return false;
    b.click();
    return true;
  }, sel);
  if (clicked) {
    forced = process.env.GFX_FORCE_TIER;
    await new Promise((r) => setTimeout(r, 9000));   // let the composer rebuild
  }
}
console.log(`\n=== forced tier for this run: ${forced} ===`);

const out = await page.evaluate(() => {
  const gl = document.createElement("canvas").getContext("webgl");
  const ext = gl && gl.getExtension("WEBGL_debug_renderer_info");
  const name = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : "(no debug_renderer_info)";
  const px = Math.max(screen.width, screen.height) * (devicePixelRatio || 1);
  const integrated = /intel|uhd|iris|hd graphics|mali|adreno|apple gpu|swiftshader|llvmpipe|software/i.test(name) && !/arc\b/i.test(name);
  // autoTier() inlined so the DECISION is visible, not just the answer.
  let predicted;
  if (integrated) predicted = px >= 1400 ? "medium" : "low";
  else if (px >= 3000 && (navigator.deviceMemory || 4) >= 8 && (navigator.hardwareConcurrency || 4) >= 8) predicted = "ultra";
  else if (px >= 1800 && (navigator.hardwareConcurrency || 4) >= 6) predicted = "high";
  else if (px >= 1400) predicted = "medium";
  else predicted = "low";
  const g = window.__game || {};
  return {
    gpu: name, integrated, px: Math.round(px),
    mem: navigator.deviceMemory || null, cores: navigator.hardwareConcurrency || null,
    predicted,
    liveTier: g.GFX ? g.GFX.tier : "(GFX not exposed)",
    preset: g.GFX ? { scale: g.GFX.preset.scale, shadow: g.GFX.preset.shadow, ao: g.GFX.preset.ao, bloom: g.GFX.preset.bloom, smaa: g.GFX.preset.smaa, reflect: g.GFX.preset.reflect } : null,
    adaptive: g.GFX ? g.GFX.adaptive : null,
    activeChoices: Array.from(document.querySelectorAll("[data-tier]")).filter((b) => b.classList.contains("active")).map((b) => b.dataset.tier),
  };
});

const PRESETS = {
  ultra:  { scale: 3840, ss: 1.5, shadow: 4096, ao: true,  aoSamples: 16, bloom: true,  smaa: true,  reflect: 0.6 },
  high:   { scale: 2560, ss: 1.0, shadow: 2048, ao: true,  aoSamples: 10, bloom: true,  smaa: true,  reflect: 0.45 },
  medium: { scale: 1920, ss: 1.0, shadow: 2048, ao: false, aoSamples: 0,  bloom: true,  smaa: true,  reflect: 0 },
  low:    { scale: 1280, ss: 1.0, shadow: 1024, ao: false, aoSamples: 0,  bloom: false, smaa: false, reflect: 0 },
};

console.log("\n=== inputs autoTier() saw ===");
console.log(`  GPU string        ${out.gpu}`);
console.log(`  read as integrated ${out.integrated}   (regex: /intel|uhd|iris|.../i, minus /arc/ )`);
console.log(`  screen px         ${out.px}   (need >=1400 medium, >=1800 high, >=3000 ultra)`);
console.log(`  deviceMemory      ${out.mem}    cores ${out.cores}`);

console.log("\n=== the decision ===");
console.log(`  autoTier() would pick: ${out.predicted}`);
console.log(`  live GFX.tier:         ${out.liveTier}    adaptive=${out.adaptive}`);
console.log(`  tier buttons active:   ${JSON.stringify(out.activeChoices)}`);
console.log(`  live preset flags:     ${JSON.stringify(out.preset)}`);
// Only meaningful when NO tier was forced. If GFX_FORCE_TIER is set, the mismatch is the
// POINT -- a forced tier is supposed to disagree with the heuristic -- so reporting it as
// a defect teaches the reader to ignore the one line that matters.
if (!process.env.GFX_FORCE_TIER && out.liveTier !== "(GFX not exposed)" && out.liveTier !== out.predicted) {
  console.log("  ^ MISMATCH: the live tier is not what the heuristic predicts. A persisted");
  console.log("    choice or a URL override (main.js:342 reads data-tier) is pinning it.");
  console.log("    That is the thing to look at, not the heuristic.");
}

console.log("\n=== what the look features do at each tier ===");
console.log("  tier     scale  shadow   GTAO   bloom  SMAA   wet-road reflect");
for (const [k, p] of Object.entries(PRESETS)) {
  console.log(`  ${k.padEnd(8)} ${String(p.scale).padStart(4)}  ${String(p.shadow).padStart(5)}  ${String(p.ao).padStart(6)}  ${String(p.bloom).padStart(6)}  ${String(p.smaa).padStart(5)}   ${String(p.reflect).padStart(6)}`);
}
console.log('\n  GTAO is the single biggest "this is a real place" upgrade (graphics.js:1066):');
console.log("  contact shadows under cars, benches, kerbs. Without it every object floats.");
console.log('  On low/medium it is OFF, which is most of what "Walmart graphics" looks like.');

console.log(`\n=== renderer log (${gfxLog.length} lines) ===`);
for (const l of gfxLog.slice(0, 30)) console.log("  " + l);
const gtaoFail = gfxLog.filter((l) => /GTAO unavailable/i.test(l));
if (gtaoFail.length) {
  console.log("\n  ^ GTAO FAILED TO LOAD. The tier may say ao:true and it still will not be");
  console.log("    in the frame. That is a hard visual loss, logged only as a warn.");
}

// What the renderer says it is DRAWING beats what the tier says it SHOULD draw.
const draws = await page.evaluate(() => {
  const r = (window.__game && window.__game.renderer) || null;
  if (!r) return null;
  const i = r.info;
  return { calls: i.render.calls, triangles: i.render.triangles, programs: i.programs ? i.programs.length : null };
}).catch(() => null);
if (draws) console.log(`\n=== draw calls now: ${draws.calls}  triangles ${draws.triangles}  programs ${draws.programs}`);

await browser.close();
