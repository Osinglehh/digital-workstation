import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
const exe = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const browser = await chromium.launch({ executablePath: exe, headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1000, height: 1000 }, deviceScaleFactor: 1 });
await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__workstation);
await page.waitForTimeout(1200);
const outDir = path.resolve('analysis/renders');
fs.mkdirSync(outDir, { recursive: true });
const captures = [];
for (const az of [0, 90, 180, 270]) {
  const dataUrl = await page.evaluate((a) => window.__workstation.setOrbit(a, 8, 2.15, [0, 1.12, 0]), az);
  const p = path.join(outDir, `turntable-${az}.png`);
  fs.writeFileSync(p, Buffer.from(dataUrl.split(',')[1], 'base64'));
  captures.push(p);
}
console.log(JSON.stringify({ captures }, null, 2));
await browser.close();
