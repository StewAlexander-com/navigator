// Street-sign render check (v0.1.38): renders the app's signpost blades (tests/sign-render.html, Vite dev server) from
// every direction at several distances in headless Chromium and fails if a blade is missing, edge-on or unreadable.
import {createServer} from 'vite';
import {launchTestBrowser} from './test-browser.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const server = await createServer({server: {host: '127.0.0.1', port: 4181, strictPort: true}, logLevel: 'error'});
await server.listen();
const browser = await launchTestBrowser(), page = await (await browser.newContext({viewport: {width: 390, height: 844}})).newPage();
const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('console', m => m.type() === 'error' && errors.push(m.text()));
try {
  await page.goto('http://127.0.0.1:4181/navigator/tests/sign-render.html');
  await page.waitForFunction(() => window.signReady, null, {timeout: 30000});
  // Every 5°, which includes looking exactly along each street (0°, 90°, 180°, 270°) and the diagonals.
  const angles = Array.from({length: 72}, (_, i) => i * 5), distances = [6, 12, 25, 45, 80];
  const views = await page.evaluate(([a, d]) => window.signViews(a, d), [angles, distances]);
  await fs.mkdir('test-results', {recursive: true});
  const sheet = await page.evaluate(([a, d]) => window.signSheet(a, d), [[0, 1, 30, 45, 60, 90, 135, 180, 270], [6, 12, 25, 80]]);
  await fs.writeFile('test-results/sign-angles.png', Buffer.from(sheet.split(',')[1], 'base64'));
  if (process.env.DEBUG) console.log(JSON.stringify(views.filter(v => v.angle % 45 === 0 || v.angle % 90 < 6).map(v => [v.angle, v.distance, +v.ratio.toFixed(2), +(v.bright / v.blade).toFixed(2)])));
  const worst = views.reduce((w, v) => v.ratio < w.ratio ? v : w);
  for (const v of views) {
    assert.ok(v.ratio >= .5, `${v.angle}° at ${v.distance} m: ${v.blade} blade px, ${Math.round(v.ratio * 100)} % of face-on`);
    assert.ok(v.bright >= v.blade * .02, `${v.angle}° at ${v.distance} m: only ${v.bright} lettering px of ${v.blade}`);
  }
  assert.deepEqual(errors, []);
  const byDistance = Object.fromEntries(distances.map(d => [d, +Math.min(...views.filter(v => v.distance === d).map(v => v.ratio)).toFixed(2)]));
  const alongStreets = views.filter(v => v.angle % 90 === 0).map(v => [v.angle, v.distance, +v.ratio.toFixed(2)]);
  console.log(JSON.stringify({views: views.length, byDistance, alongStreets, worst: {angle: worst.angle, distance: worst.distance, ratio: +worst.ratio.toFixed(2)}, sheet: 'test-results/sign-angles.png'}));
} finally {await browser.close(); await server.close();}
