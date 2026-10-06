// Browser-path check for the recorded gun samples (2026-09-27): fetch + decode
// every manifest entry with the real WebAudio implementation, print peaks so
// the trims in gunAudio.js can be sanity-checked against the synth baselines.
//   node tools/qa/gun_audio_browser_check.mjs   (expects `node serve.mjs 8899` running)
import puppeteer from 'puppeteer';
import { autoAcknowledge } from './lib/agegate.mjs';
import { gunSfxManifest } from '../../src/gunAudio.js';

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const browser = await puppeteer.launch({
  protocolTimeout: 120000,
  executablePath: EDGE,
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--mute-audio'],
});
const page = await browser.newPage();
await autoAcknowledge(page);
await page.goto('http://localhost:8899/', { waitUntil: 'domcontentloaded', timeout: 90000 });

const paths = [...new Set(Object.values(gunSfxManifest()).flat().map((s) => s.path))];
const rows = await page.evaluate(async (paths) => {
  const ctx = new AudioContext();
  const out = [];
  for (const p of paths) {
    try {
      const res = await fetch(`/${p}`);
      if (!res.ok) { out.push({ p, error: `HTTP ${res.status}` }); continue; }
      const buf = await ctx.decodeAudioData(await res.arrayBuffer());
      const ch = buf.getChannelData(0);
      let peak = 0;
      for (let i = 0; i < ch.length; i++) peak = Math.max(peak, Math.abs(ch[i]));
      out.push({ p, seconds: +buf.duration.toFixed(2), peak: +peak.toFixed(3) });
    } catch (e) { out.push({ p, error: String(e) }); }
  }
  ctx.close();
  return out;
}, paths);
await browser.close();

let bad = 0;
for (const r of rows) {
  if (r.error) { bad++; console.log(`${r.p}: ERROR ${r.error}`); continue; }
  console.log(`${r.p.padEnd(32)} ${String(r.seconds).padEnd(6)}s peak ${r.peak}`);
}
console.log(bad ? `${bad} BAD` : 'ALL SAMPLES FETCH+DECODE IN BROWSER');
process.exit(bad ? 1 : 0);
