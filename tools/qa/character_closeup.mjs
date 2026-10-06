// Close-up lineup of people (front, 3/4, back) rendered with our own camera, for judging faces, hair, hands and clothing.
//   node serve.mjs 8899 ; node tools/qa/character_closeup.mjs [prefix] [types,comma,separated]   -> <prefix>-front|three|back.png
import puppeteer from 'puppeteer';
import { autoAcknowledge } from './lib/agegate.mjs';
import fs from 'node:fs';
const out = process.argv[2] || 'tools/qa/out/closeup';
const types = (process.argv[3] || 'hoodrat,redneck,suit,tourist,prostitute,dockworker,mechanic,tuxedo').split(',');
const browser = await puppeteer.launch({ protocolTimeout: 300000, args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--mute-audio'] });
const page = await browser.newPage();
await autoAcknowledge(page); const errs = []; page.on('pageerror', e => errs.push(e.message));
await page.setViewport({ width: 1600, height: 700 });
await page.goto('http://localhost:8899/', { waitUntil: 'domcontentloaded', timeout: 90000 });
await page.waitForSelector('#freeBtn:not([disabled])', { timeout: 300000 });
await page.evaluate(() => document.getElementById('freeBtn').click());
await new Promise(r => setTimeout(r, 6000));
await page.evaluate((types) => {
  const g = window.__game, T = g.THREE;
  g.worldTime.setTime(13); g.state.cinematic = false;
  const Y = 400, X0 = 0;                                                 // up in the sky: a plain stage, no buildings
  const floor = new T.Mesh(new T.PlaneGeometry(80, 40), new T.MeshBasicMaterial({ color: 0x7c8468 })); floor.rotation.x = -Math.PI / 2; floor.position.set(X0 + 10, Y - 0.02, 0); g.scene.add(floor);
  g.scene.add(new T.HemisphereLight(0xffffff, 0x8a8a80, 2.2));
  const sun = new T.DirectionalLight(0xfff2dd, 2.4); sun.position.set(8, Y + 14, 10); sun.target.position.set(X0 + 8, Y, 0); g.scene.add(sun, sun.target);
  window.__cl = types.map((t, i) => { const e = g.spawnEnemy(t, X0 + i * 2.2, 0); e.state = 'lab'; e.spr.rotation.y = 0; e.spr._yaw = 0; e.spr.baseY = Y; e.spr.position.y = Y; e.spr.play('idle', { force: true }); return e; });
  window.__Y = Y;
}, types);
await new Promise(r => setTimeout(r, 3000));
const views = [['front', 0], ['three', 0.75], ['back', Math.PI]];
for (const [name, ang] of views) {
  const url = await page.evaluate((ang, n) => {
    const g = window.__game, T = g.THREE, Y = window.__Y;
    for (const e of window.__cl) { e.spr.rotation.y = 0; e.spr._yaw = 0; e.spr.position.y = Y; e.state = 'lab'; e.spr.update && e.spr.update(0.016); }
    const cam = new T.PerspectiveCamera(24, 1600 / 700, 0.1, 200);
    const cx = (n - 1) * 1.1, r = Math.max(9, n * 1.9), tx = cx, tz = 0;
    cam.position.set(tx + Math.sin(ang) * r, Y + 1.35, tz + Math.cos(ang) * r); cam.lookAt(tx, Y + 1.05, tz);
    const gl = g.renderer; gl.render(g.scene, cam); return gl.domElement.toDataURL('image/png');
  }, ang, types.length);
  fs.writeFileSync(`${out}-${name}.png`, Buffer.from(url.split(',')[1], 'base64'));
}
console.log('errors', errs.slice(0, 4));
await browser.close();
