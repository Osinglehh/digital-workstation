// 桌下结构与地面陈设审计：逐顶点世界 AABB、净距、落地、碰撞与旧节点移除检查。
// 运行前提：dev server 已在 http://127.0.0.1:5173/ 运行；输出写入 analysis/underdesk-audit.json。
// 用法：node tools/audit_underdesk.mjs
import { chromium } from 'playwright-core';
import fs from 'node:fs';
const browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__workstation, null, { timeout: 90000 });
await page.waitForTimeout(1500);
const result = await page.evaluate(async () => {
  // HMR 整页重载会让 window.__workstation 短暂消失，这里自行等待就绪（最多 60 s）。
  const deadline = Date.now() + 60000;
  while (!window.__workstation && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 200));
  if (!window.__workstation) throw new Error('window.__workstation 未就绪');
  const scene = window.__workstation.scene;
  const runtime = window.__workstation.root.userData.sculptRuntime;
  const r4 = (v) => Math.round(v * 10000) / 10000;
  // 逐顶点乘 matrixWorld 求精确包络；Box3.setFromObject 对带旋转子物件会按角点膨胀，不用于落地/净距判据。
  const boxOf = (object) => {
    if (!object) return null;
    object.updateWorldMatrix(true, true);
    const min = { x: Infinity, y: Infinity, z: Infinity };
    const max = { x: -Infinity, y: -Infinity, z: -Infinity };
    object.traverse((child) => {
      if (!child.isMesh || !child.geometry?.attributes?.position) return;
      const pos = child.geometry.attributes.position;
      for (let i = 0; i < pos.count; i += 1) {
        const x = pos.getX(i);
        const y = pos.getY(i);
        const z = pos.getZ(i);
        const e = child.matrixWorld.elements;
        const wx = e[0] * x + e[4] * y + e[8] * z + e[12];
        const wy = e[1] * x + e[5] * y + e[9] * z + e[13];
        const wz = e[2] * x + e[6] * y + e[10] * z + e[14];
        if (wx < min.x) min.x = wx;
        if (wy < min.y) min.y = wy;
        if (wz < min.z) min.z = wz;
        if (wx > max.x) max.x = wx;
        if (wy > max.y) max.y = wy;
        if (wz > max.z) max.z = wz;
      }
    });
    if (!Number.isFinite(min.x)) return null;
    return { min: { x: r4(min.x), y: r4(min.y), z: r4(min.z) }, max: { x: r4(max.x), y: r4(max.y), z: r4(max.z) }, size: { x: r4(max.x - min.x), y: r4(max.y - min.y), z: r4(max.z - min.z) } };
  };
  const byName = (name) => scene.getObjectByName(name);
  const overlap = (a, b) => Boolean(a && b && a.min.x <= b.max.x && a.max.x >= b.min.x && a.min.y <= b.max.y && a.max.y >= b.min.y && a.min.z <= b.max.z && a.max.z >= b.min.z);
  const gapBetween = (a, b) => {
    const dx = Math.max(a.min.x - b.max.x, b.min.x - a.max.x, 0);
    const dy = Math.max(a.min.y - b.max.y, b.min.y - a.max.y, 0);
    const dz = Math.max(a.min.z - b.max.z, b.min.z - a.max.z, 0);
    return r4(Math.sqrt(dx * dx + dy * dy + dz * dz));
  };
  const boxes = {
    backPanel: boxOf(byName('under-desk-back-panel')),
    leftPanel: boxOf(byName('under-desk-left-panel')),
    rightPanel: boxOf(byName('under-desk-right-panel')),
    leftPost: boxOf(byName('under-desk-left-post')),
    rightPost: boxOf(byName('under-desk-right-post')),
    topRail: boxOf(byName('under-desk-top-rail')),
    trunking: boxOf(byName('under-desk-cable-trunking')),
    socketBlack: boxOf(byName('under-desk-socket-black-0.105')),
    socketWhite: boxOf(byName('under-desk-socket-white-0.205')),
    knockout: boxOf(byName('under-desk-knockout')),
    bag: boxOf(byName('backpack')),
    bagBody: boxOf(byName('backpack-body')),
    bin: boxOf(byName('waste-bin')),
    chair: boxOf(byName('ergonomic-chair')),
    floor: boxOf(byName('studio-floor')),
    desktop: boxOf(runtime.meshes?.desk),
  };
  const cables = ['under-desk-black-drop', 'under-desk-white-drop']
    .map((name) => ({ name, box: boxOf(byName(name)) }));
  // 椅子整体 AABB 是五爪+后仰的松散包络；书包/垃圾桶与椅子的判定改用逐子件 AABB，
  // 以免“整体包围盒相交但真实间隙很大”造成误报。
  const chairParts = [];
  byName('ergonomic-chair')?.traverse((child) => {
    if (!child.isMesh || !child.geometry?.attributes?.position) return;
    const box = boxOf(child);
    if (box) chairParts.push({ name: child.name || '(mesh)', box });
  });
  const chairPartChecks = (target) => {
    const rows = chairParts.map((part) => ({ name: part.name, overlap: overlap(target, part.box), gap: gapBetween(target, part.box) }));
    const nearest = rows.reduce((best, row) => (row.gap < best.gap ? row : best), rows[0]);
    return { overlapping: rows.filter((row) => row.overlap).map((row) => row.name), minGap: nearest.gap, nearestPart: nearest.name };
  };
  const oldIds = ['deskPostFL', 'deskPostFR', 'deskPostRL', 'deskPostRR', 'deskRailFront', 'deskRailBack'];
  const removed = Object.fromEntries(oldIds.map((id) => [id, !runtime.nodes?.[id]?.parent]));
  const cableMinY = Math.min(...cables.map((c) => c.box?.min.y ?? Infinity));
  return {
    boxes,
    clearances: {
      bagToLeftPanel: r4(boxes.bagBody.min.x - boxes.leftPanel.max.x),
      bagToBackPanel: r4(boxes.bagBody.min.z - boxes.backPanel.max.z),
      bagGroupToLeftPanel: r4(boxes.bag.min.x - boxes.leftPanel.max.x),
      bagGroupToBackPanel: r4(boxes.bag.min.z - boxes.backPanel.max.z),
      binToLeftPanel: r4(boxes.leftPanel.min.x - boxes.bin.max.x),
      topRailToDesktopUnderside: r4(boxes.desktop.min.y - boxes.topRail.max.y),
      leftPanelTopToDesktopUnderside: r4(boxes.desktop.min.y - boxes.leftPanel.max.y),
      bagTopToDesktopUnderside: r4(boxes.desktop.min.y - boxes.bag.max.y),
      binTopToDesktopUnderside: r4(boxes.desktop.min.y - boxes.bin.max.y),
    },
    contacts: {
      leftPanelMinY: boxes.leftPanel.min.y,
      rightPanelMinY: boxes.rightPanel.min.y,
      backPanelMinY: boxes.backPanel.min.y,
      bagMinY: boxes.bag.min.y,
      binMinY: boxes.bin.min.y,
      chairMinY: boxes.chair.min.y,
      floorMaxY: boxes.floor.max.y,
      cableMinY: r4(cableMinY),
    },
    collisions: {
      bagChairParts: chairPartChecks(boxes.bag),
      binChairParts: chairPartChecks(boxes.bin),
      leftPanelChair: overlap(boxes.leftPanel, boxes.chair),
      rightPanelChair: overlap(boxes.rightPanel, boxes.chair),
      bagLeftPanel: overlap(boxes.bagBody, boxes.leftPanel),
      bagBackPanel: overlap(boxes.bagBody, boxes.backPanel),
      bagGroupLeftPanel: overlap(boxes.bag, boxes.leftPanel),
      bagGroupBackPanel: overlap(boxes.bag, boxes.backPanel),
      binLeftPanel: overlap(boxes.bin, boxes.leftPanel),
    },
    removedLegacy: removed,
    cables,
    errors: [],
  };
});
result.errors = errors;
const payload = {
  generated: new Date().toISOString(),
  reference: ['figure/桌底-1.jpg', 'figure/桌底-2.jpg', 'figure/书包-1.jpg', 'figure/书包-2.jpg'],
  units: 'meters, Y-up, floor top y=0',
  structure: {
    construction: '落地 20 mm 木侧板 + 30 mm 木背板 + 40×40 mm 后角铝立柱；无桌腿、无前/后横梁。',
    underDeskTopY: 0.7325,
    panelThickness: { side: 0.02, back: 0.03 },
    postSection: 0.04,
    topRail: '1.05 × 0.028 × 0.014 at y=0.717',
    trunking: '0.978 × 0.105 × 0.045 at z=-0.2775；16 道横向肋',
    sockets: '86×86 mm 五孔面板 ×2，中心 x=0.105 / 0.205，y=0.054；右侧预留敲落孔 x=0.342',
    oldLegsRailsRemoved: result.removedLegacy,
  },
  decorative: {
    backpack: '背面靠在左侧板内表面（约 5° 倚放，包顶贴板、包底留楔缝），正面朝桌内（+x）；酒红印花软包，黑前袋/灰色 BAP 贴片/肩带/提手，落地与肩带均贴地。',
    bin: '白色冲孔篮 + 绿色垃圾袋，置于桌下左前外侧。',
    floor: '600×600 mm 亚光陶瓷砖，4×4 平铺图集，灰缝约 4 mm。',
  },
  measured: result.boxes,
  clearances: result.clearances,
  contacts: result.contacts,
  collisions: result.collisions,
  cableEndpoints: result.cables,
  errors: result.errors,
};
fs.writeFileSync('analysis/underdesk-audit.json', JSON.stringify(payload, null, 2));
console.log(JSON.stringify({ clearances: payload.clearances, contacts: payload.contacts, collisions: payload.collisions, removed: payload.structure.oldLegsRailsRemoved, errors }, null, 2));
await browser.close();