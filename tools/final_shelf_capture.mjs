// 桌顶格架专项终图：正面、左右 3/4、书列近景、陈设近景与俯视。
// 运行前提：dev server 已在 http://127.0.0.1:5173/ 运行。
// 用法：node tools/final_shelf_capture.mjs
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

const browser = await chromium.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1200, height: 900 }, deviceScaleFactor: 1 });
await page.goto('http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded', timeout: 90000 });
await page.waitForFunction(() => window.__workstation, null, { timeout: 90000 });
await page.waitForTimeout(2500);

const outDir = path.resolve('analysis/renders/final');
fs.mkdirSync(outDir, { recursive: true });
const shots = [
  { file: 'final-shelf-front.png', orbit: [0, 5, 1.45, [0, 1.52, -0.15]] },
  { file: 'final-shelf-left34.png', orbit: [-24, 7, 1.05, [0, 1.50, -0.15]] },
  { file: 'final-shelf-right34.png', orbit: [24, 7, 1.05, [0, 1.50, -0.15]] },
  { file: 'final-shelf-books.png', orbit: [-14, 4, 0.72, [-0.23, 1.50, -0.16]] },
  { file: 'final-shelf-props.png', orbit: [10, 4, 0.72, [0.28, 1.48, -0.16]] },
  { file: 'final-shelf-top.png', orbit: [8, 32, 0.95, [0, 1.55, -0.15]] },
];
const manifest = {
  reference: ['figure/桌顶架子-1.jpg', 'figure/桌顶架子-2.jpg', 'figure/桌顶架子-3.jpg'],
  note: '桌顶格架专项图；默认场景完整可见，不隐藏椅子或其他物件。',
  shots: {},
};
for (const shot of shots) {
  const dataUrl = await page.evaluate((orbit) =>
    window.__workstation.setOrbit(orbit[0], orbit[1], orbit[2], orbit[3]), shot.orbit);
  const filePath = path.join(outDir, shot.file);
  fs.writeFileSync(filePath, Buffer.from(dataUrl.split(',')[1], 'base64'));
  manifest.shots[shot.file] = { path: filePath, orbit: shot.orbit };
}
fs.writeFileSync(path.join(outDir, 'shelf-manifest.json'), JSON.stringify(manifest, null, 2));
console.log(JSON.stringify(manifest, null, 2));
await browser.close();
