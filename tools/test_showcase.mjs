import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

const exe = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const url = 'http://127.0.0.1:5173/';
const outDir = path.resolve('analysis/renders/final');
const reportPath = path.resolve('analysis/renders/showcase-test.json');
fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({
  executablePath: exe,
  headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1200, height: 900 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
page.setDefaultTimeout(120000);

const checks = [];
const check = (name, ok, detail = '') => {
  checks.push({ name, ok: Boolean(ok), detail });
  if (!ok) throw new Error(`check failed: ${name} ${detail}`);
};
const shot = async (file, description) => {
  await page.mouse.move(1030, 800);
  await page.waitForTimeout(320);
  await page.screenshot({ path: path.join(outDir, file) });
  return { file: path.join('analysis/renders/final', file), description };
};
const openSection = async (name) => {
  const button = page.getByRole('button', { name, exact: true });
  if (await button.getAttribute('aria-expanded') !== 'true') await button.click();
};
const closeSection = async (name) => {
  const button = page.getByRole('button', { name, exact: true });
  if (await button.getAttribute('aria-expanded') === 'true') await button.click();
};
const state = () => page.evaluate(() => window.__workstation.showcase.getState());
const inner = () => page.evaluate(() => window.__workstation.root.userData.animation.getState());
const ui = () => page.evaluate(() => window.__workstation.getUiState());

try {
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForFunction(
    () => window.__workstation && typeof window.__workstation.showcase?.start === 'function',
    null,
    { timeout: 90000 },
  );
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(
    () => window.__workstation && typeof window.__workstation.showcase?.start === 'function',
    null,
    { timeout: 90000 },
  );
  await page.waitForTimeout(1400);

  await openSection('自动展示');
  const nodeVisible = await page.locator('.showcase-primary').isVisible();
  check('showcase-node-visible', nodeVisible);
  const idle = await state();
  check('idle-status', idle.status === 'idle');
  check('idle-active', idle.active === false);
  const uiShot = await shot('final-showcase-idle.png', '自动展示节点：待机、45 秒进度、开始展示与展示时隐藏设计树选项。');
  await closeSection('自动展示');

  // 非默认基线：退出展示后必须完整恢复这些状态。
  await page.evaluate(() => {
    const w = window.__workstation;
    w.setScene('night');
    w.setView('left');
    w.setKeyboardRgb('static');
    w.setKeyboardRgbColor('#FFD9A0');
    w.setScreenContent('code');
  });
  await openSection('物品');
  await page.locator('[data-object="laptop"]').click();
  await page.getByRole('button', { name: '合上上盖', exact: true }).click();
  await page.waitForFunction(
    () => window.__workstation.root.userData.animation.getState().lidClosed > 0.999,
    null,
    { timeout: 30000 },
  );
  await page.evaluate(() => window.__workstation.selectObject(null));
  await closeSection('物品');
  const baseline = await page.evaluate(() => ({
    ui: window.__workstation.getUiState(),
    camera: {
      position: window.__workstation.camera.position.toArray(),
      target: window.__workstation.controls.target.toArray(),
      fov: window.__workstation.camera.fov,
    },
  }));
  check('baseline-scene', baseline.ui.scene === 'night', JSON.stringify(baseline.ui.scene));
  check('baseline-lid', baseline.ui.lidClosed === true);

  await openSection('自动展示');
  const hideSwitch = page.getByRole('switch', { name: '展示时隐藏设计树' });
  check('hide-on-start-default', (await hideSwitch.getAttribute('aria-checked')) === 'false');
  await hideSwitch.click();
  await page.waitForFunction(
    () => document.querySelector('[role="switch"][aria-label="展示时隐藏设计树"]')?.getAttribute('aria-checked') === 'true',
    null,
    { timeout: 5000 },
  );
  check('hide-on-start-toggle-on', (await hideSwitch.getAttribute('aria-checked')) === 'true');
  await hideSwitch.click();
  await page.waitForFunction(
    () => document.querySelector('[role="switch"][aria-label="展示时隐藏设计树"]')?.getAttribute('aria-checked') === 'false',
    null,
    { timeout: 5000 },
  );
  check('hide-on-start-toggle-off', (await hideSwitch.getAttribute('aria-checked')) === 'false');

  await page.getByRole('button', { name: '开始展示', exact: true }).click();
  await page.waitForFunction(() => window.__workstation.showcase.getState().status === 'playing', null, { timeout: 10000 });
  const started = await state();
  const afterStart = await page.evaluate(() => ({
    controlsEnabled: window.__workstation.controls.enabled,
    sectionExpanded: document.querySelector('[aria-controls="ws-section-showcase"]')?.getAttribute('aria-expanded'),
  }));
  check('start-playing', started.status === 'playing' && started.active === true);
  check('start-chapter', started.chapterIndex === 0 && started.elapsed < 1.5, JSON.stringify(started));
  check('start-total', started.total === 45, String(started.total));
  check('start-controls-locked', afterStart.controlsEnabled === false);
  check('start-section-still-open', afterStart.sectionExpanded === 'true');

  // 开场标题 + 远景构图 + 底部实时字幕。
  await page.evaluate(() => {
    window.__workstation.showcase.setUiHidden(true);
    window.__workstation.showcase.seek(3.8);
    window.__workstation.showcase.pause();
  });
  await page.waitForTimeout(1000);
  const opening = await state();
  check('opening-caption', opening.caption === 'intro');
  const liveOpening = await page.evaluate(() => ({
    text: document.querySelector('.showcase-live')?.textContent ?? '',
    visible: document.querySelector('.showcase-live')?.classList.contains('is-visible') === true,
  }));
  check('live-subtitle-visible', liveOpening.visible && liveOpening.text.includes('整体亮相'),
    JSON.stringify(liveOpening));
  const openingShot = await shot('final-showcase-opening.png', '第一幕整体亮相：远景推进、开场标题与底部功能字幕。');
  await page.evaluate(() => window.__workstation.showcase.setUiHidden(false));
  await page.evaluate(() => window.__workstation.showcase.resume());

  // 播放期间手动视角必须被锁定，不能与时间线争夺相机。
  await openSection('视角');
  await page.locator('[data-view="front"]').click();
  await page.waitForTimeout(250);
  const toastText = await page.locator('.toast').textContent();
  check('manual-view-locked', String(toastText).includes('展示进行中'), String(toastText));
  await closeSection('视角');

  // 整棵树折叠不得中断演示。
  await page.locator('.tree-collapse').click();
  const treeCollapsed = await page.locator('.tree-body').isHidden();
  await page.waitForTimeout(700);
  const whileCollapsed = await state();
  check('tree-collapse-keeps-playing', treeCollapsed && whileCollapsed.status === 'playing');
  await page.locator('.tree-collapse').click();

  // 暂停必须冻结时间线与设备动画；继续从同一位置接续。
  await page.evaluate(() => window.__workstation.showcase.seek(17));
  await page.evaluate(() => window.__workstation.showcase.pause());
  const paused = await state();
  const pausedInner = await inner();
  await page.waitForTimeout(900);
  const pausedLater = await state();
  check('pause-status', paused.status === 'paused' && pausedLater.status === 'paused');
  check('pause-time-frozen', Math.abs(pausedLater.elapsed - paused.elapsed) < 0.01,
    `${paused.elapsed} -> ${pausedLater.elapsed}`);
  check('pause-devices-frozen', pausedInner.animationsPaused === true);
  const livePaused = await page.locator('.showcase-live').textContent();
  check('live-subtitle-tracks-feature', String(livePaused).includes('AOC 显示器'), String(livePaused));
  const pausedShot = await shot('final-showcase-controls.png', '暂停状态：章节、真实进度、设备冻结、底部功能字幕与播放控制。');

  await page.evaluate(() => window.__workstation.showcase.resume());
  const resumeStart = (await state()).elapsed;
  await page.waitForFunction(
    (t) => window.__workstation.showcase.getState().elapsed > t + 0.02,
    resumeStart,
    { timeout: 15000 },
  );
  const resumed = await state();
  check('resume-continues', resumed.status === 'playing' && resumed.elapsed > resumeStart,
    `${resumeStart} -> ${resumed.elapsed}`);

  // 下一章节：从当前幕跳到下一幕起点，不重置整场演示。
  await page.evaluate(() => window.__workstation.showcase.pause());
  const beforeNext = await state();
  await page.evaluate(() => window.__workstation.showcase.next());
  const afterNext = await state();
  check('next-chapter', afterNext.chapterIndex === beforeNext.chapterIndex + 1,
    `${beforeNext.chapterIndex} -> ${afterNext.chapterIndex}`);
  check('next-chapter-start', Math.abs(afterNext.elapsed - afterNext.chapterStart) < 0.05,
    `${afterNext.elapsed} vs ${afterNext.chapterStart}`);
  check('next-keeps-pause', afterNext.status === 'paused');
  const nextChapterLabel = await page.locator('.showcase-chapter').textContent();
  check('next-updates-tree', String(nextChapterLabel).includes('04 / 07'), String(nextChapterLabel));

  // 隐藏控件栏不停止演示；恢复后进度不重置。
  await page.evaluate(() => window.__workstation.showcase.resume());
  await page.waitForTimeout(300);
  await page.evaluate(() => window.__workstation.showcase.setUiHidden(true));
  const hiddenUi = await page.evaluate(() => ({
    treeHidden: document.querySelector('.design-tree')?.classList.contains('is-hidden'),
    restoreVisible: !document.querySelector('.tree-restore')?.hidden,
    state: window.__workstation.showcase.getState(),
  }));
  check('hide-tree', hiddenUi.treeHidden && hiddenUi.restoreVisible);
  const hiddenStart = hiddenUi.state.elapsed;
  await page.waitForFunction(
    (t) => window.__workstation.showcase.getState().elapsed > t + 0.02,
    hiddenStart,
    { timeout: 15000 },
  );
  const hiddenNatural = await state();
  check('hide-keeps-playing', hiddenNatural.status === 'playing' && hiddenNatural.elapsed > hiddenStart,
    `${hiddenStart} -> ${hiddenNatural.elapsed}`);
  await page.evaluate(() => window.__workstation.showcase.seek(24));
  await page.waitForTimeout(700);
  const hiddenLater = await state();
  check('hide-seek-progress', hiddenLater.elapsed >= 24, String(hiddenLater.elapsed));
  await page.locator('.tree-restore').click();
  const restoredUi = await page.evaluate(() => ({
    treeHidden: document.querySelector('.design-tree')?.classList.contains('is-hidden'),
    state: window.__workstation.showcase.getState(),
  }));
  check('restore-tree', restoredUi.treeHidden === false);
  check('restore-keeps-progress', restoredUi.state.active === true && restoredUi.state.elapsed >= 24,
    JSON.stringify(restoredUi.state));

  // 设备互动：合盖后截图（真实开合动画）。
  await page.evaluate(() => {
    window.__workstation.showcase.seek(22.4);
    window.__workstation.showcase.resume();
  });
  await page.waitForFunction(
    () => window.__workstation.root.userData.animation.getState().lidClosed > 0.95,
    null,
    { timeout: 30000 },
  );
  await page.evaluate(() => window.__workstation.showcase.pause());
  const deviceLid = await inner();
  check('device-lid-closed', deviceLid.lidClosed > 0.95, String(deviceLid.lidClosed));
  await page.evaluate(() => window.__workstation.showcase.setUiHidden(true));
  await page.waitForTimeout(400);
  const deviceShot = await shot('final-showcase-device.png', '设备互动：笔记本真实合盖，底部字幕同步说明当前功能。');

  // RGB 灯效：只使用项目真实支持的单色/彩虹/呼吸。
  await page.evaluate(() => { window.__workstation.showcase.seek(30); window.__workstation.showcase.pause(); });
  await page.waitForTimeout(250);
  const rgbStatic = await inner();
  check('rgb-static', rgbStatic.rgbMode === 'static' && rgbStatic.rgbColor === '#2BD8FF',
    JSON.stringify({ mode: rgbStatic.rgbMode, color: rgbStatic.rgbColor }));
  await page.evaluate(() => window.__workstation.showcase.seek(31.5));
  await page.waitForTimeout(250);
  const rgbRainbow = await inner();
  check('rgb-rainbow', rgbRainbow.rgbMode === 'rainbow', rgbRainbow.rgbMode);
  const liveRgb = await page.locator('.showcase-live').textContent();
  check('live-subtitle-rgb', String(liveRgb).includes('彩虹'), String(liveRgb));
  await page.waitForTimeout(900);
  const rgbShot = await shot('final-showcase-rgb.png', '第五幕：键盘彩虹灯效、桌面氛围光与实时字幕。');
  await page.evaluate(() => window.__workstation.showcase.seek(33.4));
  await page.waitForTimeout(250);
  const rgbBreathe = await inner();
  check('rgb-breathe', rgbBreathe.rgbMode === 'breathe', rgbBreathe.rgbMode);

  // 夜间氛围。
  await page.evaluate(() => { window.__workstation.showcase.seek(35.5); window.__workstation.showcase.pause(); });
  await page.waitForTimeout(900);
  const nightState = await page.evaluate(() => ({
    showcase: window.__workstation.showcase.getState(),
    ui: window.__workstation.getUiState(),
  }));
  check('night-scene', nightState.ui.scene === 'night', nightState.ui.scene);
  await page.evaluate(() => window.__workstation.showcase.setUiHidden(true));
  await page.waitForTimeout(600);
  const nightShot = await shot('final-showcase-night.png', '第六幕：深夜模式，双屏、键盘呼吸灯与实时功能字幕。');
  await page.evaluate(() => window.__workstation.showcase.seek(38.2));
  await page.waitForTimeout(250);
  const focusScene = await page.evaluate(() => window.__workstation.getUiState().scene);
  check('focus-scene', focusScene === 'focus', focusScene);

  // 重复播放：多次重播仍回到统一起点，不叠加设备状态。
  for (let i = 0; i < 3; i += 1) {
    await page.evaluate(() => window.__workstation.showcase.restart());
    await page.waitForTimeout(350);
    const replay = await state();
    const replayDevices = await page.evaluate(() => ({
      inner: window.__workstation.root.userData.animation.getState(),
      ui: window.__workstation.getUiState(),
    }));
    check(`replay-${i}-start`, replay.status === 'playing' && replay.elapsed < 0.8,
      JSON.stringify(replay));
    check(`replay-${i}-devices`, replayDevices.inner.rgbMode === 'off' && replayDevices.ui.screenContent === 'dashboard',
      JSON.stringify(replayDevices));
  }

  // 终章：结束标题、实时字幕与真实进度。
  await page.evaluate(() => window.__workstation.showcase.seek(44));
  await page.evaluate(() => window.__workstation.showcase.pause());
  await page.waitForTimeout(1000);
  const finale = await state();
  const finaleScene = await page.evaluate(() => window.__workstation.getUiState().scene);
  check('finale-progress', finale.elapsed >= 44 && finale.chapterIndex === 6);
  check('finale-scene', finaleScene === 'rgb', finaleScene);
  const liveFinale = await page.locator('.showcase-live').textContent();
  check('live-subtitle-finale', String(liveFinale).includes('终章全景'), String(liveFinale));
  const finaleShot = await shot('final-showcase-finale.png', '终章：全景收尾、实时功能字幕与结束标题。');

  // 播放自然完成：短暂停留后必须自动恢复初始状态。
  await page.evaluate(() => window.__workstation.showcase.resume());
  await page.waitForFunction(
    () => window.__workstation.showcase.getState().status === 'finished',
    null,
    { timeout: 30000 },
  );
  const finished = await state();
  check('finished-status', finished.status === 'finished' && finished.progress === 1,
    JSON.stringify(finished));
  check('finished-caption', finished.caption === 'outro');
  check('finished-subtitle', finished.subtitle.includes('恢复初始状态'), finished.subtitle);
  const nextDisabled = await page.locator('.showcase-actions button').first().isDisabled();
  check('finished-next-disabled', nextDisabled === true);

  await page.waitForFunction(
    () => window.__workstation.showcase.isActive() === false
      && window.__workstation.showcase.getState().status === 'stopped'
      && window.__workstation.controls.enabled === true,
    null,
    { timeout: 20000 },
  );
  await page.waitForFunction(
    (baseline) => {
      const p = window.__workstation.camera.position;
      const dx = p.x - baseline[0];
      const dy = p.y - baseline[1];
      const dz = p.z - baseline[2];
      return Math.sqrt(dx * dx + dy * dy + dz * dz) < 0.02;
    },
    baseline.camera.position,
    { timeout: 30000 },
  );
  await page.waitForFunction(
    () => window.__workstation.root.userData.animation.getState().lidClosed > 0.999,
    null,
    { timeout: 30000 },
  );
  const exited = await page.evaluate(() => ({
    showcase: window.__workstation.showcase.getState(),
    ui: window.__workstation.getUiState(),
    treeHidden: document.querySelector('.design-tree')?.classList.contains('is-hidden'),
    controlsEnabled: window.__workstation.controls.enabled,
    view: window.__workstation.currentView(),
    liveVisible: document.querySelector('.showcase-live')?.classList.contains('is-visible'),
  }));
  check('auto-restore-inactive', exited.showcase.active === false && exited.showcase.status === 'stopped');
  check('auto-restore-controls', exited.controlsEnabled === true && exited.treeHidden === false);
  check('auto-restore-scene', exited.ui.scene === baseline.ui.scene, `${exited.ui.scene} vs ${baseline.ui.scene}`);
  check('auto-restore-rgb', exited.ui.rgbMode === baseline.ui.rgbMode && exited.ui.rgbColor === baseline.ui.rgbColor,
    JSON.stringify({ rgbMode: exited.ui.rgbMode, rgbColor: exited.ui.rgbColor }));
  check('auto-restore-screen', exited.ui.screenContent === baseline.ui.screenContent && exited.ui.lidClosed === true);
  check('auto-restore-view', exited.view === 'left', String(exited.view));
  check('auto-restore-subtitle-hidden', exited.liveVisible === false);

  // 退出后手动控件重新可用。
  await openSection('视角');
  await page.locator('[data-view="front"]').click();
  await page.waitForFunction(() => window.__workstation.currentView() === 'front', null, { timeout: 15000 });
  check('exit-manual-view', (await page.evaluate(() => window.__workstation.currentView())) === 'front');
  await closeSection('视角');

  // 第二次启动：开启“展示时隐藏设计树”，验证开始即隐藏、可恢复、可手动退出。
  await openSection('自动展示');
  const hideSwitchAgain = page.getByRole('switch', { name: '展示时隐藏设计树' });
  if (await hideSwitchAgain.getAttribute('aria-checked') !== 'true') await hideSwitchAgain.click();
  await page.waitForFunction(
    () => document.querySelector('[role="switch"][aria-label="展示时隐藏设计树"]')?.getAttribute('aria-checked') === 'true',
    null,
    { timeout: 5000 },
  );
  await page.getByRole('button', { name: '开始展示', exact: true }).click();
  await page.waitForFunction(() => window.__workstation.showcase.getState().status === 'playing', null, { timeout: 10000 });
  const autoHideState = await page.evaluate(() => ({
    treeHidden: document.querySelector('.design-tree')?.classList.contains('is-hidden'),
    restoreVisible: !document.querySelector('.tree-restore')?.hidden,
    state: window.__workstation.showcase.getState(),
  }));
  check('start-hide-option', autoHideState.treeHidden && autoHideState.restoreVisible && autoHideState.state.hideOnStart);
  await page.locator('.tree-restore').click();
  check('start-hide-recover', (await page.evaluate(() => document.querySelector('.design-tree')?.classList.contains('is-hidden'))) === false);
  if (await hideSwitchAgain.getAttribute('aria-checked') === 'true') await hideSwitchAgain.click();
  await page.waitForFunction(
    () => document.querySelector('[role="switch"][aria-label="展示时隐藏设计树"]')?.getAttribute('aria-checked') === 'false',
    null,
    { timeout: 5000 },
  );
  await page.getByRole('button', { name: '退出展示', exact: true }).click();
  await page.waitForFunction(
    () => !window.__workstation.showcase.isActive() && window.__workstation.controls.enabled === true,
    null,
    { timeout: 10000 },
  );
  check('second-cycle-clean', (await page.evaluate(() => window.__workstation.controls.enabled)) === true);

  check('no-page-errors', errors.length === 0, errors.join(' | '));

  const report = {
    runAt: new Date().toISOString(),
    viewport: '1200×900',
    checks,
    errors,
    baseline,
    final: {
      chapterCount: finished.chapterCount,
      total: finished.total,
      exitScene: exited.ui.scene,
      exitView: exited.view,
    },
    screenshots: [uiShot, openingShot, pausedShot, deviceShot, rgbShot, nightShot, finaleShot],
    notes: '无头 SwiftShader 帧率低，测试通过 seek 定位章节；45 秒时间线、底部实时字幕、展示时隐藏选项、暂停/继续、设备冻结、隐藏与恢复、自然完成自动恢复均按真实状态断言。',
  };
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ ok: true, checks: checks.length, errors, report: reportPath }, null, 2));
} catch (error) {
  const report = {
    runAt: new Date().toISOString(),
    viewport: '1200×900',
    checks,
    errors: [...errors, String(error?.message ?? error)],
    failed: true,
  };
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.error(JSON.stringify(report, null, 2));
  process.exitCode = 1;
} finally {
  await browser.close();
}
