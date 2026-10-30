import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

const exe = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const url = 'http://127.0.0.1:5173/';
const outDir = path.resolve('analysis/renders/final');
fs.mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({
  executablePath: exe,
  headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const manifest = { screens: [], viewport: '1200×900', notes: '页面级截图，包含左上 SolidWorks 风格设计树；画布终图仍由 final_capture.mjs 生成。' };

const waitApp = (page) => page.waitForFunction(
  () => window.__workstation && document.querySelector('.design-tree .dock-group'),
  null,
  { timeout: 90000 },
);
const waitBoot = (page) => page.waitForFunction(
  () => document.getElementById('boot')?.hidden === true,
  null,
  { timeout: 120000 },
);
const waitIntro = (page) => page.waitForFunction(
  () => document.querySelector('.intro-layer') && !document.querySelector('.intro-layer').hidden,
  null,
  { timeout: 30000 },
);
const openSection = async (page, name) => {
  const button = page.getByRole('button', { name, exact: true });
  if (await button.getAttribute('aria-expanded') !== 'true') await button.click();
};
const closeSection = async (page, name) => {
  const button = page.getByRole('button', { name, exact: true });
  if (await button.getAttribute('aria-expanded') === 'true') await button.click();
};
const shot = async (page, name, description) => {
  // 截图前清除焦点并移开鼠标，避免按钮 Tooltip 进入画面。
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });
  await page.mouse.move(1180, 880);
  await page.waitForTimeout(450);
  const file = path.join(outDir, name);
  await page.screenshot({ path: file });
  manifest.screens.push({ file: path.join('analysis/renders/final', name), description });
};

const context = await browser.newContext({ viewport: { width: 1200, height: 900 }, deviceScaleFactor: 1 });
const page = await context.newPage();
await page.goto(`${url}?intro=1`, { waitUntil: 'networkidle' });
await waitApp(page);
await waitBoot(page);
await waitIntro(page);
await page.waitForTimeout(600);

await shot(page, 'final-ui-intro.png', '首访欢迎卡片：一句话介绍、三个操作标签、播放 45 秒导览与介绍片/仓库入口。');
manifest.intro = await page.evaluate(() => {
  const card = document.querySelector('.intro-card');
  const rect = card.getBoundingClientRect();
  return {
    rect: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) },
    title: card.querySelector('.intro-title')?.textContent ?? '',
    lead: card.querySelector('.intro-lead')?.textContent ?? '',
    chips: [...card.querySelectorAll('.intro-chip')].map((n) => n.textContent?.trim() ?? ''),
    links: [...card.querySelectorAll('.intro-link')].map((a) => a.getAttribute('href')),
    seenBefore: localStorage.getItem('workstation-intro-v1'),
  };
});
await page.locator('[data-intro-action="explore"]').click();
await page.waitForTimeout(800);
manifest.introSeenAfterDismiss = await page.evaluate(() => localStorage.getItem('workstation-intro-v1'));

await shot(page, 'final-ui-overview.png', '白天模式主视角：左上设计树（装配体信息、七类节点，含声音与自动展示、状态栏）。');
manifest.designTree = await page.evaluate(() => {
  const rect = document.querySelector('.design-tree')?.getBoundingClientRect();
  return rect
    ? { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) }
    : null;
});

await openSection(page, '视角');
await shot(page, 'final-ui-view.png', '视角节点：11 个机位、自动环绕与恢复默认，树内直接切换。');
await closeSection(page, '视角');

await openSection(page, '物品');
await page.locator('[data-object="monitor"]').click();
await shot(page, 'final-ui-inspector.png', '显示器检查器：作为物品节点下的选中节点显示，含聚焦、亮灭、屏幕内容与选中包络。');
await page.evaluate(() => window.__workstation.selectObject(null));
await closeSection(page, '物品');

await openSection(page, '灯光');
await shot(page, 'final-ui-lighting.png', '灯光节点：主灯、环境光/亮度、RGB 模式与配色。');
await closeSection(page, '灯光');

await openSection(page, '声音');
await shot(page, 'final-ui-audio.png', '声音节点：背景音乐开关、音量滑杆与实时播放状态。');
manifest.music = await page.evaluate(() => window.__workstation.getMusicState());
await closeSection(page, '声音');

await openSection(page, '场景');
await page.locator('[data-scene="night"]').click();
await shot(page, 'final-ui-night.png', '深夜模式：暗色设计树、终端屏幕、呼吸键盘灯与场景节点。');

await openSection(page, '帮助');
await page.getByRole('button', { name: '重新查看欢迎卡片' }).click();
await page.waitForTimeout(500);
await shot(page, 'final-ui-intro-night.png', '深夜模式下的首访欢迎卡片：深色玻璃与浅色文字，帮助节点可随时重开。');
manifest.introNight = await page.evaluate(() => {
  const rect = document.querySelector('.intro-card').getBoundingClientRect();
  return {
    theme: document.documentElement.dataset.theme,
    rect: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) },
  };
});
await page.keyboard.press('Escape');
await page.waitForTimeout(400);
await shot(page, 'final-ui-help.png', '帮助节点：快捷键列表、重新查看欢迎卡片与 GitHub 开源仓库入口。');
manifest.help = await page.evaluate(() => ({
  replayVisible: Boolean(document.querySelector('.help-intro-button')),
  replayText: document.querySelector('.help-intro-button')?.textContent?.trim() ?? '',
  repoHref: document.querySelector('.help-repo-link')?.getAttribute('href') ?? '',
}));
await closeSection(page, '帮助');

await page.locator('[data-scene="day"]').click();
await closeSection(page, '场景');

const rgbShot = await page.evaluate(() => window.__workstation.capture('keyboard'));
fs.writeFileSync(
  path.join(outDir, 'final-keyboard-rgb.png'),
  Buffer.from(rgbShot.split(',')[1], 'base64'),
);
manifest.screens.push({
  file: path.join('analysis/renders/final', 'final-keyboard-rgb.png'),
  description: '键盘 RGB 近景：白色键帽保留，键缝透光、桌面光池与键面染色在彩虹模式下可见。',
});
await context.close();

const mobileContext = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
const mobile = await mobileContext.newPage();
const mobileErrors = [];
mobile.on('pageerror', (error) => mobileErrors.push(String(error)));
mobile.on('console', (message) => {
  if (message.type() === 'error') mobileErrors.push(message.text());
});
mobile.setDefaultTimeout(120000);
await mobile.goto(`${url}?intro=1`, { waitUntil: 'domcontentloaded' });
await waitApp(mobile);
await waitBoot(mobile);
await waitIntro(mobile);
await mobile.waitForTimeout(700);
await mobile.screenshot({ path: path.join(outDir, 'final-ui-mobile-intro.png') });
manifest.screens.push({
  file: path.join('analysis/renders/final', 'final-ui-mobile-intro.png'),
  description: '390×844 窄屏首访欢迎卡片：单列主按钮、完整标签与外链，无横向溢出。',
});
manifest.mobileIntro = await mobile.evaluate(() => {
  const rect = document.querySelector('.intro-card').getBoundingClientRect();
  return {
    rect: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) },
    viewportWidth: window.innerWidth,
    bodyScrollWidth: document.body.scrollWidth,
  };
});
await mobile.locator('[data-intro-action="explore"]').click();
await mobile.waitForTimeout(900);
await mobile.screenshot({ path: path.join(outDir, 'final-ui-mobile.png') });
manifest.screens.push({
  file: path.join('analysis/renders/final', 'final-ui-mobile.png'),
  description: '390×844 窄屏：左上设计树，场景仍保留下半屏可见。',
});
await openSection(mobile, '视角');
await mobile.waitForTimeout(450);
await mobile.screenshot({ path: path.join(outDir, 'final-ui-mobile-panel.png') });
manifest.screens.push({
  file: path.join('analysis/renders/final', 'final-ui-mobile-panel.png'),
  description: '390×844 窄屏视角节点：机位列表与树内滚动，无横向溢出。',
});
await closeSection(mobile, '视角');
await openSection(mobile, '物品');
await mobile.locator('[data-object="monitor"]').click();
await mobile.waitForTimeout(450);
await mobile.screenshot({ path: path.join(outDir, 'final-ui-mobile-inspector.png') });
manifest.screens.push({
  file: path.join('analysis/renders/final', 'final-ui-mobile-inspector.png'),
  description: '390×844 窄屏物体检查器：显示器操作节点嵌在物品树下，完整可见。',
});
manifest.mobileOverflow = await mobile.evaluate(() => ({
  bodyScrollWidth: document.body.scrollWidth,
  viewportWidth: window.innerWidth,
  inspectorWidth: Math.round(document.querySelector('.object-inspector')?.getBoundingClientRect().width ?? 0),
  treeWidth: Math.round(document.querySelector('.design-tree')?.getBoundingClientRect().width ?? 0),
  inspectorInsideTree: Boolean(document.querySelector('.object-inspector')?.closest('.design-tree')),
}));
manifest.mobileErrors = mobileErrors;
await mobileContext.close();

manifest.mobileViewport = '390×844';
fs.writeFileSync(path.join(outDir, 'ui-manifest.json'), JSON.stringify(manifest, null, 2));
console.log(JSON.stringify(manifest, null, 2));
await browser.close();
