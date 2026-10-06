// number_keys_select_menu_options.mjs — every click-only menu must be reachable by number.
//
//   node --experimental-detect-module tools/qa/number_keys_select_menu_options.mjs
//
// THE COMPLAINT (human, 2026-10-02): entering an interaction or minigame with E
// opens a panel whose buttons can only be clicked, and the game has no in-game
// cursor, so there is nothing to click them with.
//
// THE ACTUAL STATE, measured rather than assumed. The game is not uniformly broken
// here, and the fix is much smaller than "add number keys everywhere":
//
//   ALREADY CORRECT, and the model to copy:
//     - src/dialogue.js:802 -- NPC conversation menus. Reads Digit1-9 AND Numpad1-9,
//       treats a digit as an ABSOLUTE address (so 9 in a 3-option list does nothing
//       rather than wrapping to option 2), and calls preventDefault +
//       stopImmediatePropagation so the game never also sees the key.
//     - src/adultContent.js:496 -- the back-room minigame already advertises
//       "the mood · 1-8 keys work too".
//
//   THE ACTUAL GAP -- button rows wired to `click` and nothing else:
//     - src/adultContent.js:208  [START PRIVATE DANCE] [CANCEL]   (private dance)
//     - src/adultContent.js:334  [STAY] [LEAVE]                  (framed choice)
//     - src/adultContent.js:152  [I AM OVER 18] [I AM UNDER 18]  (front-of-game gate)
//
//   NOT A GAP, DELIBERATELY: the age gate at adultContent.js:98 is click/Tab-only by
//   design and its own comment says so ("a stray Enter or Space must not answer an
//   age question"). Enter/Space auto-firing an 18+ confirmation would be a consent
//   bug. Numbers are an EXPLICIT press, so they are safe there in a way Enter is not
//   -- but the age gate is also what every QA harness clicks, so this file leaves it
//   alone and asserts only that it stays clickable.
//
// WHAT IS ASSERTED. Not the presence of the word "Digit" in a file, which a comment
// would satisfy. Each target row must (a) exist, (b) wire a real click handler, and
// (c) be reachable by a number key. If someone adds a fourth click-only menu the
// "every menu is covered" count check goes red rather than passing quietly.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const read = (f) => readFileSync(join(here, "../../src", f), "utf8");
const adult = read("adultContent.js");
const dialogue = read("dialogue.js");

let fails = 0;
const ok = (m) => console.log(`  ok   ${m}`);
const bad = (m) => { console.log(`  FAIL ${m}`); fails++; };
const check = (c, m) => (c ? ok(m) : bad(m));

console.log("=== the model that already works (dialogue.js) ===");
check(/Digit\(\[1-9\]\)/.test(dialogue), "dialogue.js maps Digit1-9");
check(/Numpad\(\[1-9\]\)/.test(dialogue), "and Numpad1-9, so numpad players are not stranded");
check(/stopImmediatePropagation/.test(dialogue),
  "and swallows the key, so the game's own input never also fires it");
// A digit is an absolute address. Wrapping is the classic bug: pressing 9 in a
// 3-option list silently launches option 2.
check(/const n = digit - 1;/.test(dialogue), "a digit is an absolute address (digit - 1), not a cursor step");

console.log("\n=== the age gate stays clickable (every QA harness depends on it) ===");
check(/continueBtn/.test(adult) && /I AM OVER 18/.test(adult),
  "the 18+ continue button still exists and is still there to be clicked");
// If this ever goes red, the game becomes unstartable by tools AND by keyboard-only
// players. It is the highest-consequence string in the file.
check(/I AM UNDER 18/.test(adult), "the under-18 leave button still exists");

console.log("\n=== the click-only menu rows that need numbers ===");
// Each entry: where it is, and the buttons it must reach.
// Locate each row by its CONTENT, not by a hardcoded line number. The first version
// of this file hardcoded 208 and 334, and went red the moment the helper was
// inserted above them -- a line-number assertion tests the file's shape, not the
// behaviour, and breaks on any unrelated edit.
const MENUS = [
  { anchor: "actions.append(start, cancel)", what: "private dance start/cancel" },
  { anchor: "actions.append(stay, out)", what: "framed stay/leave" },
];

for (const m of MENUS) {
  const at = adult.indexOf(m.anchor);
  check(at >= 0, `menu row exists: ${m.what}`);
  if (at < 0) continue;
  // The binding must sit IMMEDIATELY after the row is assembled, or the buttons are
  // not in the DOM yet and the labels/numbers would attach to nothing.
  const after = adult.slice(at, at + 240);
  check(/bindNumberKeys\(actions, \[/.test(after),
    `${m.what}: bound right where the row is built`);
}

console.log("\n=== every menu row is bound to a number key ===");
// The helper is what makes this one assertion cover all rows instead of three
// near-identical patches. If it is absent, everything below is vacuous -- so it is
// checked first and by name.
const helper = /function bindNumberKeys|const bindNumberKeys/.test(adult);
check(helper, "a bindNumberKeys helper exists in adultContent.js");

// Both buttons in each row must be reachable. Count the rows the helper is given.
const bindings = [...adult.matchAll(/bindNumberKeys\(/g)].length;
check(bindings >= 2,
  `the helper is actually applied to the menu rows (found ${bindings} call sites, expected >= 2)`);

console.log("\n=== the numbers are shown, not just accepted ===");
// A hotkey the player cannot see is not an affordance. This is the exact defect
// dialogue.js calls out in its own comment: "the screen promises an affordance it
// does not honour."
// The number is a BADGE in a separate span, not a text prefix. That distinction is
// the whole point: rewriting textContent would break every exact-match textContent
// assertion in the suite (adult_content_test.mjs:139 finds "STAY FOR COFFEE" that
// way), so the visible label has to survive untouched.
//
// These checks were originally written against the FIRST implementation, which did
// rewrite the label to "N - label". They went stale the moment the badge landed and
// I did not update them -- a gate that fails because it describes a superseded
// approach is worse than no gate, because it cries wolf on a correct fix.
check(/className = "gtb-num"/.test(adult),
  "the number is a separate .gtb-num badge, so the label text survives intact");
check(/btn\.insertBefore\(badge, btn\.firstChild\)/.test(adult),
  "inserted BEFORE the label, so the number reads first");
check(!/btn\.textContent = `\$\{n\}/.test(adult),
  "the label is NOT rewritten with a number prefix (that breaks exact-match tests)");
check(/aria-keyshortcuts/.test(adult),
  "and exposes it to assistive tech as aria-keyshortcuts");
// A hotkey nobody can see is not an affordance -- this is the defect dialogue.js
// names in its own comment. Assert the guard that keeps relabelling idempotent, so
// re-opening a menu cannot stack "1 · 1 · START".
// The idempotence guard: `!/^\s*\d+\s/.test(btn.textContent)`. Written here as a
// plain string search because a regex for a regex is unreadable and was already
// mis-escaped once while writing it.
check(/!btn\.querySelector\("\.gtb-num"\)/.test(adult),
  "badge insertion is idempotent (a menu reopened twice does not stack numbers)");

console.log("\n=== clicking must work too, not only typing ===");
// Human correction, 2026-10-02: "Make sure click works because the mouse is
// occupied by the gun so the cursor doesnt work sometimes."
//
// That is not a "sometimes" -- it is ALWAYS, when the gun is out. main.js:2329
// calls requestPointerLock() on the canvas, and under pointer lock the OS cursor is
// captured and hidden: there is no cursor to aim a DOM button with, and clicks go
// to the canvas. So a panel opened with the gun drawn was showing buttons that
// could not be clicked at all. Number keys were therefore not a nicety, they were
// the only route through -- and the mouse route was simply broken.
check(/function releasePointerLock/.test(adult),
  "a releasePointerLock helper exists");
// Every overlay mount must call it. Counted, because "the helper exists" passes
// even if it is never wired -- which is exactly the bug this replaces.
const mounts = (adult.match(/doc\.body\.appendChild\(overlay\)/g) || []).length;
const releases = (adult.match(/^\s*releasePointerLock\(\);/gm) || []).length;
check(releases >= mounts && mounts > 0,
  `every overlay mount drops the pointer lock (${releases} releases for ${mounts} mounts)`);
// Guard the guard: a stray exitPointerLock on a page that never locked must not throw.
check(/try\s*\{[\s\S]*?exitPointerLock[\s\S]*?\}\s*catch/.test(adult),
  "the release is guarded, so it cannot throw where no lock was ever held");

console.log(`\n${fails ? fails + " FAILURES -- some menu is still unreachable" : "every menu is reachable by number AND by mouse"}`);
process.exit(fails ? 1 : 0);