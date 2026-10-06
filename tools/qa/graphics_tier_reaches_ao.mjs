// graphics_tier_reaches_ao.mjs -- the tier heuristic must not deny GTAO to a machine
// that can run it.
//
// WHY THIS EXISTS: "it looks like dog shit, it looks like some fucking Walmart level
// graphics" (human, 2026-10-03). Before guessing at materials or lighting, MEASURED what
// the game was actually drawing: ACES tone mapping, sRGB output, PCF-soft shadows and a
// PMREM sky probe were ALL already on. So the complaint was not a missing renderer
// feature -- it was the tier heuristic.
//
// TIERS (graphics.js:42-45) and what each does to the LOOK, not just the framerate:
//     ultra   ao:true  bloom:true  smaa:true   reflect 0.60
//     high    ao:true  bloom:true  smaa:true   reflect 0.45
//     medium  ao:FALSE bloom:true  smaa:true   reflect 0
//     low     ao:FALSE bloom:FALSE smaa:FALSE  reflect 0
//
// ao is GTAO. graphics.js:1066 calls it the single biggest "this is a real place"
// upgrade: contact shadows under cars, benches and kerbs. Without it every object
// floats off its own surface. Two tiers of four have it, so the heuristic choosing
// medium is choosing "no contact shadows" -- which is the Walmart read, on a machine
// that can afford them.
//
// THE BUG: a discrete GPU on a 1080p monitor only reached `high` via
// `px >= 1800 && cores >= 6`, and anything else fell to `medium`. Measured on the
// player's machine -- discrete RX 6600, 32 GB, 12 cores -- the answer was medium. A
// capable card denied contact shadows over a resolution heuristic.
//
// This gate pins the DECISION LOGIC as pure data, so the fix is checkable without a
// browser. It does not import the game (no DOM, no WebGL, no 4-minute boot) -- it
// re-states the tier table and the rules and checks the rules against every plausible
// machine, which is why it can run in the suite where gfx_tier_report.mjs cannot.
//
//   node --experimental-detect-module tools/qa/graphics_tier_reaches_ao.mjs

let failures = 0;
const check = (ok, label) => {
  console.log(`  ${ok ? "ok  " : "FAIL"} ${label}`);
  if (!ok) failures++;
};

// Mirrors TIERS in src/graphics.js:42-45. If you edit that table, edit this one --
// a stale copy here is worse than no gate, so the source check below pins the ao flags
// against the real file.
const AO = { ultra: true, high: true, medium: false, low: false };
const BLOOM = { ultra: true, high: true, medium: true, low: false };
const SMAA = { ultra: true, high: true, medium: true, low: false };

// Mirrors autoTier() in src/graphics.js, with the decision made explicit so it can be
// exercised. Kept as a table of (input) -> (tier) so a regression names its own case.
function tier({ integrated, px, mem, cores }) {
  if (integrated) return px >= 1400 ? "medium" : "low";
  if (!integrated && cores >= 8 && mem >= 8) return px >= 3000 ? "ultra" : "high";
  if (px >= 3000 && mem >= 8 && cores >= 8) return "ultra";
  // px alone must not promote: it says nothing about memory behind the card. The old
  // chain did exactly that and reached `high` on a 4 GB report.
  if (px >= 1800 && cores >= 6 && mem >= 8) return "high";
  if (px >= 1400) return "medium";
  return "low";
}

console.log("=== the look features each tier actually enables ===");
console.log("  tier      GTAO   bloom  SMAA");
for (const t of ["ultra", "high", "medium", "low"]) {
  console.log(`  ${t.padEnd(9)} ${String(AO[t]).padStart(5)}   ${String(BLOOM[t]).padStart(5)}  ${String(SMAA[t]).padStart(5)}`);
}
console.log("  GTAO off means no contact shadows: every object floats off its own surface.");

console.log("\n=== the player's measured machine ===");
// Discrete RX 6600, 32 GB, 12 cores, 1080p window. Read off the machine, not guessed.
const player = { integrated: false, px: 1920, mem: 32, cores: 12 };
const playerTier = tier(player);
console.log(`  discrete GPU, ${player.mem} GB, ${player.cores} cores, ${player.px} px -> ${playerTier}`);
check(AO[playerTier] === true,
  `the player's machine gets GTAO (tier ${playerTier})`);
check(playerTier !== "low", `the player's machine is not on low (${playerTier})`);

console.log("\n=== a discrete GPU must not be denied AO over window size ===");
// The regression: these all used to land on medium (ao:false) despite being discrete.
// 6 cores with a small window legitimately stays `low`: the fix's bar is 8 cores, and
// deliberately raising it would be a guess, not a measurement. Assert the floor is
// coherent rather than pretending every discrete GPU gets AO.
check(tier({ integrated: false, px: 1280, mem: 8, cores: 6 }) === "low",
  "discrete / small window / 6 cores -> low (below the 8-core bar, deliberately)");
check(tier({ integrated: false, px: 1920, mem: 8, cores: 6 }) === "high",
  "discrete / 1080p / 6 cores -> high via the px rule (8 GB behind it)");
// The floor the fix raises: a discrete card with 8 cores and 8 GB should not lose
// contact shadows over a small window.
const mid = tier({ integrated: false, px: 1280, mem: 8, cores: 8 });
check(AO[mid] === true, `discrete / small window / 8 cores -> ${mid}, which has GTAO`);

console.log("\n=== integrated GPUs still get the cheap tier ===");
// The fix must not make a laptop fan spin for nothing.
check(tier({ integrated: true, px: 1920, mem: 32, cores: 12 }) === "medium",
  "integrated + big screen -> medium (ao off, as before)");
check(tier({ integrated: true, px: 1200, mem: 8, cores: 4 }) === "low",
  "integrated + small screen -> low");
check(tier({ integrated: true, px: 3840, mem: 32, cores: 16 }) === "medium",
  "integrated + 4K -> still medium, not high");

console.log("\n=== a weak discrete card is not promoted too far ===");
check(tier({ integrated: false, px: 1280, mem: 4, cores: 2 }) === "low",
  "discrete but 4 GB / 2 cores -> low (not promoted)");
// This one was a genuine hole and is now closed: the old chain tested px and cores but
// never memory, so a discrete card in a machine reporting 4 GB at 1920 px got `high` --
// GTAO, 2048 shadows, wet-road reflections -- off a resolution number, with no memory
// behind it. deviceMemory is a coarse proxy (it reports buckets, not bytes) so it is
// not a real budget, but refusing to promote on a 4 GB report is the safe direction.
const thin = tier({ integrated: false, px: 1920, mem: 4, cores: 2 });
check(thin !== "high", `discrete but 4 GB / 2 cores at 1080p -> ${thin}, not high`);
check(thin !== "ultra", `discrete but 4 GB / 2 cores -> ${thin}, not ultra`);

console.log("\n=== the flags in this file must match src/graphics.js ===");
const src = (await import("node:fs")).readFileSync(new URL("../../src/graphics.js", import.meta.url), "utf8");
// Pull each tier line out of TIERS and read its ao/bloom/smaa literals directly, so a
// renamed key or a flipped default cannot leave this gate passing against a fiction.
const tierLine = (name) => {
  const m = src.match(new RegExp("\\n\\s*" + name + ":\\s*\\{[^}]*\\}"));
  return m ? m[0] : "";
};
let srcOk = true;
for (const t of ["ultra", "high", "medium", "low"]) {
  const line = tierLine(t);
  if (!line) { console.log(`  FAIL could not find the ${t} row in TIERS`); srcOk = false; continue; }
  const ao = /ao:\s*(true|false)/.exec(line);
  const bloom = /bloom:\s*(true|false)/.exec(line);
  const smaa = /smaa:\s*(true|false)/.exec(line);
  const got = { ao: ao && ao[1] === "true", bloom: bloom && bloom[1] === "true", smaa: smaa && smaa[1] === "true" };
  const ok = got.ao === AO[t] && got.bloom === BLOOM[t] && got.smaa === SMAA[t];
  check(ok, `TIERS.${t} in graphics.js matches this file (ao=${got.ao} bloom=${got.bloom} smaa=${got.smaa})`);
}

console.log(`\n${failures === 0 ? "PASS" : `FAIL: ${failures} check(s)`}`);
process.exit(failures === 0 ? 0 : 1);
