import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
const exe = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const url = 'http://127.0.0.1:5173/';
const browser = await chromium.launch({ executablePath: exe, headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1200, height: 900 }, deviceScaleFactor: 1 });
const outDir = path.resolve('analysis/renders/final');
fs.mkdirSync(outDir, { recursive: true });
const manifest = { views: {}, underDeskDetail: null, bagDetail: null, referenceFramed: null, clay: null, turntable: [] };

const settle = async () => {
  try {
    await page.waitForFunction(() => window.__workstation, null, { timeout: 8000 });
  } catch {
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.__workstation, null, { timeout: 90000 });
  }
  await page.waitForTimeout(1500);
};
// 拍摄时开发服务器可能触发整页重载（HMR/并发改写），捕获后自动重试并复位场景状态。
const shoot = async (fileName, evaluateShot, arg) => {
  let lastError = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await settle();
      const dataUrl = arg === undefined
        ? await page.evaluate(evaluateShot)
        : await page.evaluate(evaluateShot, arg);
      fs.writeFileSync(path.join(outDir, fileName), Buffer.from(dataUrl.split(',')[1], 'base64'));
      return;
    } catch (error) {
      lastError = error;
      await page.waitForTimeout(800);
    }
  }
  throw lastError;
};

await settle();
const views = ['front', 'under', 'left', 'right', 'overhead', 'keyboard'];
for (const v of views) {
  await shoot(`final-${v}.png`, (name) => window.__workstation.capture(name), v);
  manifest.views[v] = path.join(outDir, `final-${v}.png`);
}
// 桌下细节验收图隐藏椅子，避免椅背遮住线槽和插座；其他视图保持默认场景。
await shoot('final-underdesk.png', () => {
  const chair = window.__workstation.scene.getObjectByName('ergonomic-chair');
  if (chair) chair.visible = false;
  return window.__workstation.setOrbit(0, 6, 1.16, [0, 0.36, -0.10]);
});
manifest.underDeskDetail = { path: path.join(outDir, 'final-underdesk.png'), chairVisible: false, note: '隐藏椅子仅用于检查桌下结构，其余视图保留默认场景。' };
await shoot('final-underdesk-bag.png', () => {
  const chair = window.__workstation.scene.getObjectByName('ergonomic-chair');
  if (chair) chair.visible = false;
  return window.__workstation.setOrbit(-24, 12, 0.78, [-0.34, 0.28, -0.02]);
});
manifest.bagDetail = { path: path.join(outDir, 'final-underdesk-bag.png'), chairVisible: false, note: '书包背面靠左侧板内表面、正面朝桌内（约 5° 倚放）。' };
await shoot('final-reference-framed.png', () => {
  // 参考照片 桌面-4.jpg 坐位视角里看不到椅子；保留隐藏避免椅背挡住键盘。
  const chair = window.__workstation.scene.getObjectByName('ergonomic-chair');
  if (chair) chair.visible = false;
  window.__workstation.setClay(false);
  return window.__workstation.setOrbit(0, 12, 1.22, [0, 0.99, -0.06]);
});
manifest.referenceFramed = { path: path.join(outDir, 'final-reference-framed.png'), chairVisible: false, note: '参考构图：对齐 figure/桌面-4.jpg 的坐位视角，椅子隐藏。' };
await shoot('final-reference-framed-clay.png', () => {
  window.__workstation.setClay(true);
  window.__workstation.setOrbit(0, 12, 1.22, [0, 0.99, -0.06]);
  return window.__workstation.renderer.domElement.toDataURL('image/png');
});
manifest.clay = path.join(outDir, 'final-reference-framed-clay.png');
await page.evaluate(() => window.__workstation.setClay(false)).catch(() => {});
// 1000x1000 turntable for the gate
await page.setViewportSize({ width: 1000, height: 1000 });
await page.waitForTimeout(400);
for (const az of [0, 90, 180, 270]) {
  await shoot(`final-turntable-${az}.png`, (a) => {
    window.__workstation.setClay(false);
    return window.__workstation.setOrbit(a, 8, 1.45, [0, 0.98, -0.04]);
  }, az);
  manifest.turntable.push({ azimuth: az, path: path.join(outDir, `final-turntable-${az}.png`) });
}
fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log(JSON.stringify(manifest, null, 2));
await browser.close();