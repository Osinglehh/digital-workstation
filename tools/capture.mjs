import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

const view = process.argv[2] || 'front';
const label = process.argv[3] || `blockout-${view}`;
const viewportArg = process.argv[4] || '1200x900';
const [width, height] = viewportArg.split('x').map(Number);
const outDir = path.resolve('analysis/renders');
fs.mkdirSync(outDir, { recursive: true });

const candidates = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
];
const executablePath = candidates.find((p) => fs.existsSync(p));
if (!executablePath) throw new Error('No Edge/Chrome executable found');

const browser = await chromium.launch({
  executablePath,
  headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-sandbox', '--hide-scrollbars'],
});
const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
const logs = [];
page.on('console', (msg) => logs.push(`${msg.type()}: ${msg.text()}`));
page.on('pageerror', (err) => logs.push(`pageerror: ${err.message}`));
await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForFunction(() => Boolean(window.__workstation), null, { timeout: 60000 });
await page.waitForFunction(() => document.getElementById('boot')?.hidden === true, null, { timeout: 120000 });
await page.waitForTimeout(2200);

const dataUrl = await page.evaluate((v) => window.__workstation.capture(v), view);
const base64 = dataUrl.split(',')[1];
const pngPath = path.join(outDir, `${label}.png`);
fs.writeFileSync(pngPath, Buffer.from(base64, 'base64'));

const pagePath = path.join(outDir, `${label}-page.png`);
await page.screenshot({ path: pagePath, fullPage: false });

const names = await page.evaluate(() => window.__workstation.objectNames());
const statePath = path.join(outDir, `${label}-state.json`);
fs.writeFileSync(statePath, JSON.stringify({ view, viewport: [width, height], executablePath, logs, objectCount: names.length, names }, null, 2));
console.log(JSON.stringify({ pngPath, pagePath, statePath, logs: logs.slice(0, 20) }, null, 2));
await browser.close();
