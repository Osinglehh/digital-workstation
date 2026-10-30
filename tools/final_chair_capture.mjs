import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

// 椅子与头枕的最终验收机位；输出统一写到 analysis/renders/final/。
const shots = [
  ['final-chair-back.png', 0, 8, 1.85, [0, 0.66, 0.45]],
  ['final-chair-side.png', 90, 8, 1.75, [0, 0.62, 0.30]],
  ['final-chair-left.png', 270, 8, 1.90, [0, 0.62, 0.40]],
  ['final-chair-front34.png', 32, 14, 2.0, [0, 0.60, 0.25]],
  ['final-chair-low.png', 68, 2, 2.0, [0, 0.60, 0.40]],
  ['final-scene-wide.png', 0, 8, 2.7, [0, 0.95, 0.05]],
  ['final-chair-head-front.png', 180, 4, 0.80, [0, 1.12, 0.82]],
  ['final-chair-head-back.png', 0, 4, 0.80, [0, 1.12, 0.82]],
];

const outDir = path.resolve('analysis/renders/final');
fs.mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-sandbox', '--hide-scrollbars'],
});
const page = await browser.newPage({ viewport: { width: 1200, height: 900 }, deviceScaleFactor: 1 });
await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForFunction(() => Boolean(window.__workstation), null, { timeout: 60000 });
await page.waitForFunction(() => document.getElementById('boot')?.hidden === true, null, { timeout: 120000 });
await page.waitForTimeout(1800);
for (const [file, az, el, dist, target] of shots) {
  const dataUrl = await page.evaluate((pose) =>
    window.__workstation.setOrbit(pose.az, pose.el, pose.dist, pose.target), { az, el, dist, target });
  const pngPath = path.join(outDir, file);
  fs.writeFileSync(pngPath, Buffer.from(dataUrl.split(',')[1], 'base64'));
  console.log(pngPath);
}
await browser.close();
