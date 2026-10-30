import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

const [label = 'orbit', az = '0', el = '10', dist = '0.6', tx = '0.16', ty = '0.88', tz = '0.05'] =
  process.argv.slice(2);
const outDir = path.resolve('analysis/renders');
fs.mkdirSync(outDir, { recursive: true });
const executablePath = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';

const browser = await chromium.launch({
  executablePath,
  headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-sandbox', '--hide-scrollbars'],
});
const page = await browser.newPage({ viewport: { width: 1200, height: 900 }, deviceScaleFactor: 1 });
await page.goto('http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded', timeout: 90000 });
await page.waitForFunction(() => Boolean(window.__workstation), null, { timeout: 90000 });
await page.waitForFunction(() => document.getElementById('boot')?.hidden === true, null, { timeout: 120000 });
await page.waitForTimeout(1800);
const dataUrl = await page.evaluate((pose) =>
  window.__workstation.setOrbit(pose.az, pose.el, pose.dist, pose.target), {
  az: Number(az), el: Number(el), dist: Number(dist), target: [Number(tx), Number(ty), Number(tz)],
});
const pngPath = path.join(outDir, `${label}.png`);
fs.writeFileSync(pngPath, Buffer.from(dataUrl.split(',')[1], 'base64'));
console.log(JSON.stringify({ pngPath }));
await browser.close();
