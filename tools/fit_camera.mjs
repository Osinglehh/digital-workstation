import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
const exe = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const browser = await chromium.launch({ executablePath: exe, headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1200, height: 900 }, deviceScaleFactor: 1 });
await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__workstation);
await page.waitForTimeout(1200);
fs.mkdirSync('analysis/renders/fit', { recursive: true });
for (const d of [1.7, 1.55, 1.4, 1.25, 1.1]) {
  const dataUrl = await page.evaluate((dist) => window.__workstation.setOrbit(0, 7, dist, [0, 1.3, -0.02]), d);
  fs.writeFileSync(path.join('analysis/renders/fit', `front-d${d}.png`), Buffer.from(dataUrl.split(',')[1], 'base64'));
}
console.log('fit captures done');
await browser.close();
