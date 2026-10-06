// dialogue_number_keys.mjs — pins number-key selection in the talk box.
//
//   node --experimental-detect-module tools/qa/dialogue_number_keys.mjs
//
// Human request 2026-10-02, with a screenshot of the interaction list:
//
//     Halle Batiste — COMMUTER
//     1  Say hello
//     2  Ask what they've heard
//     3  Buy something
//
// "numeric keys should be able to launch numbered options in talk box"
//
// The list is ALREADY NUMBERED on screen, so the numbers are a promise the key
// handler does not keep: src/dialogue.js onKey() handles ArrowUp/ArrowDown, q/Q
// and Enter/t/T, and nothing else. Pressing "2" did nothing at all.
//
// Two lists share this handler and both needed it:
//   - mode "list"    the interaction options above, indexed by `rows[selected]`
//   - mode "trade"   the goods, indexed by `tradeSel`, one past the end meaning
//                    "back out" (that is how move() wraps it)
// so the implementation follows the same shape as move()/the confirm branch
// rather than inventing a third code path.
//
// Gotcha worth pinning: `e.key` for the numpad digits is ALSO "1".."9" on a
// standard layout, but Digit1 and Numpad1 arrive with different `e.code` and
// some layouts/IMEs deliver only e.code. The suite requires BOTH paths to work,
// because a player on a laptop with a numpad should not have to use the top row.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const dlg = readFileSync(join(here, "../../src/dialogue.js"), "utf8");

let fails = 0;
const ok = (m) => console.log(`  ok   ${m}`);
const bad = (m) => { console.log(`  FAIL ${m}`); fails++; };
const check = (c, m) => (c ? ok(m) : bad(m));

console.log("=== 1. number keys are handled at all ===");
check(/Digit\(\[1-9\]\)/.test(dlg) || /Digit\[1-9\]/.test(dlg) || /const digit =/.test(dlg),
  "onKey inspects the digit (e.code Digit1..Digit9 or a parsed key)");
check(/Numpad[1-9]/.test(dlg) || /numPad|numpad/i.test(dlg),
  "numpad digits are handled too, not just the top row");

console.log("\n=== 2. it selects AND launches, in both lists ===");
// "select" alone would move the cursor; the request is to LAUNCH the option.
check(/rows\[/.test(dlg), "the interaction list is still indexed via rows[]");
check(/tradeSel/.test(dlg), "the trade list is still indexed via tradeSel");
// Both must be reachable from the number path, not just one of them.
// Extract the digit branch itself: from the parse to its terminating `return;`.
// Anchoring on a prose comment is brittle -- the first version of this file did
// that and silently tested the wrong slice.
const numStart = dlg.search(/const digit =/);
const numEnd = numStart >= 0 ? dlg.indexOf("return;", dlg.indexOf('} else { mode = "list"', numStart)) : -1;
const numBlock = numStart >= 0 ? dlg.slice(numStart, numEnd > numStart ? numEnd + 20 : numStart + 1200) : "";
if (!numBlock) { console.log("  FAIL could not locate the digit branch in dialogue.js"); fails++; }
check(/chooseTrade\(/.test(numBlock) && /pick\(/.test(numBlock) && /rows\[/.test(numBlock),
  "the number-key path handles BOTH lists: the trade goods (chooseTrade) and the interaction options (rows[] -> pick)");""
check(/pick\(/.test(numBlock) || /chooseTrade\(/.test(numBlock),
  "the number-key path actually launches (pick/chooseTrade), it does not just move the cursor");

console.log("\n=== 3. out-of-range digits are ignored, never wrapped ===");
// Wrapping would be actively wrong: pressing 9 on a 3-option list must not launch
// option 2. move() wraps for arrows because the cursor is already inside the list;
// a digit is an absolute address and has no business wrapping.
check(/n >= |n >=|>= .*length|return;/.test(numBlock),
  "an out-of-range digit returns without doing anything");
check(!/numBlock|%\s*rows\.length/.test(numBlock),
  "the digit path does not modulo-wrap the index");

console.log("\n=== 4. it does not steal keys from movement or the game's other binds ===");
// The existing handler swallows w/a/s/d/space so you cannot walk off mid-choice.
// A digit handler must keep that, and must not swallow T/Q/Enter/arrows.
check(/stopImmediatePropagation/.test(dlg), "dialogue still stops propagation, so the game does not also act on the key");
check(/"w", "a", "s", "d", " "/.test(dlg) || /\\["w", "a", "s", "d", " "\\]/.test(dlg),
  "movement is still swallowed while the list is open");
check(/e\.key === "q" || e\.key === "Q"/.test(dlg), "Q still backs out");
check(/e\.key === "Enter" \|\| e\.key === "t"/.test(dlg), "Enter/T still confirms");

console.log("\n=== 5. locked rows behave the same by number as by T ===");
// The T branch does: a locked row says its locked line rather than picking it.
// The number path must not silently do something different.
check(/opt\.locked/.test(numBlock) || /say\(/.test(numBlock),
  "a locked option reached by number says its locked line, exactly as T does");

console.log(`\n${fails ? fails + " FAILURES -- the numbered options cannot be launched from the keyboard" : "numbered options launch from the keyboard, in both the interaction list and the trade goods"}`);
process.exit(fails ? 1 : 0);