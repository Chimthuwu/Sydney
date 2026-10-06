// npc_talk_stops_in_front.mjs — an NPC you talk to stops and faces you.
//
//   node --experimental-detect-module tools/qa/npc_talk_stops_in_front.mjs
//
// Human request 2026-10-02: "if u talk to NPCs they should stop in front of u
// not walk away".
//
// THE BEHAVIOUR TODAY. src/npc.js has exactly five states:
//
//     "idle"  "loiter"  "wander"  "flee"  "hostile"
//
// There is no "talking". So when the player opens a conversation, the NPC carries
// on running whatever its wander/loiter goal was, and walks out of the
// conversation while you are still reading it. dialogue.js is deliberately
// ignorant of NPC internals (see the note at main.js:1746 -- it is handed a flat,
// pre-filtered list and must not know what an NPC is), so the fix belongs in
// main.js, which owns the NPCs and already has the `talk` action.
//
// WHAT IS ASSERTED. Not "a variable exists" -- the observable behaviour:
//
//   1. npc.js gains a way to be held still and turned to face a point
//   2. main.js actually calls it on the talk keypress, for the live NPC
//   3. the hold RELEASES when the conversation closes, so the NPC does not
//      become a statue forever -- this is the failure mode that would make the
//      feature worse than the bug
//   4. the release is keyed on dialogue going inactive, not on a keypress, so
//      closing the box by any route (Q, walking away, a cutscene) still frees them
//
// The distance check matters: "stop in front of u" means they stop where they
// are rather than teleporting. If they were snapped to a fixed ring in front of
// the player, the assertion below could not tell the difference between that and
// simply stopping.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const npc = readFileSync(join(here, "../../src/npc.js"), "utf8");
const main = readFileSync(join(here, "../../src/main.js"), "utf8");

let fails = 0;
const ok = (m) => console.log(`  ok   ${m}`);
const bad = (m) => { console.log(`  FAIL ${m}`); fails++; };
const check = (c, m) => (c ? ok(m) : bad(m));

console.log("=== 1. npc.js can hold an NPC still and turn it to face a point ===");
// holdStill is a method on the returned controller object, not a `function`
// declaration inside the closure -- so match the method form.
check(/holdStill\(e, x, z, face = true\)/.test(npc), "npc.js exposes a holdStill(e, ...) on the NPC system");
check(/e\.talkHold\.face/.test(npc),
  "facing is part of the hold (a `face` flag on talkHold), so they turn as well as stop");
check(/holdStill\(e, x, z, face = true\)/.test(npc),
  "holdStill(e, x, z, face) turns the NPC toward (x, z) by default");
check(/releaseHold\(e\)/.test(npc) && /releaseHold/.test(npc),
  "and releaseHold is reachable from the controller, so the hold can always be undone");

console.log("\n=== 2. the hold must not corrupt the AI's own bookkeeping ===");
// The dangerous part: act() recomputes vel every frame from the goal. If the hold
// only zeroed vel without suppressing the goal, the NPC would fight it and jitter
// on the spot -- worse than walking away.
check(/e\.talkHold/.test(npc), "the hold is a flag on the agent, so decide()/act() can see it");
check(/e\.talkHold/.test(npc) && /talkHold/.test(npc.split("function act")[1] || ""),
  "act() consults the flag, so movement is suppressed at the source");

console.log("\n=== 3. main.js calls it on the talk keypress ===");
const talkBlock = (main.match(/input\.onPress\("talk"[\s\S]{0,900}?\n\}\);/) || [""])[0];
check(!!talkBlock, "the talk action block is found");
check(/holdStill/.test(talkBlock),
  "the talk keypress holds the NPC still (not somewhere far later in the frame)");
check(/holdStill\(target\.npc, playerPos\.x, playerPos\.z\)/.test(talkBlock),
  "and is passed the player's position, so it turns to face the player rather than only stopping");

console.log("\n=== 4. it RELEASES, keyed on the conversation ending ===");
// The whole feature is worthless -- and worse than the bug -- if the NPC never
// moves again. And keying the release on a keypress means any other way of
// closing the box strands them.
check(/dialogue\.active/.test(main),
  "main.js reads dialogue.active, so the hold is driven by conversation state");
check(/holdStill\(null\)|releaseHold|clearHold/.test(main),
  "and there is an explicit release/clear call when the conversation is over");
// Anchor on the per-frame poll specifically. The FIRST dialogue.active in main.js is
// the talk handler's own "already open" guard, which is not the release site.
const pollBlock = (main.match(/if \(!dialogue\.active && heldTalker\) \{[\s\S]{0,220}?\}/) || [""])[0];
check(/releaseHold\(heldTalker\)/.test(pollBlock) && /heldTalker = null/.test(pollBlock),
  "the release clears the reference as well as the flag, so the next conversation can hold somebody");
check(/npcs\.beginFrame\(dt\)/.test(main.split("if (!dialogue.active && heldTalker)")[1]?.slice(0, 400) || ""),
  "and the poll sits in the per-frame path (immediately before npcs.beginFrame), so it cannot be missed");

console.log("\n=== 5. it does not strand hostile NPCs ===");
// Hostile NPCs are refused a conversation at main.js:1752 (isHostileNpc). The hold
// must be applied to the same NPC the box opened on, or a guard could hold a
// bystander while talking to someone else.
check(/dialogue\.open\(target\)/.test(talkBlock) && /target\.npc/.test(talkBlock),
  "the hold is applied to target.npc -- the same NPC the conversation opened on");

console.log(`\n${fails ? fails + " FAILURES -- NPCs still walk away mid-conversation" : "an NPC you talk to stops, faces you, and is released when the box closes"}`);
process.exit(fails ? 1 : 0);