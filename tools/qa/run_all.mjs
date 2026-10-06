// tools/qa/run_all.mjs -- run EVERY qa gate, always, and report honestly.
//
// Why this exists: `npm test` used to be one long `&&` chain in package.json.
// `&&` short-circuits, so the first red gate silently swallowed every gate
// after it. That is how two failing tests got committed in f3a5448: they sat
// past a red gate in the chain, so `npm test` never even reached them and
// said nothing about them.
//
// This runner never short-circuits. It runs every gate in order, prints a
// PASS/FAIL line per gate, then a summary with the red list and a total
// failure count, and exits non-zero if anything failed.
//
// Usage:
//   node --experimental-detect-module tools/qa/run_all.mjs            # all gates
//   node --experimental-detect-module tools/qa/run_all.mjs --bail     # stop at first red
//   node --experimental-detect-module tools/qa/run_all.mjs seam_       # only matching gates
//
// Gates run sequentially on purpose: several of them (orleanorth_*,
// crown_build_test, seam_build_test, launch_build_test) write into dist/,
// so running them concurrently would have them stomp on each other.

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const TIMEOUT_MS = 10 * 60 * 1000; // a hung gate must fail, not hang the suite
const TAIL_LINES = 25;

// The gate list, in the same order the old `&&` chain used.
const GATES = [
  'tools/qa/factions_test.mjs',
  'tools/qa/hostile_gangs_test.mjs',
  'tools/qa/weapons_test.mjs',
  'tools/qa/police_test.mjs',
  'tools/qa/traffic_test.mjs',
  'tools/qa/deadend_test.mjs',
  'tools/qa/multilane_test.mjs',
  'tools/qa/pausemenu_test.mjs',
  'tools/qa/zombie_test.mjs',
  'tools/qa/main_js_scope_test.mjs',
  'tools/qa/no_green_wedges_test.mjs',
  'tools/qa/orleanorth_build.mjs',
  'tools/qa/orleanorth_claim_check.mjs',
  'tools/qa/orleanorth_layout.mjs',
  'tools/qa/district_overlap_test.mjs',
  'tools/qa/orleanorth_test.mjs',
  'tools/qa/menu_test.mjs',
  'tools/qa/launch_build_test.mjs',
  'tools/qa/pipboy_theme_test.mjs',
  'tools/qa/spawn_emptiness.mjs',
  'tools/qa/npc_panic_test.mjs',
  'tools/qa/nightclock_test.mjs',
  'tools/qa/stats_test.mjs',
  'tools/qa/weather_test.mjs',
  'tools/qa/difficulty_test.mjs',
  'tools/qa/terrain_test.mjs',
  'tools/qa/adult_content_test.mjs',
  'tools/qa/adult_clip_gate_test.mjs',
  'tools/qa/act_test.mjs',
  'tools/qa/adult_gate_race_test.mjs',
  'tools/qa/trade_test.mjs',
  'tools/qa/franchise_clubs_test.mjs',
  'tools/qa/backrooms_test.mjs',
  'tools/qa/backroom_staging_test.mjs',
  'tools/qa/crown_franchise_test.mjs',
  'tools/qa/stripper_test.mjs',
  'tools/qa/venue_show_test.mjs',
  'tools/qa/character_quality_test.mjs',
  'tools/qa/crown_build_test.mjs',
  'tools/qa/markings_test.mjs',
  'tools/qa/crosswalk_test.mjs',
  'tools/qa/seam_build_test.mjs',
  'tools/qa/seam_collision_test.mjs',
  'tools/qa/urban_ground_test.mjs',
  'tools/qa/metro_lanes_test.mjs',
  'tools/qa/urban_density_test.mjs',
  'tools/qa/road_blockers_test.mjs',
  'tools/qa/the_count_test.mjs',
  'tools/qa/nola_parts_test.mjs',
  'tools/qa/city_scale_test.mjs',
  'tools/qa/block_interiors_test.mjs',
  'tools/qa/landmarks_test.mjs',
  'tools/qa/streetlife_test.mjs',
  'tools/qa/dialogue_test.mjs',
  'tools/qa/dialogue_cast_test.mjs',
  'tools/qa/fringe_test.mjs',
  'tools/qa/road_ends_test.mjs',
  'tools/qa/population_test.mjs',
  'tools/qa/weapon_models_test.mjs',
  'tools/qa/faction_reputation_test.mjs',
  'tools/qa/faction_wiring_test.mjs',
  'tools/qa/talk_gate_test.mjs',
  'tools/qa/crime_exemption_test.mjs',
  'tools/qa/input_binding_test.mjs',
  'tools/qa/gang_provocation_test.mjs',
  'tools/qa/cop_loot_test.mjs',
  'tools/qa/player_iframes_test.mjs',
  'tools/qa/zombie_horde_test.mjs',
  'tools/qa/cheat_test.mjs',
  'tools/qa/medkit_test.mjs',
  'tools/qa/npc_grid_equivalence.mjs',
  'tools/qa/npc_pairwise_cost.mjs',
  'tools/qa/cull_groups_cover_every_district.mjs',
  'tools/qa/number_keys_select_menu_options.mjs',
  'tools/qa/wheelie_and_nosedive.mjs',
  'tools/qa/vehicle_fire_and_explosion.mjs',
  'tools/qa/car_paint_variety.mjs',
  'tools/qa/zombie_density_and_crown_exclusion.mjs',
  'tools/qa/act_one_chain.mjs',
  'tools/qa/police_fairness.mjs',
  'tools/qa/police_spawn_separation.mjs',
  'tools/qa/npc_talk_stops_in_front.mjs',
  'tools/qa/npc_talk_hold_behaviour.mjs',
  'tools/qa/traffic_sprite_cost.mjs',
  'tools/qa/traffic_lamp_gate.mjs',
  // The zone-classification agreement gate. Added 2026-10-03 after 3ecfde9 fixed the
  // spawn corridor in TWO of the three places that test "is this the city" and left
  // zoneAt() strict -- so a 40 m band round the south edge fell back to "forest" and
  // 165 hogs returned to OrleaRouge, four commits after fe0f848 fixed them. The suite
  // was green throughout: city_vegetation_probe.mjs DOES catch this, but it is a LIVE
  // probe and was never in GATES, so nothing ran it. This one is static and fast, which
  // is the whole point of adding it.
  //
  // city_vegetation_probe.mjs and spawn_npc_density.mjs stay out of GATES on purpose:
  // both need a live server and a 4-5 minute boot, and the suite would either grow past
  // its 10-minute per-gate budget or fail every time the server is down. They are the
  // BEHAVIOURAL confirmation; this gate is the cheap structural check that runs always.
  // Do not delete this one and call the behaviour covered -- it is not.
  'tools/qa/city_in_zone_agreement.mjs',
  // The graphics tier must not deny GTAO to a machine that can run it. The human's
  // complaint ("Walmart-level graphics") was NOT a missing renderer feature -- ACES,
  // sRGB, PCF-soft shadows and a PMREM sky probe were all already on. It was the tier
  // heuristic resolving a discrete RX 6600 / 32 GB / 12 cores to `medium`, which has
  // ao:false. GTAO is the contact shadows that stop objects floating.
  //
  // graphics_tier_reaches_ao.mjs is pure decision logic, so it runs in the suite with no
  // browser, no WebGL and no 4-minute boot. gfx_tier_report.mjs is the live counterpart
  // and stays out for the same reason city_vegetation_probe.mjs does.
  'tools/qa/graphics_tier_reaches_ao.mjs'
];

const argv = process.argv.slice(2);
const bail = argv.includes('--bail');
const filters = argv.filter((a) => !a.startsWith('--'));
const gates = filters.length ? GATES.filter((g) => filters.some((f) => g.includes(f))) : GATES;

if (gates.length === 0) {
  console.error('No gate matched: ' + filters.join(', '));
  console.error('Known gates: ' + GATES.join(' '));
  process.exit(2);
}

const tty = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;
const c = (code, s) => (tty ? '\u001b[' + code + 'm' + s + '\u001b[0m' : s);
const green = (s) => c(32, s);
const red = (s) => c(31, s);
const yellow = (s) => c(33, s);
const dim = (s) => c(2, s);
const bold = (s) => c(1, s);

function runGate(script) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(process.execPath, ['--experimental-detect-module', script], {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    const cap = (buf) => {
      out += buf.toString();
      if (out.length > 400000) out = out.slice(-200000);
    };
    child.stdout.on('data', cap);
    child.stderr.on('data', cap);

    const timer = setTimeout(() => {
      out += '\n[timed out after ' + Math.round(TIMEOUT_MS / 1000) + 's]\n';
      child.kill('SIGKILL');
    }, TIMEOUT_MS);

    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ code: 1, out: out + '\n[failed to spawn: ' + err.message + ']\n', ms: Date.now() - started });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code: code === null ? 1 : code, out, ms: Date.now() - started });
    });
  });
}

function tail(text) {
  const lines = text.split(/\r?\n/);
  const shown = lines.slice(-TAIL_LINES);
  if (lines.length > TAIL_LINES) {
    shown.unshift(dim('  ... ' + (lines.length - TAIL_LINES) + ' earlier line(s) elided ...'));
  }
  return shown.join('\n');
}

console.log(bold('QA: running ' + gates.length + ' gate(s)') + (bail ? yellow('  [--bail: will stop at first red]') : ''));
console.log('');

const width = String(gates.length).length;
const results = [];
for (let i = 0; i < gates.length; i++) {
  const script = gates[i];
  const name = path.basename(script, '.mjs');
  const label = '[' + String(i + 1).padStart(width) + '/' + gates.length + '] ' + name;
  process.stdout.write(dim(label + ' ... '));
  const { code, out, ms } = await runGate(script);
  const ok = code === 0;
  results.push({ name, script, ok, code, ms });
  const secs = (ms / 1000).toFixed(1) + 's';
  console.log(ok ? green('PASS') + dim(' (' + secs + ')') : red('FAIL') + dim(' (' + secs + ', exit ' + code + ')'));
  if (!ok) {
    console.log(red('  --- ' + name + ' output (tail) ---'));
    console.log(tail(out).split('\n').map((l) => '  ' + l).join('\n'));
    console.log(red('  --- end ' + name + ' output ---'));
  }
  if (!ok && bail) {
    console.log(yellow('\n--bail: stopping here.'));
    break;
  }
}

const failed = results.filter((r) => !r.ok);
const passed = results.length - failed.length;
const notRun = gates.length - results.length;

console.log('');
console.log(bold('='.repeat(64)));
console.log(bold('QA summary: ' + passed + ' passed, ' + failed.length + ' failed' + (notRun ? ', ' + notRun + ' not run' : '')));
if (failed.length) {
  console.log('');
  console.log(red(bold(failed.length + ' FAILED GATE(S):')));
  for (const f of failed) console.log(red('  FAIL  ' + f.name) + dim('  (exit ' + f.code + ')'));
} else {
  console.log(green(bold('All gates green.')));
}
console.log(bold('='.repeat(64)));

// Non-zero whenever a gate ran red -- that is the whole point.
process.exit(failed.length ? 1 : 0);
