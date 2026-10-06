// Audition the zombie SFX (2026-09-27): decode the actual files with the same
// WebAudio implementation the game uses and print per-file measurements, so the
// playback gains in audio.js are tuned from numbers instead of guesses.
// Baselines from the code being replaced: the old synth groan peaked at 0.16
// amplitude (× crowd 0.35-1.0), the synth wail at 0.28 × distance falloff.
//   node tools/qa/zombie_audio_audit.mjs   (expects `node serve.mjs 8899` already running)
import puppeteer from 'puppeteer';
import { autoAcknowledge } from './lib/agegate.mjs';

const FILES = ['groan0', 'groan1', 'moan0', 'utter0', 'scream0'];
// This box has no standalone Chrome; Edge is Chromium and decodes identically.
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';

const browser = await puppeteer.launch({
  protocolTimeout: 120000,
  executablePath: EDGE,
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--mute-audio'],
});
const page = await browser.newPage();
await autoAcknowledge(page);
await page.goto('http://localhost:8899/', { waitUntil: 'domcontentloaded', timeout: 90000 });

const rows = await page.evaluate(async (files) => {
  const ctx = new AudioContext();
  const out = [];
  for (const name of files) {
    try {
      const res = await fetch(`/assets/audio/zombie/${name}.mp3`);
      if (!res.ok) { out.push({ name, error: `HTTP ${res.status}` }); continue; }
      const buf = await ctx.decodeAudioData(await res.arrayBuffer());
      const ch = buf.getChannelData(0);
      let peak = 0, sum = 0, zc = 0;
      for (let i = 0; i < ch.length; i++) {
        const v = Math.abs(ch[i]);
        if (v > peak) peak = v;
        sum += ch[i] * ch[i];
        if (i && (ch[i] < 0) !== (ch[i - 1] < 0)) zc++;
      }
      out.push({
        name, seconds: +buf.duration.toFixed(2), channels: buf.numberOfChannels,
        peak: +peak.toFixed(3), rms: +Math.sqrt(sum / ch.length).toFixed(3),
        zcr: +(zc / ch.length).toFixed(4),   // high = bright/hissy, low = dark/rumbly
      });
    } catch (e) { out.push({ name, error: String(e) }); }
  }
  ctx.close();
  return out;
}, FILES);
await browser.close();

console.log('file     dur(s)  ch  peak   rms    zcr');
for (const r of rows) {
  if (r.error) { console.log(`${r.name}: ERROR ${r.error}`); continue; }
  console.log(`${r.name.padEnd(8)} ${String(r.seconds).padEnd(7)} ${String(r.channels).padEnd(3)} ${String(r.peak).padEnd(6)} ${String(r.rms).padEnd(6)} ${r.zcr}`);
}
console.log('\nSuggested trim for a target peak t:  trim = t / peak');
