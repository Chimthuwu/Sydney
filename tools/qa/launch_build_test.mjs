// launch_build_test.mjs — character creation is part of every mode now, and in
// Story it happens BEFORE the first cutscene.
//
// The Pip-Boy used to be Zombie-only. Story and Free Roam started with whatever
// SPECIAL the character happened to carry, so the skill system the user asked for
// simply was not reachable outside Zombie mode. And in Story the order matters:
// prologue.start() queues the opening line, so a build applied after that call
// lands on a cutscene that is already playing.
//
// main.js is a 9000-line module that boots a whole game on import, so this cannot
// import it. Instead it reads the source and checks the ORDER of the statements,
// which is the part that can silently regress.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

let fails = 0;
const ok = (c, m) => { console.log(`${c ? "  ok  " : "  FAIL"} ${m}`); if (!c) fails++; };

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "../../src/main.js"), "utf8");

const body = src.slice(src.indexOf("async function confirmCharacter()"));
const confirm = body.slice(0, body.indexOf("\nfunction closeCharacterSelect") >= 0
  ? body.indexOf("\nfunction closeCharacterSelect") : body.indexOf("\nasync function launchFromSave"));

// ---- 1. confirmCharacter actually asks the Pip-Boy
ok(/if \(!pendingBuild && !buildingStats && !restoringSave\)/.test(confirm),
  "confirmCharacter asks for a build when one was not handed to it");
ok(/const build = await pipboy\.create\(\)/.test(confirm),
  "and it is the real Pip-Boy, awaited");
ok(/state\.stats = createCharacter\(build\)/.test(confirm),
  "the build becomes state.stats");

// ---- 2. ORDER: the Pip-Boy must resolve before the game starts and before any
//        campaign's first cutscene. Getting this wrong is the whole bug.
const iAwait = confirm.indexOf("await pipboy.create()");
const iBegin = confirm.indexOf("beginGame()");
const iPrologue = confirm.indexOf("prologue.start()");
const iAlt = confirm.indexOf("alternate.start()");
const iGreedo = confirm.indexOf("greedoCampaign.start()");
ok(iAwait > 0 && iBegin > iAwait, `skills are chosen before the game begins (pip ${iAwait} < begin ${iBegin})`);
ok(iPrologue > iAwait, `the Story prologue starts AFTER the build is applied (pip ${iAwait} < prologue ${iPrologue})`);
ok(iAlt > iAwait, `the alternate campaign also starts after it (pip ${iAwait} < alternate ${iAlt})`);
ok(iGreedo > iAwait, `the greedo campaign too (pip ${iAwait} < greedo ${iGreedo})`);

// ---- 3. the apply must not be skipped: it has to be reached, not just present
ok(/if \(pendingBuild\) state\.stats = createCharacter\(pendingBuild\)/.test(confirm),
  "the build is applied to state.stats after the dialog closes");

// ---- 4. cancelling must not launch the game
ok(/if \(!build\) \{ characterSelect\.hidden = false; return; \}/.test(confirm),
  "cancelling the Pip-Boy returns to the character select instead of launching");

// ---- 5. a thrown build must not brick the launch
ok(/catch \(e\)[\s\S]{0,200}console\.warn/.test(confirm),
  "a failed build warns and falls through rather than throwing into the launch");

// ---- 6. re-entry guard: Enter/Space on the select screen would otherwise open a
//        second Pip-Boy on top of the first while the player is still choosing.
ok(/let buildingStats = false/.test(src) && /if \(!pendingBuild && !buildingStats/.test(confirm),
  "a re-entry guard stops the Pip-Boy being opened twice by the select keys");

// ---- 7. loading a save must NOT re-roll the character
ok(/restoringSave = true;/.test(src), "launchFromSave marks that it is restoring a save");
ok(/!restoringSave\)/.test(confirm), "so confirmCharacter skips the Pip-Boy for a loaded save");
ok(/restoringSave = false;/.test(src), "and the flag is cleared once the save owns the character");

// ---- 8. zombie mode is not asked twice
ok(/pendingBuild = build;/.test(src), "zombie mode hands its finished build down");

console.log(fails ? `\n${fails} FAILURES` : "\nall launch/build checks passed");
process.exit(fails ? 1 : 0);