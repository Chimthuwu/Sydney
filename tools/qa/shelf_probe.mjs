// Why are Foods_* shelf-stock meshes still separate after batchStatic? Classify each by the batcher's skip rules.
import puppeteer from 'puppeteer';
import { autoAcknowledge } from './lib/agegate.mjs';
const browser = await puppeteer.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--mute-audio'] });
const page = await browser.newPage();
await autoAcknowledge(page);
await page.goto('http://localhost:8899/', { waitUntil: 'domcontentloaded', timeout: 90000 });
await page.waitForSelector('#freeBtn:not([disabled])', { timeout: 300000 });
await page.evaluate(() => document.getElementById('freeBtn').click());
await new Promise(r => setTimeout(r, 30000));
const res = await page.evaluate(() => {
  const g = window.__game, out = { total: 0, reasons: {}, samples: [] };
  g.scene.traverse(o => {
    if (!o.isMesh || o.isInstancedMesh || !o.material || Array.isArray(o.material)) return;
    if (!/^Foods_|^Shelf_|cardboard/.test(o.material.name || '')) return;
    if (o.name === 'static-batch') return;
    out.total++;
    let r = 'batchable?';
    if (o.userData.noBatch) r = 'noBatch';
    else if (o.matrixWorld.determinant() < 0) r = 'mirrored';
    else { let p = o; while (p) { if (!p.visible) { r = 'hidden ancestor: ' + (p.name || p.type); break; } p = p.parent; }
      if (r === 'batchable?') { let top = o; while (top.parent && top.parent !== g.scene) top = top.parent; r = 'visible; scene child: ' + (top.name || top.type) + (o.parent === g.scene ? ' (direct)' : ''); } }
    out.reasons[r] = (out.reasons[r] || 0) + 1;
    if (out.samples.length < 4) out.samples.push([o.name, o.material.name, r]);
  });
  return out;
});
console.log(JSON.stringify(res, null, 1));
await browser.close();
