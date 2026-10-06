// medkit_test.mjs — the medkit inventory is real, visible, and names the right key.
//
//   node --experimental-detect-module tools/qa/medkit_test.mjs
//
// Human report 2026-10-02: "before we added some health kits as drops ... these
// were meant to be like portable health kits so player press H and it heals em
// if they got in inv".
//
// The mechanic largely existed already, and worked: a kit walked over at full
// health is BANKED rather than wasted (loot.js), capped at 9, and J spends one
// for +35 HP. Two things were broken around it.
//
// 1. The only hint named the WRONG KEY. loot.js said "(H to use)" in a comment
//    while the action is bound to J (input.js medkit: KeyJ). H is the HORN. So
//    the player banks a kit, presses H, hears a horn, and concludes the mechanic
//    is broken. This is the same failure as the E/F prompt lie, and it is worse
//    here because a horn is audible feedback: the game actively confirms the
//    wrong key.
//
// 2. The count was invisible. state.medkits appeared ONLY inside a 2.5s
//    flashObjective. A player carrying 4 banked kits had no way to know, so "if
//    they got in inv" was unanswerable — the inventory existed in the state and
//    not on the screen. An inventory you cannot see is not an inventory.
//
// The test parses the real binding table rather than trusting the labels, which
// is the whole point: it checks every player-facing mention of the key against
// DEFAULT_BINDINGS.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const main = readFileSync(join(here, "../../src/main.js"), "utf8");
const input = readFileSync(join(here, "../../src/input.js"), "utf8");
const loot = readFileSync(join(here, "../../src/loot.js"), "utf8");
const html = readFileSync(join(here, "../../index.html"), "utf8");

let fails = 0;
const ok = (m) => console.log(`  ok   ${m}`);
const bad = (m) => { console.log(`  FAIL ${m}`); fails++; };
const check = (c, m) => (c ? ok(m) : bad(m));

// Read the real binding.
const body = input.slice(input.indexOf("DEFAULT_BINDINGS"), input.indexOf("const CTRL_CHORDS"));
const bindings = {};
for (const m of body.matchAll(/(\w+):\s*\[([^\]]*)\]/g)) {
  bindings[m[1]] = [...m[2].matchAll(/"(\w+)"/g)].map((k) => k[1]);
}
check(!!bindings.medkit, `medkit is a bound action (${bindings.medkit})`);
const MEDKEY = { KeyJ: "J", KeyH: "H", KeyE: "E", KeyF: "F" }[bindings.medkit?.[0]] || "?";

console.log(`\n=== 1. the key it is ACTUALLY bound to is ${MEDKEY} ===`);
check(MEDKEY === "J", "J, as bound in input.js");
check(bindings.horn?.[0] === "KeyH", "H is the horn — so a stray \"H to use\" was pointing at a different action");

console.log("\n=== 2. no player-facing text names the wrong key ===");
// The bug was a comment, but the same mistake in a live prompt would be worse.
check(!/H to use/.test(loot), "loot.js no longer says \"H to use\"");
check(!/H to use/.test(main), "main.js does not say \"H to use\" either");
// Every "X to <verb>" in a player-facing string should name a real action.
const labels = [...main.matchAll(/[\\"'`]([A-Z]) to (use|get out|enter|leave|buy|choose|talk)[\\"'`]/g)].map((m) => m[1]);
const byKey = { E: "interact", F: "driveOrTorch", T: "talk", Q: "closeDialog", J: "medkit", H: "horn", V: "viewToggle" };
for (const k of [...new Set(labels)]) {
  check(!!byKey[k], `prompt key "${k}" corresponds to a real action${byKey[k] ? ` (${byKey[k]})` : ""}`);
}

console.log("\n=== 3. the count is on the HUD, not only in a flash ===");
check(/id="kitIndic"/.test(html), "a dedicated HUD element exists");
check(html.includes('id="kitIndic" hidden'), "and starts hidden so the HUD is clean with zero kits");
check(/getElementById\("kitIndic"\)/.test(main), "main.js binds it");
check(/kitIndic\.textContent/.test(main), "and writes the count into it");
// Must be inside syncHUD, or it only updates when something else calls it.
const sync = main.match(/function syncHUD\(\) \{[\s\S]*?\n\}/);
check(!!sync && /kitIndic/.test(sync[0]), "it is updated in syncHUD, so banking a kit refreshes it immediately");
check(!!sync && /state\.medkits/.test(sync[0]), "from state.medkits — the real inventory, not a local counter");
check(main.includes("kitIndic.hidden = true"), "hidden again at zero kits");
check(new RegExp(`${MEDKEY} to use`).test(main.slice(main.indexOf("kitIndic.textContent") - 300, main.indexOf("kitIndic.textContent") + 300)),
  `the HUD hint names the real key (${MEDKEY})`);
check(/medkit\\$\\{kits > 1 \? "s" : ""\\}|kits > 1 \? "s" : ""/.test(main), "it pluralises, so 2 does not read as \"2 medkit\"");

console.log("\n=== 4. the banking mechanic itself is intact ===");
check(loot.includes("state.medkits = Math.min(9,"), "a kit walked over at full health is banked, capped at 9");
check(loot.includes(">= 100"), "and only banked when it would otherwise be wasted");
check(main.includes('input.onPress("medkit", () => useMedkit())'), "J is wired to useMedkit");
// useMedkit must refuse at full health, or J burns a kit for nothing.
const use = main.match(/function useMedkit\(\) \{[\s\S]*?\n\}/);
check(!!use && use[0].includes("state.hp >= 100"), "using one at full health is refused rather than wasted");
check(!!use && use[0].includes("state.medkits--"), "and it decrements the inventory");
check(!!use && use[0].includes("Math.min(100,"), "and clamps at 100 rather than overshooting");

console.log(`\n${fails ? fails + " FAILURES" : "the medkit inventory is visible and names the right key"}`);
process.exit(fails ? 1 : 0);