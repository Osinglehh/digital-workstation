import { chromium } from 'playwright-core';
import fs from 'node:fs';

const exe = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const browser = await chromium.launch({
  executablePath: exe,
  headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1200, height: 900 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

const waitApp = () => page.waitForFunction(
  () => window.__workstation
    && typeof window.__workstation.getUiState === 'function'
    && document.querySelector('.dock-group'),
  null,
  { timeout: 90000 },
);

await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle' });
await waitApp();
await page.waitForTimeout(1200);

const openSection = async (name) => {
  const button = page.getByRole('button', { name, exact: true });
  if (await button.getAttribute('aria-expanded') !== 'true') await button.click();
};
const closeSection = async (name) => {
  const button = page.getByRole('button', { name, exact: true });
  if (await button.getAttribute('aria-expanded') === 'true') await button.click();
};

const initial = await page.evaluate(() => ({
  state: window.__workstation.root.userData.animation.getState(),
  ui: window.__workstation.getUiState(),
  designTree: (() => {
    const rect = document.querySelector('.design-tree')?.getBoundingClientRect();
    return rect ? { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width) } : null;
  })(),
}));

// --- 设计树：整体折叠 / 展开 ------------------------------------------------
await page.locator('.tree-collapse').click();
const treeCollapsed = await page.locator('.tree-body').isHidden();
await page.locator('.tree-collapse').click();
const treeExpanded = await page.locator('.tree-body').isVisible();
if (!treeCollapsed || !treeExpanded) throw new Error('设计树整体折叠/展开失败');

// --- 设计树：按住顶栏拖动，再拖回原位 ----------------------------------------
const treeStart = await page.evaluate(() => {
  const rect = document.querySelector('.design-tree').getBoundingClientRect();
  return { x: rect.x, y: rect.y };
});
const headGrabPoint = async () => {
  const box = await page.locator('.tree-head').boundingBox();
  return { x: box.x + 30, y: box.y + box.height / 2 };
};
const dragStart = await headGrabPoint();
await page.mouse.move(dragStart.x, dragStart.y);
await page.mouse.down();
await page.mouse.move(dragStart.x + 150, dragStart.y + 140, { steps: 10 });
await page.mouse.up();
const treeMoved = await page.evaluate(() => {
  const rect = document.querySelector('.design-tree').getBoundingClientRect();
  return { x: rect.x, y: rect.y };
});
if (treeMoved.x < treeStart.x + 100 || treeMoved.y < treeStart.y + 90) {
  throw new Error('按住顶栏拖动设计树失败');
}
const dragBack = await headGrabPoint();
await page.mouse.move(dragBack.x, dragBack.y);
await page.mouse.down();
await page.mouse.move(
  dragBack.x - (treeMoved.x - treeStart.x),
  dragBack.y - (treeMoved.y - treeStart.y),
  { steps: 10 },
);
await page.mouse.up();
const treeRestored = await page.evaluate(() => {
  const rect = document.querySelector('.design-tree').getBoundingClientRect();
  return { x: rect.x, y: rect.y };
});
if (Math.abs(treeRestored.x - treeStart.x) > 1 || Math.abs(treeRestored.y - treeStart.y) > 1) {
  throw new Error('设计树未能拖回初始位置');
}

// --- 笔记本开合（通过设计树里的物体检查器） ----------------------------------
await openSection('物品');
await page.locator('[data-object="laptop"]').click();
await page.waitForTimeout(250);
const inspectorInTree = await page.locator('.object-inspector').evaluate((el) => Boolean(el.closest('.design-tree')));
if (!inspectorInTree) throw new Error('物体检查器没有挂到设计树');
await page.getByRole('button', { name: '合上上盖', exact: true }).click();
await page.waitForFunction(
  () => window.__workstation.root.userData.animation.getState().lidClosed > 0.999,
  null,
  { timeout: 30000 },
);
const closed = await page.evaluate(() => window.__workstation.root.userData.animation.getState());
if (closed.lidClosed < 0.999 || Math.abs(closed.lidAngleDeg) > 0.05) throw new Error('笔记本未完全闭合');
await page.evaluate(() => window.__workstation.selectObject(null));
const closedShot = await page.evaluate(() => window.__workstation.capture('front'));
fs.writeFileSync('analysis/renders/lid-closed.png', Buffer.from(closedShot.split(',')[1], 'base64'));

await openSection('物品');
await page.locator('[data-object="laptop"]').click();
await page.waitForTimeout(250);
await page.getByRole('button', { name: '打开上盖', exact: true }).click();
await page.waitForFunction(
  () => window.__workstation.root.userData.animation.getState().lidClosed < 0.001,
  null,
  { timeout: 30000 },
);
const opened = await page.evaluate(() => window.__workstation.root.userData.animation.getState());
await page.evaluate(() => window.__workstation.selectObject(null));

// --- 键盘 RGB 与屏幕开关 ----------------------------------------------------
await openSection('灯光');
await page.getByRole('switch', { name: '键盘 RGB' }).click();
await page.waitForTimeout(250);
const rgbOff = await page.evaluate(() => window.__workstation.root.userData.animation.getState());
await page.getByRole('button', { name: '单色', exact: true }).click();
await page.getByRole('button', { name: '青键盘灯', exact: true }).click();
await page.waitForTimeout(250);
const rgb = await page.evaluate(() => window.__workstation.root.userData.animation.getState());
await page.getByRole('button', { name: '彩虹', exact: true }).click();
await closeSection('灯光');

await openSection('物品');
await page.locator('[data-object="monitor"]').click();
await page.waitForTimeout(250);
await page.getByRole('button', { name: '关闭屏幕', exact: true }).click();
await page.waitForTimeout(250);
const screensOff = await page.evaluate(() => window.__workstation.root.userData.animation.getState());
await page.getByRole('button', { name: '打开屏幕', exact: true }).click();
await page.waitForTimeout(250);
await page.evaluate(() => window.__workstation.selectObject(null));

// --- 场景预设（含夜间图证据） ----------------------------------------------
await openSection('场景');
await page.locator('[data-scene="night"]').click();
await page.waitForTimeout(700);
const night = await page.evaluate(() => ({
  ui: window.__workstation.getUiState(),
  theme: document.documentElement.dataset.theme,
  state: window.__workstation.root.userData.animation.getState(),
}));
const nightShot = await page.evaluate(() => window.__workstation.capture('front'));
fs.writeFileSync('analysis/renders/night-mode.png', Buffer.from(nightShot.split(',')[1], 'base64'));
await page.locator('[data-scene="day"]').click();
await page.waitForTimeout(500);
await closeSection('场景');

// --- 视角切换与自动环绕 ------------------------------------------------------
await openSection('视角');
await page.getByRole('button', { name: '自动环绕', exact: true }).click();
const orbit = await page.evaluate(async () => {
  const ws = window.__workstation;
  const start = ws.camera.position.clone();
  const deadline = Date.now() + 15000;
  let delta = 0;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 300));
    delta = ws.camera.position.distanceTo(start);
    if (ws.getUiState().autoOrbit && delta > 0.01) break;
  }
  return { autoOrbit: ws.getUiState().autoOrbit, moved: delta > 0.01, delta };
});
await page.getByRole('button', { name: '暂停环绕', exact: true }).click();
await page.locator('[data-view="firstPerson"]').click();
await page.waitForFunction(() => {
  const ws = window.__workstation;
  return ws.currentView() === 'firstPerson' && ws.camera.position.z < 1.2;
}, null, { timeout: 30000 });
const view = await page.evaluate(() => ({
  name: window.__workstation.currentView(),
  camera: window.__workstation.camera.position.toArray(),
  status: document.querySelector('.tree-status-text')?.textContent,
}));
await closeSection('视角');

// --- 显示器旋转 / 倾斜（沿用既有阈值，无头环境需要更长等待） -----------------
await page.evaluate(() => {
  const api = window.__workstation.root.userData.animation;
  api.panMonitor(8);
  api.tiltMonitor(-3);
  api.pressKey(12, 2.4);
  setTimeout(() => api.releaseKey(12), 300);
  api.moveMouse(0.02, -0.01);
});
await page.waitForFunction(() => {
  const state = window.__workstation.root.userData.animation.getState();
  return state.monitorPanDeg > 7 && state.monitorTiltDeg < -2.5;
}, null, { timeout: 45000 });
const moved = await page.evaluate(() => window.__workstation.root.userData.animation.getState());
const orbitShot = await page.evaluate(() => window.__workstation.capture('right'));
fs.writeFileSync('analysis/renders/monitor-pan.png', Buffer.from(orbitShot.split(',')[1], 'base64'));

// --- 椅子 API（低帧率下只要求明显向目标移动） -------------------------------
const chair = await page.evaluate(async () => {
  const api = window.__workstation.root.userData.animation;
  api.swivelChair(18);
  api.reclineChair(12);
  const deadline = Date.now() + 20000;
  let state = api.getState();
  while (Date.now() < deadline && (state.chairYawDeg < 10 || state.chairReclineDeg < 8)) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    state = api.getState();
  }
  return state;
});
await page.evaluate(() => {
  const api = window.__workstation.root.userData.animation;
  api.swivelChair(0);
  api.reclineChair(0);
});

// --- 偏好持久化 --------------------------------------------------------------
await page.evaluate(() => {
  const ws = window.__workstation;
  ws.setScene('night');
  ws.setView('default');
});
await page.waitForTimeout(800);
await page.evaluate(() => { window.__beforeReload = true; });
await page.reload({ waitUntil: 'networkidle' });
await page.waitForFunction(
  () => !window.__beforeReload
    && window.__workstation
    && typeof window.__workstation.getUiState === 'function',
  null,
  { timeout: 90000 },
);
await page.waitForTimeout(1200);
const persisted = await page.evaluate(() => ({
  ui: window.__workstation.getUiState(),
  view: window.__workstation.currentView(),
  theme: document.documentElement.dataset.theme,
}));

const result = {
  initial,
  treeCollapsed,
  treeExpanded,
  treeDrag: { before: treeStart, moved: treeMoved, restored: treeRestored },
  closed,
  opened,
  rgbOff,
  rgb,
  screensOff,
  night,
  orbit,
  view,
  moved,
  chair,
  persisted,
  errors,
};
fs.writeFileSync('analysis/renders/interaction-test.json', JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
await browser.close();
